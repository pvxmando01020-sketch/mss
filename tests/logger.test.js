const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateQuality, applyFeedback } = require('../src/logger');
const { ScoreStore } = require('../src/store');

describe('logger — quality proxies', () => {
  it('thumbsUp → 0.92', () => assert.equal(estimateQuality({ thumbsUp: true }), 0.92));
  it('thumbsDown → 0.15', () => assert.equal(estimateQuality({ thumbsDown: true }), 0.15));
  it('regenerated → 0.25', () => assert.equal(estimateQuality({ regenerated: true }), 0.25));
  it('تقصير شديد يخفض الجودة', () => {
    const q1 = estimateQuality({ editedLength: 20, originalLength: 200 });
    const q2 = estimateQuality({ editedLength: 190, originalLength: 200 });
    assert.ok(q1 < q2);
  });
  it('applyFeedback يحدّث Store', () => {
    const s = new ScoreStore();
    const before = s.get('code', 'strong-code');
    applyFeedback(s, { category: 'code', model: 'strong-code', quality_score: 0.9 });
    assert.ok(s.get('code', 'strong-code') > before);
  });
});
