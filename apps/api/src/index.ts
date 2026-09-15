import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Redis from 'ioredis';
import { MODEL_REGISTRY, loadEnv } from './config';
import { closePool, getPool } from './db/pool';
import { runMigrations } from './db/migrate';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { Store } from './store/types';
import { MemoryRateLimiter } from './limiters/memory';
import { RedisRateLimiter } from './limiters/redis';
import type { RateLimiter } from './limiters/types';
import { S3Storage } from './storage/s3';
import { createMockAdapter } from './adapters/mock';
import { createOpenAIAdapter } from './adapters/openai';
import { createAnthropicAdapter } from './adapters/anthropic';
import { registerRoutes } from './routes';
import type { ModelAdapter } from './types';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Build one adapter per configured model — the unified abstraction layer.
  const adapters = new Map<string, ModelAdapter>();
  for (const m of MODEL_REGISTRY) {
    if (m.provider === 'mock') {
      adapters.set(m.id, createMockAdapter(m.id, m.name));
    } else if (m.provider === 'openai' && env.openaiKey) {
      adapters.set(m.id, createOpenAIAdapter(m.id, m.upstreamId, env.openaiKey));
    } else if (m.provider === 'anthropic' && env.anthropicKey) {
      adapters.set(m.id, createAnthropicAdapter(m.id, m.upstreamId, env.anthropicKey));
    }
  }

  // Storage: PostgreSQL when DATABASE_URL is set, in-memory fallback otherwise.
  let store: Store;
  if (env.databaseUrl) {
    await runMigrations(env.databaseUrl);
    store = new PostgresStore(getPool(env.databaseUrl));
    app.log.info('store: postgresql (migrations applied on boot)');
  } else {
    store = new MemoryStore();
    app.log.info('store: in-memory (set DATABASE_URL to enable PostgreSQL)');
  }

  // Rate limiting: Redis counters (per session) when REDIS_URL is set.
  let redis: Redis | null = null;
  let limiter: RateLimiter;
  if (env.redisUrl) {
    redis = new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    try {
      await redis.connect();
      limiter = new RedisRateLimiter(redis, env.rateLimitPerMinute, env.rateLimitPerDay);
      app.log.info('rate limit: redis (per session)');
    } catch (err) {
      app.log.warn(`redis unavailable (${(err as Error).message}); using in-memory limiter`);
      redis = null;
      limiter = new MemoryRateLimiter(env.rateLimitPerMinute, env.rateLimitPerDay);
    }
  } else {
    limiter = new MemoryRateLimiter(env.rateLimitPerMinute, env.rateLimitPerDay);
    app.log.info('rate limit: in-memory (set REDIS_URL to enable Redis counters)');
  }

  // Object storage: S3-compatible when S3_BUCKET is set.
  let storage: S3Storage | null = null;
  if (env.s3.bucket) {
    storage = new S3Storage(env.s3);
    try {
      await storage.ensureBucket();
      app.log.info(`storage: s3 bucket=${env.s3.bucket}${env.s3.endpoint ? ` endpoint=${env.s3.endpoint}` : ''}`);
    } catch (err) {
      app.log.warn(`s3 unavailable (${(err as Error).message}); attachments will not persist`);
      storage = null;
    }
  }

  const memoryLimiter = limiter instanceof MemoryRateLimiter ? limiter : null;
  if (memoryLimiter) {
    const pruneTimer = setInterval(() => memoryLimiter.prune(), 10 * 60_000);
    pruneTimer.unref?.();
  }

  registerRoutes(app, { env, store, limiter, adapters, storage, redis });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const status = (err as { statusCode?: number })?.statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'internal error';
    reply.code(status >= 400 ? status : 500).send({
      error: { code: status === 400 ? 'INVALID_INPUT' : 'INTERNAL', message },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } });
  });

  app.addHook('onClose', async () => {
    await closePool();
    await redis?.quit().catch(() => undefined);
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
