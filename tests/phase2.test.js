const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const db = require('../src/adapters/db');
const { _reset: resetAuth } = require('../src/phase2/services/authService');
const { _reset: resetConv } = require('../src/phase2/services/conversationService');

describe('المرحلة 2 — Auth + Conversations + Uploads', () => {
  let app;
  beforeEach(async () => {
    db._resetMemory();
    resetAuth();
    resetConv();
    app = await buildApp({ logger: false });
  });

  it('POST /v1/auth/register + /login + /me', async () => {
    const email = `test${Date.now()}@example.com`;
    const reg = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'secret123' } });
    assert.equal(reg.statusCode, 201);
    assert.equal(reg.json().user.email, email);

    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'secret123' } });
    assert.equal(login.statusCode, 200);
    assert.ok(login.json().token);
    const token = login.json().token;

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, email);

    // محاولة دخول بتوكن خاطئ → يعمل كضيف في /conversations لكن /me يتطلب auth
    const badMe = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: 'Bearer bad' } });
    // في optionalAuth قد يمر، لكن requireAuth يجب أن يمنع
    assert.equal(badMe.statusCode, 401);
  });

  it('POST /v1/auth/register — تكرار email → 409', async () => {
    const email = `dup${Date.now()}@example.com`;
    await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'secret123' } });
    const dup = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'secret123' } });
    assert.equal(dup.statusCode, 409);
  });

  it('Conversations CRUD (بدون تسجيل — ضيف)', async () => {
    const create = await app.inject({ method: 'POST', url: '/v1/conversations', payload: { title: 'محادثة اختبار' } });
    assert.equal(create.statusCode, 201);
    const convId = create.json().conversation.id;
    assert.ok(convId);

    const list = await app.inject({ method: 'GET', url: '/v1/conversations' });
    assert.equal(list.statusCode, 200);
    assert.ok(Array.isArray(list.json().conversations));
    assert.ok(list.json().conversations.some(c => c.id === convId));

    const add = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/messages`, payload: { role: 'user', content: 'مرحبا' } });
    assert.equal(add.statusCode, 201);
    assert.equal(add.json().message.content, 'مرحبا');

    const get = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}` });
    assert.equal(get.statusCode, 200);
    assert.equal(get.json().messages.length, 1);

    // chat داخل المحادثة (مرحلة 2+3)
    const chat = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/chat`, payload: { text: 'اكتب لي نكتة' } });
    assert.equal(chat.statusCode, 200);
    assert.ok(chat.json().response);
    assert.ok(chat.json().category);

    const get2 = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}` });
    assert.equal(get2.json().messages.length, 3); // user, assistant, + previous user
  });

  it('Conversations مع مستخدم مسجل — عزل بين المستخدمين', async () => {
    const email = `iso${Date.now()}@example.com`;
    await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'secret123' } });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'secret123' } });
    const token = login.json().token;

    const c1 = await app.inject({ method: 'POST', url: '/v1/conversations', payload: { title: 'خاصة' }, headers: { authorization: `Bearer ${token}` } });
    const convId = c1.json().conversation.id;

    // ضيف يحاول حذف محادثة مستخدم → 404/forbidden
    const delAnon = await app.inject({ method: 'DELETE', url: `/v1/conversations/${convId}` });
    assert.equal(delAnon.statusCode, 404);

    const delOwner = await app.inject({ method: 'DELETE', url: `/v1/conversations/${convId}`, headers: { authorization: `Bearer ${token}` } });
    assert.equal(delOwner.statusCode, 200);
  });

  it('POST /v1/uploads — JSON base64', async () => {
    const b64 = Buffer.from('hello upload').toString('base64');
    const res = await app.inject({ method: 'POST', url: '/v1/uploads', payload: { filename: 'test.txt', mime: 'text/plain', dataBase64: b64 } });
    assert.equal(res.statusCode, 201);
    assert.ok(res.json().key);
    assert.ok(res.json().persisted);
  });

  it('POST /v1/chat/completions مع conversation_id → يحفظ في المحادثة', async () => {
    const create = await app.inject({ method: 'POST', url: '/v1/conversations', payload: { title: 'with chat' } });
    const convId = create.json().conversation.id;
    const chat = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { text: 'ما هو الذكاء الاصطناعي؟', conversation_id: convId } });
    assert.equal(chat.statusCode, 200);
    const get = await app.inject({ method: 'GET', url: `/v1/conversations/${convId}` });
    // يجب أن يكون هناك رسالة assistant محفوظة
    assert.ok(get.json().messages.some(m => m.role === 'assistant'));
  });
});
