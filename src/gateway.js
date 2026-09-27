/**
 * gateway.js — تكامل محرك التوجيه مع Fastify Gateway الحالي
 *
 * يفترض البنية الموجودة: Fastify + Postgres/Redis/S3
 * المفاتيح تبقى في backend — التطبيق يرسل فقط نص الطلب.
 */

const { extractFeatures } = require('./features');
const { classify, complexity } = require('./classifier');
const { DEFAULT_MODELS } = require('./store');
const { LocalCache, hashKey, shouldBypassModel } = require('./cache');

/**
 * يبني handler لـ Fastify:
 *   POST /v1/route  { text, overrideModel?, overrideCategory? }
 *   → { category, model, confidence, complexity, cached, key }
 *
 * @param {{store: import('./store').ScoreStore, cache?: import('./cache').LocalCache, modelsByCategory?: Record<string,string[]>, onProxy?: Function}} deps
 */
function buildRouteHandler(deps) {
  const store = deps.store;
  const cache = deps.cache ?? new LocalCache();
  const modelsByCategory = deps.modelsByCategory ?? Object.fromEntries(
    Object.entries(DEFAULT_MODELS).map(([cat, m]) => [cat, [m]])
  );

  return async function routeHandler(request, reply) {
    const body = request.body ?? {};
    const text = String(body.text ?? body.prompt ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // تجاوز يدوي من المستخدم — يُسجل كـ correction قوي لاحقًا
    if (body.overrideModel) {
      const f = extractFeatures(text);
      return reply.send({
        category: body.overrideCategory ?? classify(f).category,
        model: body.overrideModel,
        confidence: 1,
        complexity: complexity(f, body.overrideCategory ?? 'general'),
        cached: false,
        manual: true,
      });
    }

    const f = extractFeatures(text);
    const cls = classify(f);
    const lvl = complexity(f, cls.category);

    // استراتيجية الموارد حسب التعقيد
    let candidateModels = modelsByCategory[cls.category] ?? [DEFAULT_MODELS[cls.category]];
    if (lvl === 'simple' && cache) {
      const key = hashKey(text, cls.category, candidateModels[0]);
      const hit = cache.get(key);
      if (hit) return reply.send({ category: cls.category, model: candidateModels[0], confidence: cls.confidence, complexity: lvl, cached: true, key, value: hit });
    }

    // heuristics: تجاوز مبكر لو الثقة ضعيفة في الفئة/النموذج
    let chosen = candidateModels[0];
    if (candidateModels.length > 1 && shouldBypassModel({ category: cls.category, model: chosen, wordCount: f.wordCount, store })) {
      // اختر الأفضل حسب السجل
      const ranked = [...candidateModels].sort((a, b) => store.get(cls.category, b) - store.get(cls.category, a));
      chosen = ranked[0];
    } else if (candidateModels.length === 1) {
      // لا يوجد بديل — نحتفظ بالافتراضي
    }

    // epsilon-greedy (10% استكشاف) — لكن لا نستكشف في طلبات complex الحساسة
    if (lvl !== 'complex' && candidateModels.length > 1 && Math.random() < (store.epsilon ?? 0.1)) {
      const rest = candidateModels.filter(m => m !== chosen);
      if (rest.length) chosen = rest[Math.floor(Math.random() * rest.length)];
    }

    const total = Object.values(store.counts[cls.category] ?? {}).reduce((a, b) => a + b, 0);
    const noveltyPenalty = 1 / (1 + total);
    const confidence = Number((store.get(cls.category, chosen) * (1 - noveltyPenalty)).toFixed(3));

    // لو المستوى معقد + يوجد نموذج أقوى متاح → استخدم الأقوى
    if (lvl === 'complex' && candidateModels.includes('strong-code') && cls.category === 'code') {
      chosen = 'strong-code';
    }

    return reply.send({
      category: cls.category,
      model: chosen,
      confidence,
      complexity: lvl,
      cached: false,
      key: hashKey(text, cls.category, chosen),
      candidates: candidateModels.map(m => ({ model: m, score: store.get(cls.category, m) })),
      method: cls.method,
    });
  };
}

/**
 * تسجيل إضافة Fastify (اختياري — يعمل مع fastify.register)
 */
async function smartRouterPlugin(fastify, opts) {
  const handler = buildRouteHandler(opts);
  fastify.post('/v1/route', handler);
  fastify.post('/v1/feedback', async (req, reply) => {
    const { category, model, quality, latency_ms, regenerated, manualCorrection } = req.body ?? {};
    if (!category || !model || quality == null) return reply.code(400).send({ error: 'category, model, quality required' });
    const q = Math.max(0, Math.min(1, Number(quality)));
    opts.store.update(category, model, q, { latency_ms, regenerated, manualCorrection });
    // مزامنة ملخص لـ Postgres (best-effort)
    if (opts.persistSummary) await opts.persistSummary(opts.store.summaryForPostgres()).catch(() => {});
    return reply.send({ ok: true, score: opts.store.get(category, model) });
  });
  fastify.get('/v1/routing/stats', async (_req, reply) => reply.send(opts.store.summaryForPostgres()));
}

module.exports = { buildRouteHandler, smartRouterPlugin };
