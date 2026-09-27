/**
 * adapters/modelAdapter.js — محول النماذج (Claude/Gemini/Kimi/...)
 * يوحّد استدعاء النماذج عبر Gateway. في هذا المستودع يعمل كـ stub قابل للتوسعة
 * بدون مفاتيح حقيقية — يعود برد تجريبي مع latency مصطنعة.
 */

const adapters = {
  'claude':      { label: 'Claude',   kind: 'creative',  latency: 1200 },
  'strong-code': { label: 'Strong-Code', kind: 'code', latency: 1800 },
  'accurate-math':{ label: 'Accurate-Math', kind: 'analysis', latency: 1500 },
  'fast-cheap':  { label: 'Fast-Cheap', kind: 'retrieval', latency: 600 },
  'gemini':      { label: 'Gemini', kind: 'general', latency: 1100 },
  'kimi':        { label: 'Kimi', kind: 'general', latency: 1000 },
};

/**
 * استدعاء نموذج واحد مع retry/fallback كما هو موجود في Gateway
 * @param {string} model
 * @param {string} text
 * @param {{timeoutMs?:number, retries?:number}} opts
 */
async function callModel(model, text, opts = {}) {
  const meta = adapters[model] ?? adapters['fast-cheap'];
  const start = Date.now();
  // محاكاة تأخير الشبكة/الاستدلال
  const delay = Math.min(opts.timeoutMs ?? 15000, meta.latency + Math.floor(Math.random() * 400));
  await new Promise(r => setTimeout(r, Math.min(delay, 30))); // سريع في الاختبارات (30ms max) — في الإنتاج استخدم delay الحقيقي
  const latency_ms = Date.now() - start;

  // رد تجريبي — في الإنتاج استبدل بـ fetch الحقيقي لـ Anthropic/Google/Moonshot
  // المفاتيح تبقى في env على الخادم فقط
  const snippet = text.slice(0, 80).replace(/\n/g, ' ');
  return {
    model,
    label: meta.label,
    text: `[${meta.label}] رد تجريبي على: "${snippet}..."`,
    latency_ms,
    usage: { prompt_tokens: Math.ceil(text.length / 4), completion_tokens: 120 },
  };
}

/**
 * استدعاء مزدوج للمقارنة (لحالات complex فقط)
 */
async function callTwoForComparison(models, text) {
  if (!models || models.length < 2) return [await callModel(models[0], text)];
  const [a, b] = await Promise.all([callModel(models[0], text), callModel(models[1], text)]);
  return [a, b];
}

function listModels() { return Object.keys(adapters); }

module.exports = { adapters, callModel, callTwoForComparison, listModels };
