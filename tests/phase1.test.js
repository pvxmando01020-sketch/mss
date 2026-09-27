const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const db = require('../src/adapters/db');
const s3 = require('../src/phase1/services/s3');
const { _reset: resetAuth } = require('../src/phase2/services/authService');
const { _reset: resetConv } = require('../src/phase2/services/conversationService');

describe('المرحلة 1 — البنية التحتية (Fastify + Postgres/Redis/S3 + محول النماذج)', () => {
  let app;
  beforeEach(async () => {
    db._resetMemory();
    s3._reset();
    resetAuth();
    resetConv();
    app = await buildApp({ logger: false });
  });

  it('GET /health → ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });

  it('GET /ready → checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().checks);
  });

  it('GET /v1/models → adapters + modelsByCategory', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/models' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().modelsByCategory);
    assert.ok(res.json().adapters || res.json().dbModels || res.json().modelsByCategory);
  });

  it('POST /v1/chat/completions — مباشر باختيار نموذج (مرحلة 1)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { prompt: 'مرحبا', model: 'fast-cheap', direct: true } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().model, 'fast-cheap');
    assert.equal(res.json().method, 'direct');
    assert.ok(res.json().response);
  });

  it('POST /v1/chat/completions — توجيه ذكي تلقائي (بدون model)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { text: 'اكتب لي قصة قصيرة' } });
    assert.equal(res.statusCode, 200);
    assert.ok(['claude','strong-code','fast-cheap'].includes(res.json().model));
    assert.ok(res.json().category);
  });

  it('POST /v1/embeddings → vector', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/embeddings', payload: { input: 'hello world' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().object, 'list');
    assert.ok(Array.isArray(res.json().data[0].embedding));
  });

  it('POST /v1/chat/completions — streaming flag', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { text: 'مرحبا', stream: true } });
    assert.equal(res.statusCode, 200);
    // في stub نعيد streamed:true، في Fastify الحقيقي نعيد SSE
    assert.ok(res.json().response || res.json().streamed || res.json().choices);
  });

  it('S3 put/get fallback memory', async () => {
    const config = require('../src/config');
    const key = `test/${Date.now()}.txt`;
    const buf = Buffer.from('hello s3');
    const put = await s3.putFile(config, key, buf, 'text/plain');
    assert.ok(put.key === key);
    const got = await s3.getFile(config, key);
    assert.ok(got && got.toString() === 'hello s3');
  });
});
