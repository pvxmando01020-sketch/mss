/**
 * phase1/routes/health.js — فحوصات الصحة والجاهزية (المرحلة 1)
 */

async function healthRoutes(fastify, opts) {
  const config = opts.config || require('../../config');
  const db = require('../../adapters/db');
  const { getRedis } = require('../../adapters/cacheRedis');

  fastify.get('/health', async () => ({
    ok: true,
    version: '1.1.0',
    phase: '1+2+3+5',
    uptime_s: Math.floor(process.uptime()),
  }));

  fastify.get('/ready', async () => {
    const checks = { postgres: 'unknown', redis: 'unknown' };
    try {
      const pool = await db.getPool(config);
      if (!pool) checks.postgres = 'memory-fallback';
      else { await pool.query('SELECT 1'); checks.postgres = 'ok'; }
    } catch { checks.postgres = 'error'; }
    try {
      const r = await getRedis(config);
      checks.redis = r ? 'ok' : 'memory-fallback';
    } catch { checks.redis = 'error'; }
    const ok = checks.postgres !== 'error' && checks.redis !== 'error';
    return { ok, checks };
  });

  fastify.get('/v1/models', async () => {
    const { adapters } = require('../../adapters/modelAdapter');
    const dbModels = [];
    try {
      const pool = await db.getPool(config);
      if (pool) {
        const { rows } = await pool.query('SELECT id, provider, label, is_active, cost_per_1k FROM gateway_models WHERE is_active=true ORDER BY id');
        dbModels.push(...rows);
      }
    } catch {}
    return {
      adapters,
      dbModels: dbModels.length ? dbModels : undefined,
      modelsByCategory: config.modelsByCategory,
    };
  });
}

module.exports = { healthRoutes };
