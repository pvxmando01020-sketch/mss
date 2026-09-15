import type { AdapterEvent, AdapterRequest, ModelAdapter, UnifiedMessage } from '../types';

function lastUser(req: AdapterRequest): UnifiedMessage {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') return req.messages[i];
  }
  return req.messages[req.messages.length - 1];
}

const ARABIC = /[\u0600-\u06FF]/;

function looksLikeCode(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(code|function|class|api|react|python|javascript|typescript|sql|regex|algorithm|component|endpoint|refactor|script|library|debounce)\b/.test(t) ||
    /(كود|برمج|دالة|سكريبت|اكتب.{0,12}(دالة|برنامج)|تعديل.{0,8}(كود|برنامج)|بايثون|جافاسكريبت|تايب سكريبت|مخطط قاعدة)/.test(t)
  );
}

function buildReply(modelName: string, user: UnifiedMessage): string[] {
  const text = user.content;
  const arabic = ARABIC.test(text);
  const hasImage = Boolean(user.attachments && user.attachments.length > 0);

  if (hasImage) {
    return [
      arabic
        ? `استلمت الصورة المرفقة (${user.attachments![0].mediaType}). هذا رد محوّل العرض التجريبي — النموذج الحقيقي للقدرات البصرية سيحدد الموضوعات والألوان وأي نص داخل الصورة.`
        : `I received the attached image (${user.attachments![0].mediaType}). This is the demo (mock) adapter replying — a real vision model would identify subjects, colors and embedded text.`,
    ];
  }

  if (looksLikeCode(text)) {
    const intro = arabic
      ? 'بالتأكيد — إليك دالة `debounce` في TypeScript مع إمكانية الإلغاء:'
      : "Sure — here's a `debounce` utility in TypeScript with cancellation support:";
    const code = [
      '```ts',
      'export function debounce<F extends (...args: never[]) => void>(',
      '  fn: F,',
      '  wait = 300,',
      '): F & { cancel: () => void } {',
      '  let timer: ReturnType<typeof setTimeout> | undefined;',
      '  const debounced = ((...args: Parameters<F>) => {',
      '    clearTimeout(timer);',
      '    timer = setTimeout(() => fn(...args), wait);',
      '  }) as F & { cancel: () => void };',
      '  debounced.cancel = () => clearTimeout(timer);',
      '  return debounced;',
      '}',
      '```',
    ].join('\n');
    const outro = arabic
      ? 'زمن الانتظار قابل للضبط عبر المعامل الثاني، ودالة `cancel` تلغي أي استدعاء مؤجّل. هل تريد نسخة Promise أو اختبارات وحدة؟'
      : 'The wait is configurable via the second argument, and `cancel` drops any pending call. Want a Promise-based variant or unit tests?';
    return [intro, code, outro];
  }

  return [
    arabic
      ? `أنا ${modelName} — محوّل العرض التجريبي (Mock) داخل هذه البوابة. أحاكي سلوك النموذج الحقيقي: بث تدريجي، استخدام توكنز، وتوجيه حسب القدرات. `
      : `I'm ${modelName} — the demo (mock) adapter behind this gateway. I mimic real model behaviour: incremental streaming, token usage and capability-based routing. `,
    arabic
      ? 'جرّب: اطلب كوداً فيتم التوجيه لنموذج الكود، أو أرفق صورة فيتم التوجيه لنموذج الرؤية، أو بدّل النموذج يدوياً من الأعلى. عند ضبط OPENAI_API_KEY أو ANTHROPIC_API_KEY في بيئة الخادم ستظهر النماذج الحقيقية وتعمل عبر نفس العقد الموحّد.'
      : 'Try it: ask for code (routed to the code model), attach an image (routed to the vision model), or switch models from the top bar. Once OPENAI_API_KEY / ANTHROPIC_API_KEY are set in the server environment, real models appear and work through this same unified contract.',
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Deterministic demo adapter so the whole pipeline (validation, routing,
 * context, SSE streaming, UI) works without any provider keys.
 */
export function createMockAdapter(id: string, modelName: string): ModelAdapter {
  return {
    id,
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<AdapterEvent> {
      const user = lastUser(req);
      const full = buildReply(modelName, user).join('\n\n');
      const words = full.split(/(\s+)/);
      let buffer = '';
      let sentChars = 0;

      for (const w of words) {
        if (signal.aborted) return;
        buffer += w;
        if (buffer.length >= 18) {
          yield { kind: 'delta', text: buffer };
          sentChars += buffer.length;
          buffer = '';
          await sleep(10 + Math.random() * 28);
        }
      }
      if (buffer) {
        yield { kind: 'delta', text: buffer };
        sentChars += buffer.length;
      }
      const inputChars =
        (req.system ? req.system.length + 4 : 0) +
        req.messages.reduce((s, m) => s + m.content.length + 4, 0);
      yield {
        kind: 'done',
        usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(sentChars / 4) },
        stopReason: 'end_turn',
      };
    },
  };
}
