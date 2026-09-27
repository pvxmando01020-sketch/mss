const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { LocalCache, OfflineQueue, hashKey, shouldBypassModel } = require('../src/cache');
const { ScoreStore } = require('../src/store');

describe('LocalCache & OfflineQueue', () => {
  it('hashKey ثابت', () => {
    const k1 = hashKey('hello', 'general', 'fast-cheap');
    const k2 = hashKey('hello', 'general', 'fast-cheap');
    assert.equal(k1, k2);
    assert.equal(k1.length, 32);
  });
  it('LocalCache LRU', () => {
    const c = new LocalCache({ maxEntries: 2, ttlMs: 60000 });
    c.set('a', '1'); c.set('b', '2'); c.set('c', '3');
    assert.equal(c.size(), 2);
    assert.equal(c.get('a'), null); // طُرد
  });
  it('shouldBypassModel — ثقة ضعيفة + كود طويل', () => {
    const s = new ScoreStore(); // لا عينات → ثقة 0
    assert.equal(shouldBypassModel({ category: 'code', model: 'fast-cheap', wordCount: 80, store: s }), true);
    s.update('code', 'fast-cheap', 1.0);
    s.update('code', 'fast-cheap', 1.0);
    s.update('code', 'fast-cheap', 1.0);
    s.update('code', 'fast-cheap', 1.0);
    // بعد عينات كافية وثقة عالية → لا تجاوز
    assert.equal(shouldBypassModel({ category: 'code', model: 'fast-cheap', wordCount: 10, store: s }), false);
  });
  it('OfflineQueue يحذف بعد 5 محاولات', () => {
    const q = new OfflineQueue({ maxSize: 10 });
    const id = q.enqueue('hello', {});
    for (let i = 0; i < 5; i++) q.markFailed(id);
    assert.equal(q.length, 0);
  });
});
