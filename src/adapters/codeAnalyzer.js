/**
 * adapters/codeAnalyzer.js — محلل أخطاء الكود والـ Vibe Code (التحديث الجديد)
 * يحلل الكود المولد تلقائياً بدون تنفيذ — يكشف syntax, security, vibe mismatch
 */

const SYNTAX_PATTERNS = [
  { re: /:\s*$/m, msg: 'missing body after colon', type: 'syntax', severity: 'high' },
  { re: /\bif\s*\(.*[^)]\s*\{[^}]*$/m, msg: 'unclosed brace', type: 'syntax', severity: 'high' },
  { re: /"""[^"]*$/m, msg: 'unclosed string', type: 'syntax', severity: 'high' },
  { re: /;\s*;/, msg: 'double semicolon', type: 'style', severity: 'low' },
];

const SECURITY_PATTERNS = [
  { re: /eval\s*\(/, msg: 'use of eval — security risk', type: 'security', severity: 'critical' },
  { re: /exec\s*\(/, msg: 'use of exec — security risk', type: 'security', severity: 'critical' },
  { re: /innerHTML\s*=/, msg: 'innerHTML assignment — XSS risk', type: 'security', severity: 'high' },
  { re: /process\.env/, msg: 'env access in client code', type: 'security', severity: 'medium' },
];

const VIBE_PATTERNS = {
  vibe: [
    { re: /class\s+\w+.*\{\s*\}/, msg: 'empty class — vibe code needs content', type: 'vibe_mismatch', severity: 'medium' },
    { re: /TODO|FIXME|placeholder/i, msg: 'vibe code contains placeholder', type: 'vibe_mismatch', severity: 'medium' },
  ],
};

/**
 * يحلل نص يحتوي كود (يستخرج الكود من ``` blocks)
 * @param {string} text — رد النموذج الكامل
 * @param {{category?:string, vibeContext?:string}} opts
 * @returns {{ hasCode:boolean, errors:Array, errorScore:number, vibeScore:number }}
 */
function analyze(text, opts = {}) {
  const codeBlocks = [];
  const re = /```(?:\w+)?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) codeBlocks.push(m[1]);
  const inlineCode = !codeBlocks.length && /[{}();=]|def |function |class /.test(text) ? [text] : [];
  const blocks = codeBlocks.length ? codeBlocks : inlineCode;
  if (!blocks.length) return { hasCode: false, errors: [], errorScore: 0, vibeScore: 0 };

  const errors = [];
  for (const block of blocks) {
    for (const p of SYNTAX_PATTERNS) if (p.re.test(block)) errors.push({ ...p, snippet: block.slice(0, 120) });
    for (const p of SECURITY_PATTERNS) if (p.re.test(block)) errors.push({ ...p, snippet: block.slice(0, 120) });
    // vibe checks — فقط إذا category=vibe أو vibeContext موجود
    if (opts.category === 'vibe' || opts.vibeContext) {
      for (const p of VIBE_PATTERNS.vibe) if (p.re.test(block)) errors.push({ ...p, snippet: block.slice(0, 120) });
      // vibe mismatch: الكود لا يعكس الـ vibe المطلوب (مثال: vibe يطلب animation لكن الكود static)
      if (opts.vibeContext && /animation|حركة|تفاعل/i.test(opts.vibeContext) && !/animate|transition|keyframe|framer/i.test(block)) {
        errors.push({ msg: 'vibe requires animation but code is static', type: 'vibe_mismatch', severity: 'medium', snippet: block.slice(0, 80) });
      }
    }
    // تحقق إضافي: طول الكود غير طبيعي
    if (block.length < 20 && opts.category === 'code') {
      errors.push({ msg: 'code too short for request', type: 'logic', severity: 'low', snippet: block.slice(0, 80) });
    }
  }

  // errorScore 0..1 (0 = لا أخطاء، 1 = أخطاء حرجة)
  let score = 0;
  for (const e of errors) {
    if (e.severity === 'critical') score += 0.4;
    else if (e.severity === 'high') score += 0.25;
    else if (e.severity === 'medium') score += 0.12;
    else score += 0.05;
  }
  const errorScore = Math.min(1, Number(score.toFixed(3)));
  const vibeScore = errors.filter(e => e.type === 'vibe_mismatch').length ? errorScore : 0;

  return { hasCode: true, errors, errorScore, vibeScore, blocksCount: blocks.length };
}

/**
 * يحوّل errorScore إلى quality (0..1) — عكس العلاقة
 * أخطاء حرجة → quality منخفض جداً
 */
function qualityFromErrors(errorScore) {
  if (errorScore >= 0.4) return 0.08; // حرج
  if (errorScore >= 0.25) return 0.18;
  if (errorScore >= 0.12) return 0.35;
  if (errorScore > 0) return 0.55;
  return 0.85; // لا أخطاء
}

module.exports = { analyze, qualityFromErrors, SYNTAX_PATTERNS, SECURITY_PATTERNS };
