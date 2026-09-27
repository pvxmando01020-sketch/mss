/**
 * config.js — إعدادات مركزية للمرحلة 3 + 4
 * كل القيم لها defaults تعمل بدون env وبدون تثبيت postgres/redis
 */

module.exports = {
  // Gateway
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  // Postgres — لو غير متوفر يعمل fallback in-memory
  databaseUrl: process.env.DATABASE_URL || null,
  pg: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'mss_gateway',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  },

  // Redis — fallback Map
  redisUrl: process.env.REDIS_URL || null,

  // S3 — fallback memory
  s3: {
    endpoint: process.env.S3_ENDPOINT || null,
    bucket: process.env.S3_BUCKET || 'mss-uploads',
    region: process.env.AWS_REGION || 'us-east-1',
  },

  // Routing — epsilon-greedy + alpha
  routing: {
    alpha: Number(process.env.ROUTING_ALPHA || 0.2),
    epsilon: Number(process.env.ROUTING_EPSILON || 0.1),
    cacheTtlMs: Number(process.env.ROUTING_CACHE_TTL || 6 * 60 * 60 * 1000),
    cacheMax: Number(process.env.ROUTING_CACHE_MAX || 300),
  },

  // Moderation (مرحلة 4 — موازية)
  moderation: {
    enabled: (process.env.MODERATION_ENABLED || 'false').toLowerCase() === 'true',
    blockThreshold: Number(process.env.MODERATION_BLOCK || 0.92),
    flagThreshold: Number(process.env.MODERATION_FLAG || 0.65),
  },

  // النماذج المتاحة لكل فئة — يمكن تعديلها عبر env JSON
  modelsByCategory: (() => {
    try {
      if (process.env.MODELS_JSON) return JSON.parse(process.env.MODELS_JSON);
    } catch {}
    return {
      code: ['strong-code', 'fast-cheap'],
      creative: ['claude', 'fast-cheap'],
      analysis: ['accurate-math', 'claude'],
      retrieval: ['fast-cheap'],
      general: ['fast-cheap'],
    };
  })(),
};
