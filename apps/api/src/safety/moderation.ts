/**
 * First-pass prompt-injection detection with known patterns (EN + AR).
 * Cheap, deterministic, runs BEFORE any provider call.
 * A dedicated cheap moderation endpoint is the next layer (phase 2).
 */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'ignore-instructions-en',
    re: /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|earlier|previously)\s+(instructions|prompts|rules|context|directives)/i,
  },
  {
    name: 'reveal-system-prompt-en',
    re: /\b(reveal|show|print|repeat|leak|output)\b[^.\n]{0,50}\b(system\s+prompt|initial\s+instructions|hidden\s+instructions|secret\s+instructions)/i,
  },
  {
    name: 'jailbreak-en',
    re: /\b(DAN|DEVELOPER\s+MODE|jailbreak)\b[^.\n]{0,40}\b(enabled|on|active|mode)\b/i,
  },
  {
    name: 'ignore-instructions-ar',
    re: /(تجاهل|انس|امسح|أتعشى|أهمل)[\s،:]*((كل|جميع)\s+)?(التعليمات|الأوامر|التوجيهات)(\s+(السابقة|المسبقة|الأولى|المذكورة))?/i,
  },
  {
    name: 'reveal-system-prompt-ar',
    re: /(اعرض|أظهر|اطبع|اكتب|أخبرني)[\s،:]*((ال)(برومبت|تعليمات|نص|رسالة))[\s،:]*((الخاص|المشرف|النظام|السري|الخفي|المخفي)[\s،:]*((الكامل|المبدئي))?)?/i,
  },
];

/** Returns the names of every injection pattern matched in the text. */
export function detectInjection(text: string): string[] {
  const hits: string[] = [];
  for (const p of PATTERNS) {
    if (p.re.test(text)) hits.push(p.name);
  }
  return hits;
}
