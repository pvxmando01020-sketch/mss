/**
 * adapters/db.js — طبقة Postgres مع fallback in-memory
 * تعمل بدون تثبيت pg — لو pg غير متوفر تستخدم Map.
 */

let pgPool = null;
let memorySummaries = []; // fallback

async function getPool(config) {
  if (pgPool) return pgPool;
  if (!config?.databaseUrl && !config?.pg?.host) return null;
  try {
    const { Pool } = require('pg'); // optional dep
    const conn = config.databaseUrl ? { connectionString: config.databaseUrl } : config.pg;
    pgPool = new Pool({ ...conn, max: 5, idleTimeoutMillis: 10000 });
    // اختبار اتصال سريع (لا يفشل التطبيق لو فشل)
    await pgPool.query('SELECT 1').catch(() => { pgPool = null; return null; });
    return pgPool;
  } catch {
    return null; // pg غير مثبت → fallback
  }
}

async function ensureSchema(config) {
  const pool = await getPool(config);
  if (!pool) return false;
  const sql = `
    CREATE TABLE IF NOT EXISTS routing_summaries (
      id SERIAL PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS routing_feedback (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      model TEXT NOT NULL,
      quality_score DOUBLE PRECISION NOT NULL,
      latency_ms INTEGER,
      regenerated BOOLEAN DEFAULT FALSE,
      manual_correction BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_cat_model ON routing_feedback(category, model);
  `;
  await pool.query(sql);
  return true;
}

async function persistSummary(config, summary) {
  const pool = await getPool(config);
  if (pool) {
    await pool.query('INSERT INTO routing_summaries(data) VALUES($1)', [JSON.stringify(summary)]);
    return { persisted: 'postgres' };
  }
  memorySummaries.push({ data: summary, created_at: new Date().toISOString() });
  if (memorySummaries.length > 500) memorySummaries.shift();
  return { persisted: 'memory', count: memorySummaries.length };
}

async function persistFeedback(config, entry) {
  const pool = await getPool(config);
  if (pool) {
    await pool.query(
      'INSERT INTO routing_feedback(category, model, quality_score, latency_ms, regenerated, manual_correction) VALUES($1,$2,$3,$4,$5,$6)',
      [entry.category, entry.model, entry.quality_score, entry.latency_ms ?? null, !!entry.regenerated, !!entry.manualCorrection]
    );
    return { persisted: 'postgres' };
  }
  return { persisted: 'memory' };
}

async function getRecentSummaries(config, limit = 10) {
  const pool = await getPool(config);
  if (pool) {
    const { rows } = await pool.query('SELECT data, created_at FROM routing_summaries ORDER BY id DESC LIMIT $1', [limit]);
    return rows;
  }
  return memorySummaries.slice(-limit).reverse();
}

function _resetMemory() { memorySummaries = []; if (pgPool) { try { pgPool.end(); } catch {} pgPool = null; } }

module.exports = { getPool, ensureSchema, persistSummary, persistFeedback, getRecentSummaries, _resetMemory };
