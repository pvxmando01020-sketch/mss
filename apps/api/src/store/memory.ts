import { randomUUID } from 'node:crypto';
import type { Store, StoredMessage, NewMessage, Conversation, ConversationMeta, AttachmentRecord } from './types';

interface InternalConversation extends Conversation {
  userId: string;
}

/**
 * In-memory Store (fallback when no DATABASE_URL is configured).
 * Same contract as PostgresStore, including per-user isolation.
 */
export class MemoryStore implements Store {
  private sessions = new Map<string, string>();
  private conversations = new Map<string, InternalConversation>();

  async ensureSession(sessionToken: string): Promise<string> {
    let id = this.sessions.get(sessionToken);
    if (!id) {
      id = randomUUID();
      this.sessions.set(sessionToken, id);
    }
    return id;
  }

  async list(userId: string): Promise<ConversationMeta[]> {
    return [...this.conversations.values()]
      .filter((c) => c.userId === userId)
      .map(({ userId: _uid, messages: _msgs, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(userId: string, id: string): Promise<Conversation | undefined> {
    const c = this.conversations.get(id);
    if (!c || c.userId !== userId) return undefined;
    const { userId: _uid, ...rest } = c;
    return {
      ...rest,
      messages: rest.messages.map((m) => ({
        ...m,
        attachments: m.attachments ? m.attachments.map((a) => ({ ...a })) : undefined,
      })),
    };
  }

  async create(
    userId: string,
    opts: { title?: string; model?: string; systemPrompt?: string } = {},
  ): Promise<Conversation> {
    const c: Conversation = {
      id: randomUUID(),
      title: (opts.title ?? '').trim() || 'محادثة جديدة',
      model: opts.model ?? 'auto',
      systemPrompt: opts.systemPrompt,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.conversations.set(c.id, { userId, ...c });
    return c;
  }

  async addMessage(userId: string, convId: string, msg: NewMessage): Promise<StoredMessage> {
    const c = this.conversations.get(convId);
    if (!c || c.userId !== userId) {
      throw new Error(`conversation ${convId} not found`);
    }
    const attachments: AttachmentRecord[] = (msg.attachments ?? []).map((a) => ({
      id: randomUUID(),
      fileKey: a.fileKey,
      mediaType: a.mediaType,
    }));
    const m: StoredMessage = {
      id: randomUUID(),
      createdAt: Date.now(),
      role: msg.role,
      content: msg.content,
      model: msg.model,
      tokens: msg.tokens,
      status: msg.status,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    c.messages.push(m);
    c.updatedAt = Date.now();
    if (c.messages.length === 1 && m.role === 'user') {
      c.title = m.content.replace(/\s+/g, ' ').slice(0, 48);
    }
    return m;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const c = this.conversations.get(id);
    if (!c || c.userId !== userId) return false;
    return this.conversations.delete(id);
  }
}
