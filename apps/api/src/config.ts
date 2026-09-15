import type { ModelDef } from './types';

export interface S3Env {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
}

export interface Env {
  port: number;
  openaiKey?: string;
  anthropicKey?: string;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  moderationStrict: boolean;
  databaseUrl?: string;
  redisUrl?: string;
  s3: S3Env;
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 4000),
    openaiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicKey: process.env.ANTHROPIC_API_KEY || undefined,
    rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
    rateLimitPerDay: Number(process.env.RATE_LIMIT_PER_DAY ?? 2000),
    moderationStrict: process.env.MODERATION_STRICT === 'true',
    databaseUrl: process.env.DATABASE_URL || undefined,
    redisUrl: process.env.REDIS_URL || undefined,
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY || undefined,
      secretAccessKey: process.env.S3_SECRET_KEY || undefined,
      bucket: process.env.S3_BUCKET || undefined,
    },
  };
}

/**
 * Model registry — configuration, not code.
 * Adding a new model = adding a row here (plus an adapter only for a brand-new provider).
 */
export const MODEL_REGISTRY: ModelDef[] = [
  {
    id: 'openai:gpt-4o-mini',
    provider: 'openai',
    upstreamId: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    contextWindow: 128_000,
    capabilities: ['text', 'vision', 'code'],
    tier: 'cheap',
    fallback: 'anthropic:claude-3-5-haiku',
  },
  {
    id: 'anthropic:claude-3-5-haiku',
    provider: 'anthropic',
    upstreamId: 'claude-3-5-haiku-latest',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    capabilities: ['text', 'code'],
    tier: 'standard',
    fallback: 'openai:gpt-4o-mini',
  },
  {
    id: 'mock:chat',
    provider: 'mock',
    upstreamId: 'nova-chat',
    name: 'Nova Chat (Demo)',
    contextWindow: 32_000,
    capabilities: ['text'],
    tier: 'cheap',
  },
  {
    id: 'mock:code',
    provider: 'mock',
    upstreamId: 'nova-code',
    name: 'Nova Code (Demo)',
    contextWindow: 32_000,
    capabilities: ['text', 'code'],
    tier: 'standard',
  },
  {
    id: 'mock:vision',
    provider: 'mock',
    upstreamId: 'nova-vision',
    name: 'Nova Vision (Demo)',
    contextWindow: 32_000,
    capabilities: ['text', 'vision'],
    tier: 'standard',
  },
];

export function keyAvailable(provider: ModelDef['provider'], env: Env): boolean {
  if (provider === 'mock') return true;
  if (provider === 'openai') return Boolean(env.openaiKey);
  return Boolean(env.anthropicKey);
}

export function modelById(id: string): ModelDef | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function availableModels(env: Env): ModelDef[] {
  return MODEL_REGISTRY.filter((m) => keyAvailable(m.provider, env));
}
