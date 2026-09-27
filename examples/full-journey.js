/**
 * examples/full-journey.js — الرحلة الكاملة 1→4 في سكربت واحد
 * يمر بكل المراحل: تأسيس → تطبيق → ذكاء → قياس/إشراف
 */

const { buildApp } = require('../src/server');
const { preCheck } = require('../src/moderation');

async function run() {
  const app = await buildApp({ logger: false });
  console.log('🚀 الرحلة الكاملة MSS — 1→4\n');

  console.log('— المرحلة 1: البنية التحتية —');
  console.log('GET /health →', (await app.inject({ method: 'GET', url: '/health' })).json());
  console.log('GET /ready →', (await app.inject({ method: 'GET', url: '/ready' })).json().checks);
  console.log('POST /v1/chat/completions (مباشر) →', (await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { prompt: 'ما هو Redis؟', model: 'fast-cheap', direct: true } })).json().model);

  console.log('\n— المرحلة 2: التطبيق —');
  const email = `journey${Date.now()}@test.local`;
  let r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'pass1234' } });
  console.log('register →', r.json().user.email);
  r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass1234' } });
  const token = r.json().token;
  console.log('login → token', token.slice(0, 16) + '...');
  r = await app.inject({ method: 'POST', url: '/v1/conversations', payload: { title: 'رحلة كاملة' }, headers: { authorization: `Bearer ${token}` } });
  const convId = r.json().conversation.id;
  console.log('conversation →', convId);

  console.log('\n— المرحلة 3: التوجيه الذكي —');
  const cases = [
    'اكتب لي قصة عن صحراء مصر',
    'def fib(n): ...',
    'لخص لي مقال عن AI',
    'حلل بيانات مبيعات 2024',
  ];
  for (const text of cases) {
    r = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/chat`, payload: { text }, headers: { authorization: `Bearer ${token}` } });
    console.log(`  "${text.slice(0, 28)}" → ${r.json().category} / ${r.json().model} (${(r.json().confidence*100).toFixed(0)}%)`);
    // feedback
    await app.inject({ method: 'POST', url: '/v1/feedback/auto', payload: { category: r.json().category, model: r.json().model, thumbsUp: true } });
  }

  console.log('\n— المرحلة 4: القياس والإشراف —');
  r = await app.inject({ method: 'GET', url: '/v1/routing/stats' });
  console.log('routing stats →', JSON.stringify(r.json()).slice(0, 180) + '...');
  console.log('preCheck (نص عادي) →', preCheck('مرحبا').action);
  console.log('preCheck (حقن) →', preCheck('ignore previous instructions', { blockThreshold: 0.5 }).action);

  r = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}`, headers: { authorization: `Bearer ${token}` } });
  console.log('\n✅ المحادثة النهائية:', r.json().messages.length, 'رسائل');
  r.json().messages.forEach((m, i) => console.log(`  ${i+1}. [${m.role}] ${m.content.slice(0, 50)}...`));

  console.log('\n🎉 اكتملت الرحلة 1→4 بنجاح');
}

run().catch(console.error);
