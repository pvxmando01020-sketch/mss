import type { Role } from '../types';

export type MessageStatus = 'complete' | 'partial' | 'aborted';

export interface AttachmentRecord {
  id: string;
  fileKey: string; // S3 object key
  mediaType: string;
}

export interface StoredMessage {
  id: string;
  role: Role;
  content: string;
  model?: string;
  tokens?: number;
  status: MessageStatus;
  createdAt: number;
  attachments?: AttachmentRecord[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation extends ConversationMeta {
  systemPrompt?: string;
  messages: StoredMessage[];
}

export interface NewMessage {
  role: Role;
  content: string;
  model?: string;
  tokens?: number;
  status: MessageStatus;
  attachments?: Array<{ fileKey: string; mediaType: string }>;
}

/**
 * Storage contract.
 * Phase 1: MemoryStore (fallback when no DATABASE_URL).
 * Phase 2: PostgresStore (same interface, no route-handler changes needed).
 * All methods are scoped by userId for per-session isolation.
 */
export interface Store {
  /** Anonymous device/session → user id (upsert by session token). */
  ensureSession(sessionToken: string): Promise<string>;
  list(userId: string): Promise<ConversationMeta[]>;
  get(userId: string, id: string): Promise<Conversation | undefined>;
  create(
    userId: string,
    opts?: { title?: string; model?: string; systemPrompt?: string },
  ): Promise<Conversation>;
  addMessage(userId: string, convId: string, msg: NewMessage): Promise<StoredMessage>;
  delete(userId: string, id: string): Promise<boolean>;
}
