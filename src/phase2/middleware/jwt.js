/**
 * phase2/middleware/jwt.js — تحقق JWT اختياري (المرحلة 2)
 * لا يمنع الضيف — يضيف request.user إن وجد token صالح
 */

const { verifyToken } = require('../services/authService');

async function optionalAuth(config) {
  return async function (request, reply) {
    const header = request.headers?.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) { request.user = null; return; }
    try {
      const payload = await verifyToken(config, token);
      request.user = { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      // token غير صالح → تجاهل واعتبره ضيف (لا نرجع 401 هنا حتى لا نكسر الاستخدام المجهول)
      request.user = null;
    }
  };
}

function requireAuth() {
  return async function (request, reply) {
    if (!request.user) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Bearer token required' });
    }
  };
}

module.exports = { optionalAuth, requireAuth };
