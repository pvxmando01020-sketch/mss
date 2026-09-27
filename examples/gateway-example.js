/**
 * مثال تكامل مع Fastify Gateway الحالي
 * شغّل: node examples/gateway-example.js
 */

// محاكاة بدون تثبيت fastify — يوضح الـ wiring فقط
const { ScoreStore } = require('../src/store');
const { LocalCache } = require('../src/cache');
const { route } = require('../src/router');
const { buildRouteHandler } = require('../src/gateway');

async function demo() {
  const store = new ScoreStore({}, { epsilon: 0 });
  const cache = new LocalCache();

  // تدريب مبدئي: المستخدم فضّل claude في الكتابة الإبداعية
  store.update('creative', 'claude', 0.9, { latency_ms: 1200 });
  store.update('creative', 'claude', 0.85);
  store.update('code', 'strong-code', 0.92, { latency_ms: 1800 });

  console.log('=== قرارات التوجيه (محلي أولاً) ===\n');
  const samples = [
    'اكتب لي قصة قصيرة عن صحراء مصر',
    'def fibonacci(n):\n  if n<2: return n\n  return fibonacci(n-1)+fibonacci(n-2)',
    'لخص لي مقال عن الذكاء الاصطناعي في سطرين',
    'حلل بيانات مبيعات 2024 واستخرج الاتجاهات',
    'مرحبا، كيف حالك؟',
    'Review this Fastify middleware and suggest improvements:\n```js\nfastify.addHook("onRequest", ...)\n```',
  ];

  for (const text of samples) {
    const r = route(text, store, { cache, epsilon: 0 });
    console.log(`[${r.category}/${r.complexity}] model=${r.model} conf=${r.confidence} method=${r.method}`);
    console.log(`  "${text.slice(0, 60).replace(/\n/g,' ')}..."`);
    console.log(`  candidates: ${r.candidates.map(c=>`${c.model}:${c.score.toFixed(2)}`).join(', ')}`);
    console.log();
  }

  console.log('=== ملخص لـ Postgres ===');
  console.log(JSON.stringify(store.summaryForPostgres(), null, 2));

  console.log('\n=== محاكاة handler Fastify POST /v1/route ===');
  const handler = buildRouteHandler({ store, cache, modelsByCategory: {
    code: ['strong-code', 'fast-cheap'],
    creative: ['claude', 'fast-cheap'],
    analysis: ['accurate-math', 'claude'],
    retrieval: ['fast-cheap'],
    general: ['fast-cheap'],
  }});
  const fakeReply = { code(c){ this._c=c; return this; }, send(p){ console.log('→', JSON.stringify(p, null, 2)); } };
  await handler({ body: { text: 'اكتب لي رسالة إبداعية لعميل' } }, fakeReply);
  await handler({ body: { text: '```js\nfunction x(){}\n```' } }, fakeReply);
}

demo().catch(console.error);
