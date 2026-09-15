/** Unified types shared across the gateway. */

export type Role = 'system' | 'user' | 'assistant';

export interface Attachment {
  type: 'image';
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Base64 data URL (sent directly in the chat body). */
  dataUrl?: string;
  /** S3 object key (previously uploaded via POST /v1/uploads). */
  fileKey?: string;
}

/** Attachment after server-side resolution — dataUrl is always filled for adapters. */
export interface ResolvedAttachment {
  type: 'image';
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataUrl: string;
  fileKey?: string;
}

/** Wire form (input): attachments carry dataUrl and/or fileKey. */
export interface UnifiedMessage {
  role: Role;
  content: string;
  attachments?: Attachment[];
}

/** Adapter form (post-resolution): dataUrl is always filled. */
export interface AdapterMessage {
  role: Role;
  content: string;
  attachments?: ResolvedAttachment[];
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
  messages: AdapterMessage[];
  maxTokens?: number;
}

/** Adapter Pattern: every provider implements this exact interface. */
export interface ModelAdapter {
  readonly id: string;
  stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<AdapterEvent>;
}
