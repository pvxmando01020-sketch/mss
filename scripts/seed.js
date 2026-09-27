/**
 * scripts/seed.js — تهيئة بيانات تجريبية للرحلات 1+2
 * ينشئ مستخدم تجريبي + محادثات + ملخص توجيه
 * يعمل مع Postgres أو memory fallback
 */

const { buildApp } = require('../src/server');

async function seed() {
  const app = await buildApp({ logger: false });
  console.log('🌱 تهيئة MSS — الرحلة 1+2 + 3...');

  // مستخدم تجريبي
  let r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'demo@mss.local', password: 'demo1234' } });
  if (r.statusCode === 409) {
    console.log('  → المستخدم demo@mss.local موجود مسبقاً');
  } else {
    console.log('  ✓ مستخدم:', r.json().user.email);
  }

  r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'demo@mss.local', password: 'demo1234' } });
  const token = r.json().token;
  console.log('  ✓ token:', token.slice(0, 20) + '...');

  // محادثة تجريبية
  r = await app.inject({ method: 'POST', url: '/v1/conversations', payload: { title: 'محادثة ترحيبية' }, headers: { authorization: `Bearer ${token}` } });
  const convId = r.json().conversation.id;
  console.log('  ✓ محادثة:', convId);

  // رسائل + توجيه ذكي
  const samples = [
    'مرحبا، كيف حالك؟',
    'اكتب لي دالة بايثون تحسب فيبوناتشي',
    'لخص لي فوائد الذكاء الاصطناعي',
  ];
  for (const text of samples) {
    r = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/chat`, payload: { text }, headers: { authorization: `Bearer ${token}` } });
    console.log(`  → "${text.slice(0, 30)}..." → [${r.json().category}/${r.json().model}]`);
    // feedback إيجابي
    await app.inject({ method: 'POST', url: '/v1/feedback/auto', payload: { category: r.json().category, model: r.json().model, thumbsUp: true } });
  }

  r = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}`, headers: { authorization: `Bearer ${token}` } });
  console.log(`  ✓ المحادثة الآن بها ${r.json().messages.length} رسائل`);

  r = await app.inject({ method: 'GET', url: '/v1/routing/stats' });
  console.log('  ✓ إحصائيات التوجيه:', JSON.stringify(r.json().summary || r.json()).slice(0, 200) + '...');

  console.log('\n✅ اكتملت التهيئة — جرّب: npm start ثم افتح http://localhost:3000/health');
  console.log('   حساب تجريبي: demo@mss.local / demo1234');
}

seed().catch(e => { console.error(e); process.exit(1); });
