import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { MODEL_REGISTRY, loadEnv } from './config';
import { MemoryStore } from './store';
import { RateLimiter } from './safety/rateLimit';
import { createMockAdapter } from './adapters/mock';
import { createOpenAIAdapter } from './adapters/openai';
import { createAnthropicAdapter } from './adapters/anthropic';
import { registerRoutes } from './routes';
import type { ModelAdapter } from './types';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] });

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

  const store = new MemoryStore();
  const limiter = new RateLimiter(env.rateLimitPerMinute, env.rateLimitPerDay);
  const pruneTimer = setInterval(() => limiter.prune(), 10 * 60_000);
  pruneTimer.unref?.();

  registerRoutes(app, { env, store, limiter, adapters });

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

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
