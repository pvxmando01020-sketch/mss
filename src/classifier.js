/**
 * classifier.js — تصنيف الأسئلة محليًا (3a → 3d + التحديث الجديد: vibe)
 *
 * 3a: مصنف rule-based أولي (حجم صفر، يعمل بدون ML)
 * 3d: يُستبدل بشجرة قرار صغيرة (decision tree) بأوزان ثابتة مضمنة
 *      مع قواعد احتياطية إذا فشل الاستدلال.
 *
 * الفئات الآن ست (بعد التحديث الجديد):
 *  code | vibe | creative | analysis | retrieval | general
 *  vibe = Vibe Code — كود سريع تفاعلي/جمالي (مختلف عن code الصارم)
 */

const { extractFeatures } = require('./features');

const CATEGORIES = ['code', 'vibe', 'creative', 'analysis', 'retrieval', 'general'];

/**
 * أوزان شجرة القرار المضمنة (كيلوبايتات).
 * دربّت offline على عينات عربية/إنجليزية مختلطة — يمكن تحديثها عبر OTA
 * دون إعادة تدريب سحابي. القيم هنا تمثل نسخة v0 seed.
 * كل فئة لها متجه أوزان على الميزات المطبعة.
 *
 * الميزات المطبعة (normalized):
 *  [hasCode, codeScore, technicalDensity, wordCountNorm, arabicRatio, intent_code, intent_creative, intent_analyze, intent_retrieve]
 */
const TREE_WEIGHTS = {
  code:      [2.8, 1.9, 1.2, 0.3, -0.2, 1.5, -0.8, -0.4, -1.0],
  vibe:      [1.9, 1.2, 0.9, 0.5, 0.1, 0.8, 0.3, -0.2, -0.6], // بين code و creative
  creative:  [-1.2, -0.6, -0.3, 0.4, 0.6, -0.9, 2.2, -0.5, -0.7],
  analysis:  [-0.4, -0.2, 1.6, 0.7, 0.1, -0.6, -0.7, 2.4, -0.6],
  retrieval: [-0.8, -0.5, -0.2, -0.9, 0.2, -0.7, -0.6, -0.5, 2.0],
  general:   [0, 0, 0, 0, 0, 0, 0, 0, 0], // baseline
};

function vectorize(f) {
  const wordCountNorm = Math.min(1, f.wordCount / 120);
  return [
    f.hasCode ? 1 : 0,
    f.codeScore,
    Math.min(1, f.technicalDensity * 4),
    wordCountNorm,
    f.arabicRatio,
    f.intent === 'code' ? 1 : 0,
    f.intent === 'write' ? 1 : 0,
    f.intent === 'analyze' ? 1 : 0,
    f.intent === 'retrieve' || f.intent === 'summarize' ? 1 : 0,
  ];
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function softmax(logits) {
  const m = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - m));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

/**
 * تصنيف بشجرة/انحدار لوجستي + fallback rule-based
 * @param {string|object} input — نص أو كائن ميزات من extractFeatures
 * @param {{useRulesOnly?:boolean}} opts
 * @returns {{category:string, confidence:number, probs:Record<string,number>, method:'tree'|'rules'|'empty'}}
 */
function classify(input, opts = {}) {
  const f = typeof input === 'string' || input == null ? extractFeatures(input) : input;

  if (!f.wordCount) return { category: 'general', confidence: 0.4, probs: { general: 1 }, method: 'empty' };

  // مسار rule-based الصريح (3a) — يُستخدم كـ fallback أيضًا
  const ruleResult = classifyRules(f);
  if (opts.useRulesOnly) return ruleResult;

  // مسار الشجرة (3d) — حساب logits
  const vec = vectorize(f);
  const logits = CATEGORIES.map(cat => dot(vec, TREE_WEIGHTS[cat]));
  const probsArr = softmax(logits);
  const probs = Object.fromEntries(CATEGORIES.map((c, i) => [c, Number(probsArr[i].toFixed(4))]));

  let bestIdx = 0;
  for (let i = 1; i < probsArr.length; i++) if (probsArr[i] > probsArr[bestIdx]) bestIdx = i;
  const bestCat = CATEGORIES[bestIdx];
  const bestProb = probsArr[bestIdx];

  // إذا كانت الثقة منخفضة جدًا (<0.38) نعود للقواعد — يحمي من ضوضاء الأوزان الأولية
  if (bestProb < 0.38) {
    // دمج: إذا اتفق الاثنان نرفع الثقة، وإلا نفضل القواعد عندما تكون إشارة الكود قوية
    if (ruleResult.category === bestCat) {
      return { category: bestCat, confidence: Number(((bestProb + ruleResult.confidence) / 2).toFixed(3)), probs, method: 'tree' };
    }
    if (f.hasCode && ruleResult.category === 'code') return ruleResult;
    return { category: bestCat, confidence: Number(bestProb.toFixed(3)), probs, method: 'tree' };
  }

  return { category: bestCat, confidence: Number(bestProb.toFixed(3)), probs, method: 'tree' };
}

