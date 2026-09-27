/**
 * logger.js — Performance Logger + Quality Proxies (مرحلة 3b)
 *
 * يحسب quality_score بدون طلب تقييم صريح دائمًا، ثم يحدّث ScoreStore
 * ويزامن ملخصات لـ Postgres (best-effort).
 *
 * Proxies:
 *  - regenerated: المستخدم أعاد التوليد → quality منخفض
 *  - editedShortened: المستخدم قصّر/عدّل الإجابة بشكل كبير → quality متوسط
 *  - finalLengthRatio: طول النسخة النهائية / طول الرد الأصلي → مؤشر اكتفاء
 *  - latencyPenalty: كمون عالٍ جدًا → خصم طفيف
 *  - manualCorrection: التبديل اليدوي للنموذج → إشارة مؤكدة (وزن أعلى)
 */

/**
 * يقدّر quality من الإشارات السلوكية
 * @param {{regenerated?:boolean, editedLength?:number, originalLength?:number, latency_ms?:number, thumbsUp?:boolean, thumbsDown?:boolean, codeError?:boolean, vibeError?:boolean, errorSeverity?:string}} signals
 * @returns {number} 0..1
 */
function estimateQuality(signals = {}) {
  if (signals.thumbsDown) return 0.15;
  if (signals.thumbsUp) return 0.92;
  if (signals.regenerated) return 0.25;
  // أخطاء الكود والـ Vibe Code — عقاب قوي مباشر (التحديث الجديد)
  if (signals.codeError) {
    const sev = { low: 0.35, medium: 0.18, high: 0.08, critical: 0.02 };
    return sev[signals.errorSeverity] ?? 0.12;
  }
  if (signals.vibeError) {
    const sev = { low: 0.4, medium: 0.18, high: 0.1, critical: 0.05 };
    return sev[signals.errorSeverity] ?? 0.18;
  }

  let q = 0.72; // افتراضي محايد-إيجابي

  if (signals.editedLength != null && signals.originalLength) {
    const ratio = signals.editedLength / Math.max(1, signals.originalLength);
    if (ratio < 0.35) q -= 0.22;        // قصّر كثيرًا → غير راضٍ
    else if (ratio > 0.88) q += 0.10;   // احتفظ بمعظم النص → راضٍ
    else if (ratio < 0.6) q -= 0.08;
  }

  if (signals.latency_ms != null) {
    if (signals.latency_ms > 8000) q -= 0.12;
    else if (signals.latency_ms > 4000) q -= 0.05;
  }

  return Math.max(0, Math.min(1, Number(q.toFixed(3))));
}

/**
 * يبني سجل أداء واحد
 */
function buildLogEntry({ category, model, latency_ms, quality_score, regenerated, manualCorrection, timestamp }) {
  return {
    category, model,
    latency_ms: latency_ms ?? null,
    quality_score: Math.max(0, Math.min(1, Number(quality_score))),
    regenerated: !!regenerated,
    manualCorrection: !!manualCorrection,
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

/**
 * يحدّث Store من entry ويعيد score الجديد
 */
function applyFeedback(store, entry) {
  const q = entry.quality_score ?? estimateQuality(entry);
  return store.update(entry.category, entry.model, q, {
    latency_ms: entry.latency_ms,
    regenerated: entry.regenerated,
    manualCorrection: entry.manualCorrection,
    timestamp: entry.timestamp,
  });
}

module.exports = { estimateQuality, buildLogEntry, applyFeedback };
