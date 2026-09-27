/**
 * phase1/middleware/requestLogger.js — تسجيل طلبات موحد (pino → console fallback)
 */

function requestLogger(fastify) {
  fastify.addHook('onRequest', async (req) => {
    req._t0 = Date.now();
  });
  fastify.addHook('onResponse', async (req, reply) => {
    const ms = Date.now() - (req._t0 || Date.now());
    const line = `${req.method} ${req.url} → ${reply.statusCode} ${ms}ms`;
    if (reply.statusCode >= 500) req.log?.error?.(line);
    else if (reply.statusCode >= 400) req.log?.warn?.(line);
    else req.log?.info?.(line);
    // قياس للـ gateway_requests لو كان Postgres متاحاً (best-effort)
  });
}

module.exports = { requestLogger };
