/** Unified types shared across the gateway. */

export type Role = 'system' | 'user' | 'assistant';

export interface Attachment {
  type: 'image';
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataUrl: string; // data:<mediaType>;base64,....
}

export interface UnifiedMessage {
  role: Role;
  content: string;
  attachments?: Attachment[];
}

export interface ChatRequest {
  conversationId: string | null;
  model: string; // 'auto' or a model id like 'openai:gpt-4o-mini'
  systemPrompt?: string | null;
  messages: UnifiedMessage[];
}

export interface ModelDef {
  id: string;
  provider: 'openai' | 'anthropic' | 'mock';
  upstreamId: string;
  name: string;
  contextWindow: number; // tokens
  capabilities: Array<'text' | 'vision' | 'code'>;
  tier: 'cheap' | 'standard' | 'premium';
  fallback?: string;
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'MODERATION_FLAGGED'
  | 'RATE_LIMITED'
  | 'CONTEXT_TOO_LONG'
  | 'MODEL_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL';

/** Events pushed to the client over SSE. */
export type SseEvent =
  | { event: 'start'; data: { conversationId: string; model: string; fallbackFrom?: string; warnings: string[] } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'usage'; data: { inputTokens: number; outputTokens: number; model: string } }
  | { event: 'done'; data: { stopReason: string; conversationId: string } }
  | { event: 'fallback'; data: { from: string; to: string; reason: string } }
  | { event: 'error'; data: { code: ErrorCode; message: string } };

/** Events produced by a model adapter. */
export type AdapterEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number }; stopReason: string }
  | { kind: 'error'; code: ErrorCode; message: string; retryable: boolean };

export interface AdapterRequest {
  system?: string;
  messages: UnifiedMessage[];
  maxTokens?: number;
}

/** Adapter Pattern: every provider implements this exact interface. */
export interface ModelAdapter {
  readonly id: string;
  stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<AdapterEvent>;
}
