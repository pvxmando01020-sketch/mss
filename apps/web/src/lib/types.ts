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

export type MessageStatus = 'complete' | 'partial' | 'aborted';

export interface MessageAttachment {
  fileKey: string; // S3 object key — rendered via /api/files/{key}
  mediaType: string;
}

export interface StoredMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model?: string;
  tokens?: number;
  status?: MessageStatus;
  createdAt: number;
  attachments?: MessageAttachment[];
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

/** Attachment picked in the composer: either uploaded to S3 (fileKey) or inline base64. */
export interface PendingAttachment {
  type: 'image';
  mediaType: string;
  previewUrl: string; // local data URL for instant display
  fileKey?: string; // S3 key (preferred — survives reloads)
  dataUrl?: string; // inline fallback when S3 is unavailable
}

export interface MessagePayload {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    type: 'image';
    mediaType: string;
    dataUrl?: string;
    fileKey?: string;
  }>;
}
