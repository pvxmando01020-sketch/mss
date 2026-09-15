import { getPool } from './pool';

/**
 * Ordered SQL migrations, tracked in a `migrations` table.
 * Run automatically on boot when DATABASE_URL is set, or manually:
 *   npm run migrate -w @mss/api
 */
export const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: '001_init',
    sql: `
      -- Anonymous device/session users (no full auth in phase 2 by design).
      CREATE TABLE users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_token TEXT UNIQUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX users_session_idx ON users (session_token);

      CREATE TABLE conversations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title         TEXT NOT NULL DEFAULT 'محادثة جديدة',
        model         TEXT NOT NULL DEFAULT 'auto',
        system_prompt TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX conversations_user_idx ON conversations (user_id, updated_at DESC);

      CREATE TABLE messages (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role             TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
        content          TEXT NOT NULL,
        model_used       TEXT,
        tokens           INTEGER,
        status           TEXT NOT NULL DEFAULT 'complete'
                         CHECK (status IN ('complete', 'partial', 'aborted')),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at);

      CREATE TABLE attachments (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        file_url   TEXT NOT NULL,
        type       TEXT NOT NULL
      );
    `,
  },
];

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = getPool(databaseUrl);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS migrations (
       id SERIAL PRIMARY KEY,
       name TEXT UNIQUE NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  for (const m of MIGRATIONS) {
    const seen = await pool.query('SELECT 1 FROM migrations WHERE name = $1', [m.name]);
    if (seen.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [m.name]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${m.name}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
