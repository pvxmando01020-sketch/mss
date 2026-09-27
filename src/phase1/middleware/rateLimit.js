/**
 * phase1/middleware/rateLimit.js — حد الطلبات (Redis → fallback Map)
 */

const buckets = new Map(); // key → { count, resetAt }

/**
 * @param {{ windowMs?:number, max?:number, keyGenerator?:Function }} opts
 */
function rateLimit(opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 60;
  const keyGen = opts.keyGenerator ?? ((req) => req.ip || req.headers['x-forwarded-for'] || 'anon');

  return async function (request, reply) {
    const key = keyGen(request);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      reply.code(429).send({ error: 'rate_limited', retry_after_ms: b.resetAt - now });
      return reply;
    }
    // تصدير هيدرز مفيدة
    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
  };
}

function _reset() { buckets.clear(); }

module.exports = { rateLimit, _reset };
