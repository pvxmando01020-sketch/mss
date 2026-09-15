import type { ModelDef, UnifiedMessage } from './types';
import { AppError } from './errors';

/** MVP token estimation: chars / 4 (replaced by provider counters when available). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function messageTokens(m: UnifiedMessage): number {
  let t = estimateTokens(m.content) + 4;
  for (const a of m.attachments ?? []) {
    const bytes = Math.max(0, a.dataUrl.length - 32) / 3;
    t += 1_000 + Math.ceil(bytes / 4);
  }
  return t;
}

export interface ContextResult {
  system?: string;
  messages: UnifiedMessage[];
  estimatedTokens: number;
  dropped: number;
}

/**
 * Context management: enforce an 80% budget of the model's context window by
 * trimming oldest messages first. If even the newest message does not fit,
 * fail with CONTEXT_TOO_LONG instead of silently overflowing cost.
 */
export function buildContext(
  model: ModelDef,
  system: string | undefined,
  messages: UnifiedMessage[],
): ContextResult {
  const budget = Math.floor(model.contextWindow * 0.8);
  const sysTokens = system ? estimateTokens(system) + 4 : 0;
  const list = messages.slice();
  let total = sysTokens + list.reduce((s, m) => s + messageTokens(m), 0);
  let dropped = 0;

  while (total > budget && list.length > 1) {
    const removed = list.shift();
    if (!removed) break;
    total -= messageTokens(removed);
    dropped += 1;
  }
  if (total > budget) {
    throw new AppError(
      'CONTEXT_TOO_LONG',
      `context exceeds ${model.contextWindow} tokens for ${model.id} even after trimming`,
      413,
    );
  }
  return { system, messages: list, estimatedTokens: total, dropped };
}
