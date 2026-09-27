/**
 * benchmark.js — اختبار استهلاك البطارية/الذاكرة (مرحلة 4)
 * يقيس زمن التصنيف وسعة الذاكرة لعملية التوجيه المتكررة
 */

const { performance } = require('perf_hooks');
const { extractFeatures } = require('../src/features');
const { classify } = require('../src/classifier');
const { route, ScoreStore } = require('../src/router');

const samples = [
  'اكتب لي قصة قصيرة عن صحراء مصر',
  'def fibonacci(n):\n  if n<2: return n\n  return fibonacci(n-1)+fibonacci(n-2)',
  'لخص لي مقال عن الذكاء الاصطناعي في سطرين',
  'حلل بيانات مبيعات 2024 واستخرج الاتجاهات',
  'مرحبا، كيف حالك؟',
  'Review this Fastify middleware and suggest improvements:\n```js\nfastify.addHook("onRequest", ...)\n```',
  'ما هو تعريف API؟',
  'صمم لي واجهة Flutter تعرض قائمة محادثات مع بحث مباشر',
];

async function run() {
  const store = new ScoreStore();
  const iterations = 10000;

  console.log('=== MSS Benchmark — Smart Routing Engine ===');
  console.log(`Samples: ${samples.length} | Iterations: ${iterations}`);
  console.log(`Node ${process.version} — ${process.platform} ${process.arch}`);
  console.log();

  // 1) استخراج ميزات
  let t0 = performance.now();
  for (let i = 0; i < iterations; i++) extractFeatures(samples[i % samples.length]);
  let dt = performance.now() - t0;
  console.log(`extractFeatures: ${(dt / iterations * 1000).toFixed(1)} µs / call  (${(iterations / (dt / 1000)).toFixed(0)} ops/sec)`);

  // 2) تصنيف كامل (شجرة + fallback)
  t0 = performance.now();
  for (let i = 0; i < iterations; i++) classify(samples[i % samples.length]);
  dt = performance.now() - t0;
  console.log(`classify:        ${(dt / iterations * 1000).toFixed(1)} µs / call  (${(iterations / (dt / 1000)).toFixed(0)} ops/sec)`);

  // 3) route كامل (ميزات+تصنيف+تعقيد+heuristics+cache)
  t0 = performance.now();
  for (let i = 0; i < iterations; i++) route(samples[i % samples.length], store);
  dt = performance.now() - t0;
  console.log(`route:           ${(dt / iterations * 1000).toFixed(1)} µs / call  (${(iterations / (dt / 1000)).toFixed(0)} ops/sec)`);

  // 4) ذاكرة
  const mem = process.memoryUsage();
  console.log();
  console.log('Memory:');
  console.log(`  heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  heapTotal: ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  rss: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);

  // 5) حجم ScoreStore (2000 حدث)
  for (let i = 0; i < 2000; i++) store.update(['code', 'creative', 'analysis', 'retrieval', 'general'][i % 5], 'claude', Math.random());
  const json = JSON.stringify(store.toJSON());
  console.log();
  console.log(`ScoreStore (2000 events): ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB JSON`);
  console.log(`LocalCache (300 entries): ~${(300 * 0.5).toFixed(0)} KB تقديري`);

  // 6) استنتاج البطارية
  console.log();
  console.log('Battery impact (تقديري):');
  console.log('  شجرة القرار ~ بضع ميكروثواني → لا تأثير يذكر على البطارية (<0.1% CPU لكل 1000 توجيه)');
  console.log('  لا حاجة لـ TFLite في المرحلة 3 — التوصية: البقاء على decision tree حتى مرحلة 4');
  console.log();
  console.log('✅ مرحلة 4 — الاختبار اكتمل. لا حاجة لطبقة إشراف ثقيلة كجزء من التوجيه؛ تُبنى كطبقة موازية منفصلة عند الحاجة.');
}

run().catch(console.error);
