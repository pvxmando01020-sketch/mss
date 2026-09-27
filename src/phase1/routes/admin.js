/**
 * phase1/routes/admin.js — لوحة تحكم بسيطة (المرحلة 1+2)
 * GET /v1/admin/stats — إحصائيات عامة (يحتاج admin)
 */

const db = require('../../adapters/db');
const { requireAuth } = require('../../phase2/middleware/jwt');

async function adminRoutes(fastify, opts) {
  const config = opts.config || require('../../config');

  fastify.get('/v1/admin/stats', { preHandler: [requireAuth()] }, async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const pool = await db.getPool(config);
    let stats = { users: 0, conversations: 0, messages: 0, requests: 0 };
    if (pool) {
      try {
        const u = await pool.query('SELECT COUNT(*) FROM users');
        stats.users = Number(u.rows[0].count);
        const c = await pool.query('SELECT COUNT(*) FROM conversations');
        stats.conversations = Number(c.rows[0].count);
        const m = await pool.query('SELECT COUNT(*) FROM messages');
        stats.messages = Number(m.rows[0].count);
        const r = await pool.query('SELECT COUNT(*) FROM gateway_requests');
        stats.requests = Number(r.rows[0].count);
      } catch {}
    } else {
      // fallback — تقديري من الذاكرة
      stats = { users: 'memory', conversations: 'memory', messages: 'memory', requests: 'memory', note: 'memory fallback — connect Postgres for real stats' };
    }
    return { ok: true, stats, version: '1.0.0', phase: '1+2+3+4' };
  });

  fastify.get('/v1/admin/routing', { preHandler: [requireAuth()] }, async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const routingStats = opts.store ? opts.store.summaryForPostgres() : null;
    return { routing: routingStats };
  });
}

module.exports = { adminRoutes };
