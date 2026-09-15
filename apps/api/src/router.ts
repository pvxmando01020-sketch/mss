import type { ModelDef, UnifiedMessage } from './types';
import { AppError } from './errors';

/** Simple rule-based routing (MVP). A smart classifier lands in phase 3. */
const CODE_HINTS =
  /\b(code|function|class|api|react|component|endpoint|sql|regex|refactor|script|library|algorithm|debounce|typescript|javascript|python|rust|golang|bug|fix)\b|(كود|برمج|دالة|سكريبت|تعديل.{0,8}(كود|برنامج)|بايثون|جافاسكريبت|تايب سكريبت|مخطط قاعدة)/i;

export function looksLikeCode(text: string): boolean {
  return CODE_HINTS.test(text);
}

function pick(pool: ModelDef[], tierOrder: ModelDef['tier'][]): ModelDef {
  for (const tier of tierOrder) {
    const m = pool.find((x) => x.tier === tier);
    if (m) return m;
  }
  return pool[0];
}

export function routeModel(requested: string, lastUser: UnifiedMessage, available: ModelDef[]): ModelDef {
  if (available.length === 0) {
    throw new AppError('MODEL_UNAVAILABLE', 'no models are configured for this environment', 503);
  }
  if (requested !== 'auto') {
    const m = available.find((x) => x.id === requested);
    if (!m) {
      throw new AppError(
        'MODEL_UNAVAILABLE',
        `model '${requested}' is not available (missing provider key?)`,
        503,
      );
    }
    return m;
  }
  // Rule 1: image attached → vision-capable model.
  if (lastUser.attachments && lastUser.attachments.length > 0) {
    const pool = available.filter((m) => m.capabilities.includes('vision'));
    if (pool.length > 0) return pick(pool, ['standard', 'premium', 'cheap']);
  }
  // Rule 2: code request → code-capable model.
  if (looksLikeCode(lastUser.content)) {
    const pool = available.filter((m) => m.capabilities.includes('code'));
    if (pool.length > 0) return pick(pool, ['standard', 'premium', 'cheap']);
  }
  // Rule 3: anything else → cheapest general model (cost control).
  return pick(available, ['cheap', 'standard', 'premium']);
}
