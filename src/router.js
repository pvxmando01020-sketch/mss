/**
 * router.js — واجهة موحدة لمحرك التوجيه (تُحافظ على التوافق مع الإصدار 0.1 + توسّعه)
 *
 * الاستخدام السريع:
 *   const { route, ScoreStore } = require('./router');
 *   const r = route('اكتب لي دالة تحسب فيبوناتشي', store);
 *
 * يعتمد على: features.js + classifier.js + store.js + cache.js
 */

const { extractFeatures } = require('./features');
const { classify, complexity, CATEGORIES } = require('./classifier');
const { ScoreStore, DEFAULT_MODELS } = require('./store');
const { LocalCache, OfflineQueue, hashKey, shouldBypassModel } = require('./cache');

// كاش افتراضي مشترك (يبقى في الذاكرة — في Flutter يُستبدل بـ SQLite)
const defaultCache = new LocalCache({ maxEntries: 300 });

/**
 * القرار الكامل للتوجيه — محلي أولاً
 * @param {string} input
 * @param {ScoreStore} store
 * @param {{
 *   models?: Record<string,string[]>,
 *   cache?: LocalCache|null,
 *   useCache?:boolean,
 *   epsilon?:number
 * }} options
 */
function route(input, store = new ScoreStore(), options = {}) {
  const f = extractFeatures(input);
  const cls = classify(f);
  const lvl = complexity(f, cls.category);

  const modelsByCat = options.models ?? Object.fromEntries(
    Object.entries(DEFAULT_MODELS).map(([k, v]) => [k, [v]])
  );
  const candidates = modelsByCat[cls.category] ?? [DEFAULT_MODELS[cls.category]];

  // كاش محلي للأسئلة البسيطة/المتكررة
  const cache = options.cache === null ? null : (options.cache ?? defaultCache);
  const useCache = options.useCache !== false && lvl === 'simple' && cache;
  if (useCache) {
    const key = hashKey(f.text, cls.category, candidates[0]);
    const hit = cache.get(key);
    if (hit != null) {
      return {
        category: cls.category,
        complexity: lvl,
        model: candidates[0],
        confidence: cls.confidence,
        cached: true,
        key,
        value: hit,
        features: f,
        candidates: candidates.map(m => ({ model: m, score: store.get(cls.category, m), samples: store.count(cls.category, m) })),
        method: cls.method,
      };
    }
  }

  // ranking حسب السجل
  const ranked = candidates.map(model => ({
    model,
    score: store.get(cls.category, model),
    samples: store.count(cls.category, model),
  })).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const total = ranked.reduce((n, x) => n + x.samples, 0);
  const noveltyPenalty = 1 / (1 + total);
  const confidence = Number((best.score * (1 - noveltyPenalty)).toFixed(3));

  // heuristics: تجاوز مبكر لو الثقة ضعيفة
  let chosen = best;
  if (candidates.length > 1 && shouldBypassModel({ category: cls.category, model: best.model, wordCount: f.wordCount, store })) {
    chosen = ranked[0]; // ranked بالفعل مرتب — لكن في المستقبل قد نختار ثاني أفضل
  }

  // epsilon-greedy (لا نستكشف في complex)
  if (lvl !== 'complex' && ranked.length > 1 && Math.random() < (options.epsilon ?? store.epsilon ?? 0.1)) {
    const rest = ranked.slice(1);
    chosen = rest[Math.floor(Math.random() * rest.length)];
  }

  // حالة complex + كود/vibe → الأقوى
  if (lvl === 'complex' && (cls.category === 'code' || cls.category === 'vibe') && candidates.includes('strong-code')) {
    const strong = ranked.find(r => r.model === 'strong-code');
    if (strong) chosen = strong;
  }

  // تعديل الثقة بمعدل أخطاء الكود/Vibe (التحديث الجديد) — نفس منطق gateway.js
  try {
    const { singleton } = require('./learning/codeErrorLearner');
    const adj = singleton.adjustConfidence(cls.category, chosen.model, confidence);
    if (adj < confidence * 0.6 && candidates.length > 1) {
      const rankedByError = [...candidates].sort((a,b) => singleton.getErrorRate(cls.category, a) - singleton.getErrorRate(cls.category, b));
      if (singleton.getErrorRate(cls.category, rankedByError[0]) < singleton.getErrorRate(cls.category, chosen.model)) {
        const alt = ranked.find(r => r.model === rankedByError[0]);
        if (alt) chosen = alt;
      }
    }
  } catch {}

  const explored = chosen.model !== best.model;

  return {
    category: cls.category,
    complexity: lvl,
    model: chosen.model,
    confidence,
    explored,
    cached: false,
    key: hashKey(f.text, cls.category, chosen.model),
    features: f,
    candidates: ranked,
    method: cls.method,
    probs: cls.probs,
  };
}

// تصدير كل الواجهات — للاستخدام في Gateway و Flutter
module.exports = {
  CATEGORIES,
  DEFAULT_MODELS,
  ScoreStore,
  LocalCache,
  OfflineQueue,
  extractFeatures,
  // أسماء بديلة للتوافق
  features: extractFeatures,
  classify,
  complexity,
  route,
  hashKey,
  shouldBypassModel,
};
