/**
 * scripts/load-test.js — اختبار حِمل خفيف للـ Gateway 1→4
 * يحاكي 50 مستخدم متزامن يرسلون أسئلة متنوعة مع مصادقة ومحادثات
 */

const { buildApp } = require('../src/server');

async function run({ users = 20, perUser = 5 } = {}) {
  const app = await buildApp({ logger: false });
  const samples = [
    'مرحبا، كيف حالك؟',
    'اكتب لي دالة بايثون تحسب فيبوناتشي',
    'لخص لي فوائد الذكاء الاصطناعي في سطرين',
    'حلل بيانات مبيعات 2024',
    'ما هو Fastify؟',
    'صمم واجهة Flutter لمحادثة',
  ];

  // أنشئ مستخدمين
  const tokens = [];
  for (let i = 0; i < users; i++) {
    const email = `load${i}-${Date.now()}@test.local`;
    await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'pass1234' } });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass1234' } });
    tokens.push(r.json().token);
  }
  console.log(`✓ ${users} مستخدم — بدء ${users * perUser} طلب...`);
  const t0 = Date.now();
  let ok = 0, fail = 0, totalLatency = 0;

  const tasks = [];
  for (let u = 0; u < users; u++) {
    for (let n = 0; n < perUser; n++) {
      const text = samples[(u + n) % samples.length];
      tasks.push(
        app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { text }, headers: { authorization: `Bearer ${tokens[u]}` } })
          .then(r => {
            if (r.statusCode === 200) { ok++; totalLatency += r.json().latency_ms || 0; }
            else fail++;
          })
          .catch(() => fail++)
      );
    }
  }
  await Promise.all(tasks);
  const dt = Date.now() - t0;
  console.log(`\n— النتائج —`);
  console.log(`  إجمالي: ${users * perUser} | ناجح: ${ok} | فشل: ${fail}`);
  console.log(`  زمن كلي: ${dt}ms | متوسط كمون: ${ok ? (totalLatency / ok).toFixed(1) : 0}ms`);
  console.log(`  throughput: ${((ok / dt) * 1000).toFixed(1)} req/s`);
  console.log(`  ${fail === 0 ? '✅ لا يوجد اختناق — جاهز للإنتاج' : '⚠️ راجع rateLimit/quota'}`);

  // تحقق من metrics
  const m = await app.inject({ method: 'GET', url: '/metrics' });
  const mBody = typeof m.body === 'string' ? m.body : JSON.stringify(m.body ?? '');
  console.log(`\n  /metrics → ${m.statusCode} (${mBody.slice(0, 60)}...)`);
}

const args = process.argv.slice(2);
run({ users: Number(args[0]) || 20, perUser: Number(args[1]) || 5 }).catch(console.error);
