/**
 * learning/codeErrorLearner.js — التعلم من أخطاء الكود والـ Vibe Code (التحديث الجديد)
 *
 * الفكرة: عند فشل الكود (syntax/runtime/security/vibe) نعاقب النموذج بقوة أكبر من feedback العادي
 * ويُحتسب errorRate لكل (model, category) ليؤثر في الثقة المسبقة قبل الاستدعاء.
 *
 * يتكامل مع ScoreStore الحالي — لا يستبدله، بل يضيف طبقة تعلم ثانية.
 */

const db = require('../adapters/db');

class CodeErrorLearner {
  constructor(opts = {}) {
    this.alphaError = opts.alphaError ?? 0.4; // أعلى من alpha العادي 0.2 — أخطاء الكود حرجة
    this.alphaVibe = opts.alphaVibe ?? 0.35;
    // errorCounts: `${category}::${model}` → { total, errors, errorRate }
    this.counts = new Map();
    this.recentErrors = []; // آخر 500 خطأ
  }

  _key(category, model) { return `${category}::${model}`; }

  _ensure(category, model) {
    const k = this._key(category, model);
    if (!this.counts.has(k)) this.counts.set(k, { total: 0, errors: 0, errorRate: 0 });
    return this.counts.get(k);
  }

  /**
   * تسجيل طلب (يُستدعى عند كل استدعاء نموذج للكود)
   */
  recordRequest(category, model) {
    const c = this._ensure(category, model);
    c.total++;
    c.errorRate = c.errors / Math.max(1, c.total);
  }

  /**
   * تسجيل خطأ — يُحدث ScoreStore بقوة ويُسجل في code_errors
   * @param {import('../store').ScoreStore} store
   * @param {{category:string, model:string, errorType:string, severity:string, code_snippet?:string, vibe_context?:string, auto_detected?:boolean, user_id?:string, conversation_id?:string, message_id?:string}} err
   */
  async recordError(store, err) {
    const category = err.category || 'code';
    const model = err.model;
    const isVibe = err.category === 'vibe' || err.errorType === 'vibe_mismatch' || !!err.vibe_context;
    const alpha = isVibe ? this.alphaVibe : this.alphaError;

    // حدّث errorRate
    const c = this._ensure(category, model);
    // إذا لم يُسجل request من قبل، اعتبره request ضمني
    if (c.total === 0) c.total = 1;
    c.errors++;
    c.errorRate = c.errors / c.total;

    // quality منخفض جداً حسب severity
    const severityQ = { low: 0.35, medium: 0.18, high: 0.08, critical: 0.02 };
    const quality = severityQ[err.severity] ?? 0.12;

    // عقاب قوي في ScoreStore — manualCorrection=false لكن alpha عالي
    store.update(category, model, quality, {
      latency_ms: err.latency_ms,
      regenerated: false,
      manualCorrection: false,
      // تجاوز alpha الافتراضي بهذا التحديث الحرج
      alpha,
    });

    // احفظ محلياً
    this.recentErrors.push({ ...err, quality, timestamp: new Date().toISOString() });
    if (this.recentErrors.length > 500) this.recentErrors.shift();

    // احفظ في Postgres (best-effort)
    try {
      const pool = await db.getPool(require('../config'));
      if (pool) {
        await pool.query(
          `INSERT INTO code_errors(user_id, conversation_id, message_id, category, model, error_type, severity, code_snippet, error_message, vibe_context, auto_detected)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [err.user_id || null, err.conversation_id || null, err.message_id || null, category, model, err.errorType || 'other', err.severity || 'medium', err.code_snippet?.slice(0, 2000) || null, err.error_message?.slice(0, 1000) || null, err.vibe_context?.slice(0, 500) || null, !!err.auto_detected]
        );
        await pool.query(
          `INSERT INTO code_error_stats(model, category, total_errors, last_error_at, error_rate)
           VALUES($1,$2,1,NOW(),$3)
           ON CONFLICT (model, category) DO UPDATE SET total_errors = code_error_stats.total_errors + 1, last_error_at = NOW(), error_rate = $3`,
          [model, category, c.errorRate]
        );
      }
    } catch {}

    return { quality, errorRate: c.errorRate, alpha };
  }

  /**
   * success — عند نجاح الكود (اختبارات تمر) نخفف العقاب تدريجياً
   */
  recordSuccess(store, category, model) {
    const c = this._ensure(category, model);
    // لا نزيد errors، لكن نحدّث الثقة عبر success quality عالي
    store.update(category, model, 0.92, { alpha: 0.15 }); // success أقل وزناً من error
  }

  getErrorRate(category, model) {
    const c = this.counts.get(this._key(category, model));
    return c ? Number(c.errorRate.toFixed(3)) : 0;
  }

  /**
   * تعديل الثقة المسبقة بالـ errorRate
   * confidence_adjusted = confidence * (1 - errorRate * 0.7)
   * أخطاء كثيرة → ثقة أقل → heuristics تتجاوز النموذج مبكراً
   */
  adjustConfidence(category, model, baseConfidence) {
    const rate = this.getErrorRate(category, model);
    return Number((baseConfidence * (1 - rate * 0.7)).toFixed(3));
  }

  snapshot() {
    const obj = {};
    for (const [k, v] of this.counts) obj[k] = { ...v };
    return { counts: obj, recent: this.recentErrors.slice(-20) };
  }

  _reset() {
    this.counts.clear();
    this.recentErrors = [];
  }

  // للاختبارات — تصفير singleton
  static resetSingleton() {
    singleton._reset();
  }
}

// نسخة واحدة مشتركة (singleton) — تُستخدم في server.js
const singleton = new CodeErrorLearner();

module.exports = { CodeErrorLearner, singleton };
