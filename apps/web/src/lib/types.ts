export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
  available: boolean;
}

export interface ConversationMeta {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model?: string;
  tokens?: number;
  createdAt: number;
}

export interface Conversation extends ConversationMeta {
  systemPrompt?: string;
  messages: StoredMessage[];
}

export type SseEventName = 'start' | 'delta' | 'usage' | 'done' | 'fallback' | 'error';

export interface SseEvent {
  event: SseEventName;
  data: unknown;
}

export interface AttachmentPayload {
  type: 'image';
  mediaType: string;
  dataUrl: string;
}

export interface MessagePayload {
  role: 'user' | 'assistant';
  content: string;
  attachments?: AttachmentPayload[];
}
