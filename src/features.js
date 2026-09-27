/**
 * features.js — استخراج الميزات محليًا بدون استدعاء API
 * جدول الميزات من الخطة الموحدة (مرحلة 3a)
 */

const ARABIC_RE = /[\u0600-\u06FF]/g;
const WORD_RE = /[\p{L}\p{N}_]+/gu;

// قاموس مصطلحات تقنية مبني مسبقًا — يستخدم لحساب كثافة تقنية
const TECH_DICT = new Set(
  `api backend frontend database sql json javascript typescript python dart flutter
   fastify postgres redis s3 http rest graphql docker kubernetes schema regex
   algorithm function class debug trace middleware cache queue token auth jwt
   model llm prompt embedding vector rag finetune inference latency throughput
   تحليل برمجة قاعدة بيانات كود خوارزمية شبكة خادم واجهة مصادقة تشفير ذكاء اصطناعي`
    .split(/\s+/).map(s => s.trim().toLowerCase()).filter(Boolean)
);

// أنماط نوع الطلب — عربي + إنجليزي
// ملاحظة: \b لا يعمل مع العربية في JS بدون unicode، لذلك نستخدم حدود unicode يدويًا
const INTENT_PATTERNS = [
  { intent: 'write', re: /(?:^|[^\p{L}\p{N}_])(اكتب|أنشئ|صمم|حرر|أعد صياغة|write|create|design|draft|compose|rewrite)(?=[^\p{L}\p{N}_]|$)/iu },
  { intent: 'review', re: /(?:^|[^\p{L}\p{N}_])(راجع|دقق|صحح|review|audit|check|critique)(?=[^\p{L}\p{N}_]|$)/iu },
  { intent: 'analyze', re: /(?:^|[^\p{L}\p{N}_])(حلل|تحليل|قارن|فسر|analy[sz]e|compare|explain why|diagnose)(?=[^\p{L}\p{N}_]|$)/iu },
  { intent: 'summarize', re: /(?:^|[^\p{L}\p{N}_])(لخص|اختصر|استخرج|summariz|extract|tldr)(?=[^\p{L}\p{N}_]|$)/iu },
  { intent: 'code', re: /(?:^|[^\p{L}\p{N}_])(برمج|نفذ|debug|implement|refactor|fix bug)(?=[^\p{L}\p{N}_]|$)/iu },
  { intent: 'retrieve', re: /(?:^|[^\p{L}\p{N}_])(ما هو|من هو|متى|أين|عرف|what is|who is|when|where|define)(?=[^\p{L}\p{N}_]|$)/iu },
];

const CODE_SIGNALS = /```|~~~|\b(function|def |class |const |let |var |import |export |async |await |SELECT |INSERT |UPDATE |FROM |WHERE )\b|[{}()[\];]{3,}|\b\d+\s*[+\-*/=]{1,2}\s*\d+/i;

/**
 * @param {string} input
 * @returns {{
 *   text:string, charCount:number, wordCount:number,
 *   arabicChars:number, arabicRatio:number, language:'ar'|'en'|'mixed'|'unknown',
 *   hasCode:boolean, codeScore:number,
 *   technicalDensity:number, technicalWords:number,
 *   intent:string|null, intentConfidence:number
 * }}
 */
function extractFeatures(input) {
  const text = String(input ?? '').trim();
  const charCount = text.length;
  if (!charCount) {
    return {
      text, charCount: 0, wordCount: 0,
      arabicChars: 0, arabicRatio: 0, language: 'unknown',
      hasCode: false, codeScore: 0,
      technicalDensity: 0, technicalWords: 0,
      intent: null, intentConfidence: 0,
    };
  }

  const words = text.match(WORD_RE) || [];
  const wordCount = words.length;
  const arabicChars = (text.match(ARABIC_RE) || []).length;
  const arabicRatio = charCount ? arabicChars / charCount : 0;

  let language = 'unknown';
  if (wordCount === 0) language = 'unknown';
  else if (arabicRatio > 0.35) language = 'ar';
  else if (arabicRatio > 0.08) language = 'mixed';
  else language = 'en';

  const hasCode = CODE_SIGNALS.test(text);
  // codeScore: 0..1 يعكس قوة إشارة الكود (عدد الأسطر المحتوية على رموز)
  const codeLines = text.split('\n').filter(l => /[{}();=]|```/.test(l)).length;
  const codeScore = Math.min(1, (hasCode ? 0.6 : 0) + codeLines * 0.15);

  let technicalWords = 0;
  for (const w of words) if (TECH_DICT.has(w.toLowerCase())) technicalWords++;
  const technicalDensity = wordCount ? technicalWords / wordCount : 0;

  let intent = null;
  let intentConfidence = 0;
  for (const { intent: name, re } of INTENT_PATTERNS) {
    const m = text.match(re);
    if (m) { intent = name; intentConfidence = 0.85; break; }
  }
  // fallback: أول كلمة فعلية إن لم تُطابق الأنماط
  if (!intent && wordCount > 0) {
    const first = words[0].toLowerCase();
    if (['اكتب','صمم','حلل','لخص','اشرح','code','write','explain'].includes(first)) {
      intent = 'write'; intentConfidence = 0.5;
    }
  }

  return {
    text, charCount, wordCount,
    arabicChars, arabicRatio, language,
    hasCode, codeScore,
    technicalDensity, technicalWords,
    intent, intentConfidence,
  };
}

module.exports = { extractFeatures, TECH_DICT, INTENT_PATTERNS };
