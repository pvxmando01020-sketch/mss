export interface Segment {
  type: 'text' | 'code';
  value: string;
  lang?: string;
}

/** Split a message into text and fenced-code segments (minimal, dependency-free). */
export function splitCode(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: text.slice(last, m.index) });
    const lang = m[1]?.trim();
    segments.push({ type: 'code', value: (m[2] ?? '').replace(/\n$/, ''), lang: lang || undefined });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  if (segments.length === 0) segments.push({ type: 'text', value: text });
  return segments;
}

export function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}
