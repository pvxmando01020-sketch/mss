/**
 * phase1/middleware/errorHandler.js — معالجة أخطاء موحدة للـ Gateway
 */

function errorHandler(error, request, reply) {
  const status = error.statusCode || error.status || 500;
  const isDev = process.env.NODE_ENV !== 'production';
  request.log?.error?.(error);
  reply.code(status).send({
    error: error.message || 'internal_error',
    status,
    code: error.code || undefined,
    ...(isDev ? { stack: error.stack } : {}),
  });
}

function notFoundHandler(request, reply) {
  reply.code(404).send({ error: 'not_found', path: request.url });
}

module.exports = { errorHandler, notFoundHandler };
