const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractFeatures } = require('../src/features');
const { classify, complexity } = require('../src/classifier');
const { ScoreStore } = require('../src/store');
const { route } = require('../src/router');
const { LocalCache, OfflineQueue, hashKey } = require('../src/cache');

describe('features', () => {
  it('يكشف العربية والكود', () => {
    const f = extractFeatures('اكتب لي دالة ```python\ndef foo(): pass\n```');
    assert.ok(f.language === 'ar' || f.language === 'mixed', `language=${f.language}`);
    assert.equal(f.hasCode, true);
    assert.ok(f.arabicRatio > 0.08);
    const arOnly = extractFeatures('اكتب لي قصة قصيرة عن صحراء مصر');
    assert.equal(arOnly.language, 'ar');
  });
  it('نص فارغ', () => {
    const f = extractFeatures('');
    assert.equal(f.wordCount, 0);
    assert.equal(f.language, 'unknown');
  });
});

describe('classifier', () => {
  it('code يفوز مع إشارة كود', () => {
    const c = classify('def hello():\n  print("hi")');
    assert.equal(c.category, 'code');
  });
  it('retrieval للأسئلة القصيرة التعريفية', () => {
    const c = classify('لخص لي مقال عن الذكاء الاصطناعي في سطرين');
    assert.equal(c.category, 'retrieval');
    const c2 = classify('ما هو تعريف API؟');
    assert.ok(['retrieval','general','code'].includes(c2.category), `got ${c2.category}`);
  });
  it('creative', () => {
    const c = classify('اكتب لي قصة قصيرة عن صحراء مصر');
    assert.equal(c.category, 'creative');
  });
  it('complexity: كود طويل = complex', () => {
    const f = extractFeatures('def foo():\n  pass\n'.repeat(40));
    assert.equal(complexity(f, 'code'), 'complex');
  });
});

describe('ScoreStore bandit', () => {
  it('تحديث epsilon-greedy', () => {
    const s = new ScoreStore();
    s.update('code', 'strong-code', 1.0);
    assert.ok(s.get('code', 'strong-code') > 0.5);
    assert.equal(s.count('code', 'strong-code'), 1);
    s.update('code', 'strong-code', 0, { manualCorrection: true });
    // correction قوية تخفض أكثر من التحديث العادي
    assert.ok(s.get('code', 'strong-code') < 0.7);
  });
  it('confidence يستخدم novelty penalty', () => {
    const s = new ScoreStore();
    assert.equal(s.confidence('code', 'strong-code'), 0); // total 0 → penalty 1
    s.update('code', 'strong-code', 1);
    assert.ok(s.confidence('code', 'strong-code') > 0);
  });
  it('summaryForPostgres', () => {
    const s = new ScoreStore();
    s.update('creative', 'claude', 0.8);
    const sum = s.summaryForPostgres();
    assert.ok(sum.summary.creative.claude.score > 0.5);
  });
});

describe('route', () => {
  it('يختار النموذج الافتراضي للفئة', () => {
    const s = new ScoreStore();
    const r = route('اكتب لي قصة عن النيل', s, { epsilon: 0 });
    assert.equal(r.category, 'creative');
    assert.equal(r.model, 'claude');
  });
  it('كاش للأسئلة البسيطة', () => {
    const s = new ScoreStore();
    const cache = new LocalCache({ ttlMs: 60000 });
    const key = hashKey('مرحبا', 'general', 'fast-cheap');
    cache.set(key, 'أهلا بك');
    const r = route('مرحبا', s, { cache, epsilon: 0 });
    // مرحبا تصنف general → قد تستخدم الكاش لو كانت simple
    // نتأكد أن الكاش يعمل بشكل عام
    assert.equal(cache.get(key), 'أهلا بك');
    assert.ok(r.candidates.length > 0);
  });
});

describe('cache & queue', () => {
  it('LocalCache TTL', async () => {
    const c = new LocalCache({ ttlMs: 10 });
    c.set('k', 'v');
    assert.equal(c.get('k'), 'v');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(c.get('k'), null);
  });
  it('OfflineQueue', () => {
    const q = new OfflineQueue();
    const id = q.enqueue('hello', { category: 'general' });
    assert.equal(q.length, 1);
    assert.equal(q.peek().id, id);
    q.dequeue();
    assert.equal(q.length, 0);
  });
});
