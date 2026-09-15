import type { UnifiedMessage } from '../types';
import { AppError } from '../errors';

/** Hard limits enforced before anything reaches a model. */
export const LIMITS = {
  maxMessageChars: 32_000,
  maxMessages: 60,
  maxAttachmentsPerMessage: 4,
  /** ~10MB in base64 data-URL form. */
  maxDataUrlChars: 14_000_000,
  maxSystemPromptChars: 4_000,
};

const ALLOWED_MEDIA = /^image\/(png|jpeg|webp)$/;
const FILE_KEY_RE = /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]+$/;

/** Strip HTML/scripts, normalize encoding, remove control chars. */
export function cleanText(input: string): string {
  let t = input.normalize('NFKC');
  t = t.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');
  t = t.replace(/<\/?[a-z!/?][^>]*>/gi, ' ');
  t = t.replace(/javascript\s*:/gi, ' ');
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  t = t.replace(/\u202E/g, ''); // bidirectional override — layout-attack vector
  t = t.replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

export function sanitizeMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError('INVALID_INPUT', 'messages must be a non-empty array', 400);
  }
  if (messages.length > LIMITS.maxMessages) {
    throw new AppError('INVALID_INPUT', `too many messages (max ${LIMITS.maxMessages})`, 400);
  }
  return messages.map((m, i) => {
    const content = cleanText(m.content ?? '');
    if (content.length === 0) {
      throw new AppError('INVALID_INPUT', `message[${i}].content is empty after cleaning`, 400);
    }
    if (content.length > LIMITS.maxMessageChars) {
      throw new AppError('INVALID_INPUT', `message[${i}] exceeds ${LIMITS.maxMessageChars} chars`, 400);
    }
    const out: UnifiedMessage = { role: m.role, content };
    if (m.attachments && m.attachments.length > 0) {
      if (m.attachments.length > LIMITS.maxAttachmentsPerMessage) {
        throw new AppError('INVALID_INPUT', `too many attachments on message[${i}] (max ${LIMITS.maxAttachmentsPerMessage})`, 400);
      }
      out.attachments = m.attachments.map((a, j) => {
        if (a.type !== 'image') {
          throw new AppError('INVALID_INPUT', `attachment[${j}].type must be "image"`, 400);
        }
        if (!ALLOWED_MEDIA.test(a.mediaType)) {
          throw new AppError('INVALID_INPUT', `attachment[${j}].mediaType not allowed (png/jpeg/webp)`, 400);
        }
        if (!a.dataUrl && !a.fileKey) {
          throw new AppError('INVALID_INPUT', `attachment[${j}] requires dataUrl or fileKey`, 400);
        }
        if (a.dataUrl) {
          if (!a.dataUrl.startsWith(`data:${a.mediaType};base64,`)) {
            throw new AppError('INVALID_INPUT', `attachment[${j}] must be a base64 data URL`, 400);
          }
          if (a.dataUrl.length > LIMITS.maxDataUrlChars) {
            throw new AppError('INVALID_INPUT', `attachment[${j}] too large (max 10MB)`, 400);
          }
        }
        if (a.fileKey && !FILE_KEY_RE.test(a.fileKey)) {
          throw new AppError('INVALID_INPUT', `attachment[${j}] has an invalid fileKey`, 400);
        }
        return a;
      });
    }
    return out;
  });
}

export function sanitizeSystemPrompt(prompt: string | null | undefined): string | undefined {
  if (prompt == null) return undefined;
  const cleaned = cleanText(prompt);
  if (cleaned.length > LIMITS.maxSystemPromptChars) {
    throw new AppError('INVALID_INPUT', `systemPrompt exceeds ${LIMITS.maxSystemPromptChars} chars`, 400);
  }
  return cleaned.length > 0 ? cleaned : undefined;
}