function classifyRules(f) {
  const t = f.text;

  // 0) Vibe Code — كود vibe سريع (واجهات، أنيميشن، تفاعل)
  if (/(?:^|[^\p{L}\p{N}_])(فايب|vibe|واجهة تفاعلية|أنيميشن|تفاعلي|تصميم واجهة)(?=[^\p{L}\p{N}_]|$)/iu.test(t) || /vibe\s*code|landing\s*page|dashboard.*ui/i.test(t)) {
    return { category: 'vibe', confidence: 0.88, probs: { vibe: 0.88, general: 0.12 }, method: 'rules' };
  }

  // 1) كود — أعلى أولوية لأن إشاراته مميزة
  if (f.hasCode || f.codeScore > 0.55) return { category: 'code', confidence: 0.92, probs: { code: 0.92, general: 0.08 }, method: 'rules' };
  if (/(?:^|[^\p{L}\p{N}_])(برمج|كود|code|debug|implement)(?=[^\p{L}\p{N}_]|$)/iu.test(t) || /function\s*\(|def\s+\w+\s*\(/i.test(t)) {
    return { category: 'code', confidence: 0.82, probs: { code: 0.82, general: 0.18 }, method: 'rules' };
  }

  // 2) استخراج/معلومة سريعة — أسئلة قصيرة تعريفية
  if (f.wordCount < 48 && /(?:^|[^\p{L}\p{N}_])(لخص|اختصر|استخرج|معلومة|ما هو|من هو|عرف)(?=[^\p{L}\p{N}_]|$)/iu.test(t) || /(what is|who is|define|extract|summariz)/i.test(t)) {
    return { category: 'retrieval', confidence: 0.78, probs: { retrieval: 0.78, general: 0.22 }, method: 'rules' };
  }

  // 3) تحليل بيانات/أرقام
  if (/(?:^|[^\p{L}\p{N}_])(تحليل|إحصاء|رقم|بيان|احسب|جدول)(?=[^\p{L}\p{N}_]|$)/iu.test(t) || /(formula|statistics|dataset|calculate)/i.test(t) || f.technicalDensity > 0.18) {
    return { category: 'analysis', confidence: 0.74, probs: { analysis: 0.74, general: 0.26 }, method: 'rules' };
  }

  // 4) كتابة إبداعية/تحرير
  if (/(?:^|[^\p{L}\p{N}_])(قصة|شعر|إبداع|رسالة|مقال|كتابة|أعد صياغة)(?=[^\p{L}\p{N}_]|$)/iu.test(t) || /(creative|rewrite|story|poem)/i.test(t) || f.intent === 'write') {
    return { category: 'creative', confidence: 0.71, probs: { creative: 0.71, general: 0.29 }, method: 'rules' };
  }

  return { category: 'general', confidence: 0.55, probs: { general: 0.55 }, method: 'rules' };
}

/**
 * تقدير مستوى التعقيد — يحدد الميزانية (خفيف/افتراضي/قوي)
 */
function complexity(f, category) {
  const feats = typeof f === 'string' ? extractFeatures(f) : f;
  const wc = feats.wordCount;
  // معقد: كود طويل، تحليل متعدد الخطوات، سؤال عربي طويل مركب
  if (
    wc > 180 ||
    (category === 'code' && (wc > 80 || feats.hasCode)) ||
    (category === 'analysis' && wc > 90) ||
    (feats.arabicRatio > 0.5 && wc > 100)
  ) return 'complex';
  if (wc > 35 || feats.technicalDensity > 0.12 || !feats.intent) return 'medium';
  return 'simple';
}

module.exports = { CATEGORIES, TREE_WEIGHTS, classify, classifyRules, complexity, vectorize };
