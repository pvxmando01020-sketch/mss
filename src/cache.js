/**
 * cache.js — كاش محلي + طابور offline (للمرحلة 3c)
 *
 * يبقى على الجهاز: التصنيف، heuristics، سجل الأداء، الكاش.
 * يُرسل فقط: نص الطلب النهائي عبر Gateway (المفاتيح تبقى في backend).
 */

const crypto = require('crypto');

function hashKey(text, category, model) {
  return crypto.createHash('sha256').update(`${category}::${model}::${text.trim().toLowerCase().slice(0, 2000)}`).digest('hex').slice(0, 32);
}

class LocalCache {
  /**
   * @param {{maxEntries?:number, ttlMs?:number}} opts
   */
  constructor(opts = {}) {
    this.maxEntries = opts.maxEntries ?? 300;
    this.ttlMs = opts.ttlMs ?? 1000 * 60 * 60 * 6; // 6 ساعات
    this.map = new Map(); // key -> {value, expiresAt, hits}
  }
  _prune() {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expiresAt < now) this.map.delete(k);
    while (this.map.size > this.maxEntries) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) { this.map.delete(key); return null; }
    e.hits++;
    // LRU: أعد الإدراج
    this.map.delete(key); this.map.set(key, e);
    return e.value;
  }
  set(key, value, ttlMs) {
    this._prune();
    this.map.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs), hits: 0 });
    this._prune();
  }
  has(key) { return !!this.get(key); }
  size() { return this.map.size; }
  clear() { this.map.clear(); }
}

/**
 * طابور محلي للاتصال المتقطع — يخزن الرسائل غير المرسلة
 * ويعيد محاولة الإرسال عند عودة الشبكة.
 */
class OfflineQueue {
  constructor(opts = {}) {
    this.maxSize = opts.maxSize ?? 100;
    this.items = []; // {id, text, meta, attempts, createdAt}
  }
  enqueue(text, meta = {}) {
    if (this.items.length >= this.maxSize) this.items.shift();
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const entry = { id, text: String(text), meta, attempts: 0, createdAt: new Date().toISOString() };
    this.items.push(entry);
    return id;
  }
  peek() { return this.items[0] ?? null; }
  dequeue() { return this.items.shift() ?? null; }
  markFailed(id) {
    const it = this.items.find(x => x.id === id);
    if (it) it.attempts++;
    // بعد 5 محاولات نحذف لتفادي انسداد الطابور
    if (it && it.attempts >= 5) this.items = this.items.filter(x => x.id !== id);
  }
  get length() { return this.items.length; }
  toJSON() { return this.items; }
  static fromJSON(arr) { const q = new OfflineQueue(); q.items = Array.isArray(arr) ? arr : []; return q; }
}

/**
 * تقدير جودة مسبق (heuristics) قبل الاستدعاء الفعلي
 * - لو الفئة برمجة + السجل ضعيف → تجاوز لنموذج بديل قبل الاستدعاء
 */
function shouldBypassModel({ category, model, wordCount, store, threshold = 0.52 }) {
  const score = store.get(category, model);
  const total = Object.values(store.counts[category] ?? {}).reduce((a, b) => a + b, 0);
  const noveltyPenalty = 1 / (1 + total);
  const confidence = score * (1 - noveltyPenalty);
  if (category === 'code' && wordCount > 60 && confidence < threshold) return true;
  if (confidence < 0.32 && total < 4) return true;
  return false;
}

module.exports = { LocalCache, OfflineQueue, hashKey, shouldBypassModel };
