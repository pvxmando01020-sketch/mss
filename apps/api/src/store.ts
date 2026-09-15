import { randomUUID } from 'node:crypto';
import type { Role } from './types';

/**
 * Conversation/message store.
 * MVP: in-memory implementation. The PostgreSQL implementation follows the
 * exact same interface (see the DDL in docs/technical-contract.docx, section 6).
 */
export interface StoredMessage {
  id: string;
  role: Role;
  content: string;
  model?: string;
  tokens?: number;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  systemPrompt?: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMeta {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface Store {
  list(): ConversationMeta[];
  get(id: string): Conversation | undefined;
  create(opts?: { title?: string; model?: string; systemPrompt?: string }): Conversation;
  addMessage(convId: string, msg: Omit<StoredMessage, 'id' | 'createdAt'>): StoredMessage;
  delete(id: string): boolean;
}

export class MemoryStore implements Store {
  private conversations = new Map<string, Conversation>();

  list(): ConversationMeta[] {
    return [...this.conversations.values()]
      .map(({ messages, ...meta }) => meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  create(opts: { title?: string; model?: string; systemPrompt?: string } = {}): Conversation {
    const c: Conversation = {
      id: randomUUID(),
      title: (opts.title ?? '').trim() || 'محادثة جديدة',
      model: opts.model ?? 'auto',
      systemPrompt: opts.systemPrompt,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.conversations.set(c.id, c);
    return c;
  }

  addMessage(convId: string, msg: Omit<StoredMessage, 'id' | 'createdAt'>): StoredMessage {
    const c = this.conversations.get(convId);
    if (!c) throw new Error(`conversation ${convId} not found`);
    const m: StoredMessage = { id: randomUUID(), createdAt: Date.now(), ...msg };
    c.messages.push(m);
    c.updatedAt = Date.now();
    if (c.messages.length === 1 && m.role === 'user') {
      c.title = m.content.replace(/\s+/g, ' ').slice(0, 48);
    }
    return m;
  }

  delete(id: string): boolean {
    return this.conversations.delete(id);
  }
}
