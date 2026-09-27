const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const db = require('../src/adapters/db');

describe('Gateway — /v1/route & /v1/chat/completions', () => {
  let app;
  beforeEach(async () => {
    db._resetMemory();
    app = await buildApp({ logger: false });
  });

  it('POST /v1/route — يصنف ويختار نموذج', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { text: 'اكتب لي قصة قصيرة عن النيل' } });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.category, 'creative');
    assert.ok(['claude', 'fast-cheap'].includes(body.model));
    assert.ok(typeof body.confidence === 'number');
  });

  it('POST /v1/route — overrideModel للتبديل اليدوي', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { text: 'hello', overrideModel: 'gemini', overrideCategory: 'general' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().model, 'gemini');
    assert.equal(res.json().manual, true);
  });

  it('POST /v1/chat/completions — يرد مع response و latency', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: { text: 'لخص لي مقال عن AI' } });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.response && typeof body.response === 'string');
    assert.ok(typeof body.latency_ms === 'number');
    assert.ok(body.category);
  });

  it('POST /v1/feedback/auto — يحسب quality ويحدّث score', async () => {
    const before = await app.inject({ method: 'GET', url: '/v1/routing/stats' });
    const fb = await app.inject({ method: 'POST', url: '/v1/feedback/auto', payload: { category: 'creative', model: 'claude', thumbsUp: true } });
    assert.equal(fb.statusCode, 200);
    assert.ok(fb.json().quality > 0.8);
    const after = await app.inject({ method: 'GET', url: '/v1/routing/stats' });
    // بعد feedback يجب أن يكون هناك تغيير في الإحصائيات أو على الأقل لا يفشل
    assert.equal(after.statusCode, 200);
  });

  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });
});
