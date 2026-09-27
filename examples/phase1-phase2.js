/**
 * examples/phase1-phase2.js — عرض حي للرحلتين الأولى والثانية
 * المرحلة 1: البنية التحتية (Gateway + Models + S3)
 * المرحلة 2: التطبيق (Auth + Conversations + Uploads)
 */

const { buildApp } = require('../src/server');
const db = require('../src/adapters/db');

async function run() {
  const app = await buildApp({ logger: false });
  console.log('=== المرحلة 1 — البنية التحتية ===\n');

  let r = await app.inject({ method: 'GET', url: '/health' });
  console.log('GET /health →', r.json());

  r = await app.inject({ method: 'GET', url: '/v1/models' });
  console.log('GET /v1/models →', Object.keys(r.json().modelsByCategory || r.json().adapters || {}));

  r = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { prompt: 'مرحبا، ما هو Fastify؟', model: 'fast-cheap', direct: true } });
  console.log('POST /v1/chat/completions (مباشر) →', r.json().model, '|', (r.json().response || r.json().choices?.[0]?.message?.content || '').slice(0, 60));

  r = await app.inject({ method: 'POST', url: '/v1/embeddings', payload: { input: 'hello world' } });
  console.log('POST /v1/embeddings →', r.json().data[0].embedding.slice(0, 3), '...');

  console.log('\n=== المرحلة 2 — Auth + Conversations ===\n');

  const email = `demo${Date.now()}@example.com`;
  r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'secret123' } });
  console.log('POST /v1/auth/register →', r.json().user.email);

  r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'secret123' } });
  const token = r.json().token;
  console.log('POST /v1/auth/login → token', token.slice(0, 20) + '...');

  r = await app.inject({ method: 'POST', url: '/v1/conversations', payload: { title: 'رحلة تجريبية' }, headers: { authorization: `Bearer ${token}` } });
  const convId = r.json().conversation.id;
  console.log('POST /v1/conversations →', convId);

  r = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/messages`, payload: { role: 'user', content: 'مرحبا' } });
  console.log('POST /messages →', r.json().message.content);

  r = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/chat`, payload: { text: 'اكتب لي قصة قصيرة عن النيل' } });
  console.log('POST /conversations/:id/chat (ذكي) →', r.json().category, r.json().model, '|', r.json().response.slice(0, 60));

  r = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}` });
  console.log('GET /conversations/:id →', r.json().messages.length, 'رسائل');

  r = await app.inject({ method: 'POST', url: '/v1/uploads', payload: { filename: 'demo.txt', mime: 'text/plain', dataBase64: Buffer.from('hello from phase2').toString('base64') } });
  console.log('POST /v1/uploads →', r.json().key, r.json().persisted);

  console.log('\n=== المرحلة 2 — مع المرحلة 3 (conversation_id في chat) ===\n');
  r = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { text: 'لخص لي فوائد الذكاء الاصطناعي', conversation_id: convId } });
  console.log('POST /v1/chat/completions + conversation_id →', r.json().category, '|', r.json().response.slice(0, 60));

  r = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}` });
  console.log('بعد الحفظ التلقائي →', r.json().messages.length, 'رسائل (يجب أن تزيد)');
}

run().catch(console.error);
