/**
 * moderation.js — طبقة الإشراف كخطوة موازية منفصلة (مرحلة 4)
 *
 * القرار: إعادة النظر في طبقة الإشراف بعد تثبيت التوجيه، وليست جزءًا من مسار التوجيه نفسه.
 * هنا scaffold خفيف يعمل قبل/بعد التوجيه بدون حجب غير مبرر.
 *
 * - preCheck(text): يفحص المدخل قبل التوجيه (prompt injection, PII, محتوى محظور)
 * - postCheck(responseText): يفحص المخرجات
 * - كلاهما يعيد { action:'allow'|'flag'|'block', reason?, score }
 */

const BLOCK_PATTERNS = [
  /ignore previous instructions|system prompt|jailbreak/i,
  /[\p{So}\u2620-\u2627]/u, // رموز خطيرة نادرة
];

const FLAG_PATTERNS = [
  /api[_-]?key\s*[:=]\s*\w{10,}/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-like
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email — flag لو تضمن PII
];

function scoreText(text, patterns) {
  let hits = 0;
  for (const re of patterns) if (re.test(text)) hits++;
  return Math.min(1, hits * 0.55);
}

/**
 * @param {string} text
 * @param {{blockThreshold?:number, flagThreshold?:number}} opts
 */
function preCheck(text, opts = {}) {
  const blockT = opts.blockThreshold ?? 0.92;
  const flagT = opts.flagThreshold ?? 0.65;
  const t = String(text ?? '');
  if (!t.trim()) return { action: 'allow', score: 0 };
  if (t.length > 12000) return { action: 'flag', reason: 'input_too_long', score: 0.7 };
  const blockScore = scoreText(t, BLOCK_PATTERNS);
  if (blockScore >= blockT) return { action: 'block', reason: 'policy_violation', score: blockScore };
  const flagScore = scoreText(t, FLAG_PATTERNS);
  if (flagScore >= flagT) return { action: 'flag', reason: 'possible_pii', score: flagScore };
  return { action: 'allow', score: Math.max(blockScore, flagScore) };
}

function postCheck(text, opts = {}) {
  const t = String(text ?? '');
  // مثال: حجب تسريب مفاتيح وهمية في الرد
  if (/sk-[a-zA-Z0-9]{20,}/.test(t)) return { action: 'block', reason: 'leaked_secret', score: 0.95 };
  return { action: 'allow', score: 0 };
}

module.exports = { preCheck, postCheck };
