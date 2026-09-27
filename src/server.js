/**
 * server.js — مصنع Fastify الكامل للمرحلة 3 + 4
 *
 * يجمع: التوجيه الذكي + الكاش (Redis/Map) + Postgres + S3 (stub) + Moderation
 * يعمل بدون تثبيت fastify/pg/ioredis — يعيد stub server للاختبارات.
 */

const config = require('./config');
const { ScoreStore } = require('./store');
const { LocalCache } = require('./cache');
const { buildRouteHandler, smartRouterPlugin } = require('./gateway');
const { preCheck, postCheck } = require('./moderation');
const { callModel } = require('./adapters/modelAdapter');
const db = require('./adapters/db');
const { estimateQuality, applyFeedback } = require('./logger');
const { pushSummary } = require('./sync');

function createStores(opts = {}) {
  const store = opts.store ?? new ScoreStore({}, { alpha: config.routing.alpha, epsilon: config.routing.epsilon });
  const cache = opts.cache ?? new LocalCache({ maxEntries: config.routing.cacheMax, ttlMs: config.routing.cacheTtlMs });
  return { store, cache };
}

/**
 * يبني تطبيق Fastify حقيقي لو fastify متوفر، وإلا يعيد stub للاختبارات
 */
async function buildApp(opts = {}) {
  const { store, cache } = createStores(opts);
  let fastify;
  try {
    const Fastify = require('fastify');
    fastify = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  } catch {
    // stub minimal للاختبارات بدون تثبيت fastify
    return buildStubApp(store, cache, opts);
  }

  // CORS للـ preview — يسمح بـ https://{port}-{sandbox}.e2b.app
  try {
    await fastify.register(require('@fastify/cors'), { origin: true, credentials: true });
  } catch {}

  // صحّة
  fastify.get('/health', async () => ({ ok: true, version: '0.4.0', moderation: config.moderation.enabled }));
  fastify.get('/v1/models', async () => ({ modelsByCategory: config.modelsByCategory }));

  // التوجيه الذكي
  await fastify.register(smartRouterPlugin, {
    store, cache,
    modelsByCategory: config.modelsByCategory,
    persistSummary: async (summary) => { await db.persistSummary(config, summary); },
  });

  // إكمال المحادثة: توجيه + استدعاء نموذج + moderation
  fastify.post('/v1/chat/completions', async (req, reply) => {
    const text = String(req.body?.text ?? req.body?.prompt ?? req.body?.message ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // moderation قبل التوجيه
    if (config.moderation.enabled) {
      const pre = preCheck(text, config.moderation);
      if (pre.action === 'block') return reply.code(400).send({ error: 'blocked', reason: pre.reason });
    }

    // قرار التوجيه محليًا (نفس منطق route())
    const { route } = require('./router');
    const decision = route(text, store, { cache, models: config.modelsByCategory, epsilon: config.routing.epsilon });
    // لو مكمّل بـ cache → رجّع مباشرة
    if (decision.cached && decision.value) {
      return reply.send({ ...decision, response: decision.value, source: 'cache' });
    }

    // استدعاء النموذج عبر Adapter (المفاتيح تبقى في env)
    const t0 = Date.now();
    const result = await callModel(decision.model, text, { timeoutMs: 20000 });
    const latency_ms = Date.now() - t0;

    // moderation بعد الرد
    if (config.moderation.enabled) {
      const post = postCheck(result.text, config.moderation);
      if (post.action === 'block') return reply.send({ ...decision, response: '[تم حجب الرد بسبب السياسة]', blocked: true, latency_ms });
    }

    // كاش للأسئلة البسيطة فقط
    if (decision.complexity === 'simple') {
      const { hashKey } = require('./cache');
      cache.set(hashKey(text, decision.category, decision.model), result.text);
    }

    // سجل latency للمراقبة (لا يحدّث score إلا بعد feedback)
    // push best-effort لاحقًا عند /feedback

    return reply.send({ ...decision, response: result.text, latency_ms, usage: result.usage });
  });

  // feedback يحسب quality عبر proxies
  const origFeedback = fastify.hasPlugin ? null : null; // placeholder
  // نضيف handler محسّن يحسب quality تلقائيًا
  fastify.post('/v1/feedback/auto', async (req, reply) => {
    const { category, model, latency_ms, regenerated, editedLength, originalLength, thumbsUp, thumbsDown, manualCorrection } = req.body ?? {};
    if (!category || !model) return reply.code(400).send({ error: 'category and model required' });
    const quality = estimateQuality({ regenerated, editedLength, originalLength, latency_ms, thumbsUp, thumbsDown });
    const entry = { category, model, quality_score: quality, latency_ms, regenerated, manualCorrection };
    applyFeedback(store, entry);
    await db.persistFeedback(config, { ...entry, quality_score: quality }).catch(() => {});
    await pushSummary(config, store).catch(() => {});
    return reply.send({ ok: true, quality, score: store.get(category, model) });
  });

  // تهيئة DB (best-effort)
  db.ensureSchema(config).catch(() => {});

  return fastify;
}

// Stub للاختبارات بدون fastify
function buildStubApp(store, cache, opts) {
  const routes = new Map();
  const stub = {
    store, cache, config,
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    register: async (plugin, pOpts) => {
      // يحاكي تسجيل smartRouterPlugin
      if (typeof plugin === 'function') {
        const fakeFastify = {
          post: (p, h) => routes.set(`POST ${p}`, h),
          get: (p, h) => routes.set(`GET ${p}`, h),
        };
        await plugin(fakeFastify, { store, cache, ...pOpts });
      }
    },
    hasPlugin: false,
    inject: async ({ method, url, payload }) => {
      const h = routes.get(`${method.toUpperCase()} ${url}`);
      if (!h) return { statusCode: 404, json: () => ({ error: 'not found' }) };
      let body = null, status = 200;
      const req = { body: payload, query: {}, params: {} };
      const reply = {
        code(c) { status = c; return reply; },
        send(p) { body = p; return reply; },
      };
      await h(req, reply);
      return { statusCode: status, json: () => body, body };
    },
    listen: async () => ({ address: () => 'stub://' }),
    close: async () => {},
  };
  // سجل المسارات الأساسية للـ stub
  stub.get('/health', async (req, reply) => reply.send({ ok: true, version: '0.4.0-stub' }));
  stub.post('/v1/chat/completions', async (req, reply) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });
    const { route } = require('./router');
    const decision = route(text, store, { cache, models: config.modelsByCategory });
    const result = await callModel(decision.model, text);
    return reply.send({ ...decision, response: result.text, latency_ms: result.latency_ms });
  });
  // سجل smartRouterPlugin أيضًا
  return (async () => {
    await stub.register(smartRouterPlugin, {
      store, cache,
      modelsByCategory: config.modelsByCategory,
      persistSummary: async (s) => db.persistSummary(config, s),
    });
    // feedback/auto للـ stub
    stub.post('/v1/feedback/auto', async (req, reply) => {
      const { category, model, latency_ms, regenerated, thumbsUp, thumbsDown, manualCorrection } = req.body ?? {};
      if (!category || !model) return reply.code(400).send({ error: 'category and model required' });
      const quality = estimateQuality({ regenerated, latency_ms, thumbsUp, thumbsDown });
      const entry = { category, model, quality_score: quality, latency_ms, regenerated, manualCorrection };
      applyFeedback(store, entry);
      return reply.send({ ok: true, quality, score: store.get(category, model) });
    });
    return stub;
  })();
}

if (require.main === module) {
  (async () => {
    const app = await buildApp();
    const addr = await app.listen({ host: config.host, port: config.port });
    // eslint-disable-next-line no-console
    console.log(`MSS Gateway listening on ${config.host}:${config.port} —`, addr);
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { buildApp, createStores, config };
