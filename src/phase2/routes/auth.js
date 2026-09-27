/**
 * phase2/routes/auth.js — المصادقة (المرحلة 2)
 * POST /v1/auth/register  { email, password }
 * POST /v1/auth/login     { email, password } → { token, user }
 * GET  /v1/auth/me        (Bearer)
 */

const authService = require('../services/authService');
const { requireAuth } = require('../middleware/jwt');

async function authRoutes(fastify, opts) {
  const config = opts.config || require('../../config');

  fastify.post('/v1/auth/register', async (req, reply) => {
    const { email, password, role } = req.body || {};
    try {
      const user = await authService.createUser(config, { email, password, role: role === 'admin' ? 'admin' : 'user' });
      return reply.code(201).send({ user });
    } catch (e) {
      return reply.code(e.statusCode || 400).send({ error: e.message });
    }
  });

  fastify.post('/v1/auth/login', async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
    try {
      const result = await authService.authenticate(config, email, password);
      return reply.send(result);
    } catch (e) {
      return reply.code(e.statusCode || 401).send({ error: e.message });
    }
  });

  fastify.get('/v1/auth/me', { preHandler: [requireAuth()] }, async (req) => {
    return { user: req.user };
  });

  // POST /v1/auth/api-keys — إدارة مفاتيح النماذج (تبقى في backend)
  fastify.post('/v1/auth/api-keys', { preHandler: [requireAuth()] }, async (req, reply) => {
    const { provider, key, label } = req.body || {};
    if (!provider || !key) return reply.code(400).send({ error: 'provider and key required' });
    // لا نخزن المفتاح الخام — نخزن hash فقط، القيمة الحقيقية تذهب إلى env/Vault في الإنتاج
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16) + '…';
    // حاول Postgres
    const db = require('../../adapters/db');
    const pool = await db.getPool(config);
    if (pool) {
      try {
        const { rows } = await pool.query(
          'INSERT INTO api_keys(user_id, provider, key_hash, label) VALUES($1,$2,$3,$4) RETURNING id, provider, label, is_active, created_at',
          [req.user.id, provider, hash, label || null]
        );
        return reply.code(201).send({ key: rows[0], hint: 'key stored as hash only — set env ' + provider.toUpperCase() + '_API_KEY in production' });
      } catch (e) { return reply.code(500).send({ error: String(e.message) }); }
    }
    return reply.code(201).send({ key: { provider, key_hash: hash, label }, hint: 'memory fallback — set env in production' });
  });
}

module.exports = { authRoutes };
