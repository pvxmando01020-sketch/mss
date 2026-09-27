/**
 * store.js — تتبع الأداء والتعلم المستمر (مرحلة 3b)
 *
 * هيكل السجل (SQLite محليًا، ملخصات لـ Postgres):
 *   { category, model, latency_ms, quality_score, regenerated, timestamp }
 *
 * تحديث الأوزان: bandit بسيط epsilon-greedy
 *   score[c][m] = (1-α)*score[c][m] + α*quality
 *   اختيار: 90% الأعلى score، 10% استكشاف
 *
 * لا يحتاج RL ثقيل على الهاتف — online update فقط.
 */

const CATEGORIES = ['code', 'creative', 'analysis', 'retrieval', 'general'];

// النماذج الافتراضية المبدئية — قابلة للتعديل تلقائيًا من السجل، ليست ثابتة
const DEFAULT_MODELS = {
  code: 'strong-code',
  creative: 'claude',
  analysis: 'accurate-math',
  retrieval: 'fast-cheap',
  general: 'fast-cheap',
};

class ScoreStore {
  /**
   * @param {Record<string, Record<string, number>>} seed — أوزان أولية اختيارية
   * @param {{alpha?:number, epsilon?:number}} opts
   */
  constructor(seed = {}, opts = {}) {
    this.alpha = opts.alpha ?? 0.2;
    this.epsilon = opts.epsilon ?? 0.1;
    /** @type {Record<string, Record<string, number>>} */
    this.scores = {};
    /** @type {Record<string, Record<string, number>>} */
    this.counts = {};
    /** @type {Array<object>} سجل خام (آخر 2000 حدث) */
    this.log = [];

    for (const c of CATEGORIES) {
      this.scores[c] = {};
      this.counts[c] = {};
      // تهيئة كل النماذج المعروفة لكل فئة بقيمة محايدة 0.5
      const models = new Set(Object.values(DEFAULT_MODELS));
      for (const m of models) this._ensure(c, m);
    }
    for (const [cat, models] of Object.entries(seed)) {
      for (const [model, val] of Object.entries(models)) this.set(cat, model, val);
    }
  }

  _ensure(category, model) {
    if (!this.scores[category]) { this.scores[category] = {}; this.counts[category] = {}; }
    if (this.scores[category][model] === undefined) this.scores[category][model] = 0.5;
    if (this.counts[category][model] === undefined) this.counts[category][model] = 0;
  }

  set(category, model, value) {
    this._ensure(category, model);
    this.scores[category][model] = Math.max(0, Math.min(1, Number(value)));
  }

  get(category, model) {
    this._ensure(category, model);
    return this.scores[category][model];
  }

  count(category, model) {
    this._ensure(category, model);
    return this.counts[category][model];
  }

  /**
   * تحديث بعد كل تفاعل
   * @param {string} category
   * @param {string} model
   * @param {number} quality — 0..1 (من 👍👎 أو proxies)
   * @param {{latency_ms?:number, regenerated?:boolean, alpha?:number, timestamp?:string}} meta
   */
  update(category, model, quality, meta = {}) {
    this._ensure(category, model);
    const q = Math.max(0, Math.min(1, Number(quality)));
    const a = meta.alpha ?? this.alpha;
    // correction قوية عند التبديل اليدوي: alpha أعلى
    const alphaEff = meta.manualCorrection ? Math.min(0.6, a * 2.5) : a;
    this.scores[category][model] = (1 - alphaEff) * this.scores[category][model] + alphaEff * q;
    this.counts[category][model]++;

    this.log.push({
      category, model,
      latency_ms: meta.latency_ms ?? null,
      quality_score: q,
      regenerated: !!meta.regenerated,
      manualCorrection: !!meta.manualCorrection,
      timestamp: meta.timestamp ?? new Date().toISOString(),
    });
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
    return this.scores[category][model];
  }

  /**
   * اختيار epsilon-greedy
   * @param {string} category
   * @param {string[]} candidates
   * @param {{epsilon?:number}} opts
   */
  pick(category, candidates, opts = {}) {
    const eps = opts.epsilon ?? this.epsilon;
    const ranked = [...candidates].sort((a, b) => this.get(category, b) - this.get(category, a));
    if (Math.random() < eps && ranked.length > 1) {
      // استكشاف: اختر عشوائيًا من غير الأفضل
      const rest = ranked.slice(1);
      return rest[Math.floor(Math.random() * rest.length)];
    }
    return ranked[0];
  }

  /**
   * ثقة مسبقة قبل الاستدعاء — تستخدم novelty_penalty
   * confidence = score * (1 - novelty_penalty)
   * novelty_penalty = 1 / (1 + totalSamplesForCategory)
   */
  confidence(category, model) {
    this._ensure(category, model);
    const total = Object.values(this.counts[category]).reduce((a, b) => a + b, 0);
    const noveltyPenalty = 1 / (1 + total);
    return Number((this.get(category, model) * (1 - noveltyPenalty)).toFixed(3));
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      scores: this.scores,
      counts: this.counts,
      alpha: this.alpha,
      epsilon: this.epsilon,
    }));
  }

  /** ملخص مجمع للإرسال إلى Postgres (لا يرسل السجل الخام كاملاً) */
  summaryForPostgres() {
    const summary = {};
    for (const cat of Object.keys(this.scores)) {
      summary[cat] = {};
      for (const [model, score] of Object.entries(this.scores[cat])) {
        summary[cat][model] = { score: Number(score.toFixed(3)), samples: this.counts[cat][model] };
      }
    }
    // إحصاءات إضافية
    const totalEvents = this.log.length;
    const regenRate = totalEvents ? this.log.filter(e => e.regenerated).length / totalEvents : 0;
    return { summary, totalEvents, regenRate: Number(regenRate.toFixed(3)), generatedAt: new Date().toISOString() };
  }

  /** استيراد ملخص من Postgres (للمزامنة عبر أجهزة) */
  mergeSummary(summaryObj) {
    const src = summaryObj.summary ?? summaryObj;
    for (const [cat, models] of Object.entries(src)) {
      for (const [model, info] of Object.entries(models)) {
        const val = typeof info === 'number' ? info : info.score;
        if (typeof val === 'number') this.set(cat, model, val);
      }
    }
  }

  /** تحميل/حفظ JSON — يستخدم كـ SQLite مبسط على الجهاز */
  toJSON() { return { scores: this.scores, counts: this.counts, log: this.log.slice(-500) }; }
  static fromJSON(data, opts) {
    const s = new ScoreStore({}, opts);
    if (data?.scores) s.scores = data.scores;
    if (data?.counts) s.counts = data.counts;
    if (Array.isArray(data?.log)) s.log = data.log;
    return s;
  }
}

module.exports = { ScoreStore, DEFAULT_MODELS, CATEGORIES };
