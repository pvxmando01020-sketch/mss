import type { Pool } from 'pg';
import type {
  Store,
  StoredMessage,
  NewMessage,
  Conversation,
  ConversationMeta,
  AttachmentRecord,
} from './types';

function toMeta(row: {
  id: string;
  title: string;
  model: string;
  created_at: Date;
  updated_at: Date;
}): ConversationMeta {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

/**
 * PostgreSQL Store — phase 2.
 * Implements the exact same Store contract as MemoryStore; route handlers
 * are unaware of the backend. All reads/writes are scoped by user_id
 * (anonymous session), enforcing per-session isolation.
 */
export class PostgresStore implements Store {
  constructor(private readonly pool: Pool) {}

  async ensureSession(sessionToken: string): Promise<string> {
    const r = await this.pool.query(
      `INSERT INTO users (session_token) VALUES ($1)
       ON CONFLICT (session_token) DO UPDATE SET session_token = EXCLUDED.session_token
       RETURNING id`,
      [sessionToken],
    );
    return r.rows[0].id as string;
  }

  async list(userId: string): Promise<ConversationMeta[]> {
    const r = await this.pool.query(
      `SELECT id, title, model, created_at, updated_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 200`,
      [userId],
    );
    return r.rows.map(toMeta);
  }

  async get(userId: string, id: string): Promise<Conversation | undefined> {
    const c = await this.pool.query(
      `SELECT id, title, model, system_prompt, created_at, updated_at
       FROM conversations
       WHERE id = $2 AND user_id = $1`,
      [userId, id],
    );
    if (c.rowCount === 0) return undefined;
    const row = c.rows[0];

    const msgs = await this.pool.query(
      `SELECT id, role, content, model_used, tokens, status, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at, ctid`,
      [id],
    );
    const atts = await this.pool.query(
      `SELECT a.id, a.file_url, a.type, a.message_id
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE m.conversation_id = $1`,
      [id],
    );
    const attMap = new Map<string, AttachmentRecord[]>();
    for (const a of atts.rows) {
      const arr = attMap.get(a.message_id) ?? [];
      arr.push({ id: a.id, fileKey: a.file_url, mediaType: a.type });
      attMap.set(a.message_id, arr);
    }
    const messages: StoredMessage[] = msgs.rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model_used ?? undefined,
      tokens: m.tokens ?? undefined,
      status: m.status,
      createdAt: m.created_at.getTime(),
      attachments: attMap.get(m.id),
    }));

    return {
      id: row.id,
      title: row.title,
      model: row.model,
      systemPrompt: row.system_prompt ?? undefined,
      createdAt: row.created_at.getTime(),
      updatedAt: row.updated_at.getTime(),
      messages,
    };
  }

  async create(
    userId: string,
    opts: { title?: string; model?: string; systemPrompt?: string } = {},
  ): Promise<Conversation> {
    const r = await this.pool.query(
      `INSERT INTO conversations (user_id, title, model, system_prompt)
       VALUES ($1, COALESCE(NULLIF($2, ''), 'محادثة جديدة'), $3, $4)
       RETURNING id, title, model, system_prompt, created_at, updated_at`,
      [userId, opts.title, opts.model ?? 'auto', opts.systemPrompt ?? null],
    );
    const row = r.rows[0];
    return {
      id: row.id,
      title: row.title,
      model: row.model,
      systemPrompt: row.system_prompt ?? undefined,
      createdAt: row.created_at.getTime(),
      updatedAt: row.updated_at.getTime(),
      messages: [],
    };
  }

  async addMessage(userId: string, convId: string, msg: NewMessage): Promise<StoredMessage> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [convId, userId],
      );
      if (lock.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error(`conversation ${convId} not found`);
      }
      const ins = await client.query(
        `INSERT INTO messages (conversation_id, role, content, model_used, tokens, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [convId, msg.role, msg.content, msg.model ?? null, msg.tokens ?? null, msg.status],
      );
      const messageRow = ins.rows[0];

      const attachments: AttachmentRecord[] = [];
      for (const a of msg.attachments ?? []) {
        const ar = await client.query(
          `INSERT INTO attachments (message_id, file_url, type) VALUES ($1, $2, $3) RETURNING id`,
          [messageRow.id, a.fileKey, a.mediaType],
        );
        attachments.push({ id: ar.rows[0].id, fileKey: a.fileKey, mediaType: a.mediaType });
      }

      await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [convId]);
      const count = await client.query(
        `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`,
        [convId],
      );
      if (count.rows[0].n === 1 && msg.role === 'user') {
        await client.query(`UPDATE conversations SET title = $2 WHERE id = $1`, [
          convId,
          msg.content.replace(/\s+/g, ' ').slice(0, 48),
        ]);
      }
      await client.query('COMMIT');

      return {
        id: messageRow.id,
        role: msg.role,
        content: msg.content,
        model: msg.model,
        tokens: msg.tokens,
        status: msg.status,
        createdAt: messageRow.created_at.getTime(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
