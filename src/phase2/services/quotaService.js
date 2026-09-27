/**
 * phase2/services/quotaService.js — الحصص والاستخدام اليومي (المرحلة 2)
 * يحد من الطلبات حسب خطة المستخدم — fallback memory
 */

const db = require('../../adapters/db');
const memUsage = new Map(); // `${userId}:${day}` → { requests, tokens }

function today() { return new Date().toISOString().slice(0, 10); }

async function getUsage(config, userId) {
  const day = today();
  const pool = await db.getPool(config);
  if (pool) {
    const { rows } = await pool.query('SELECT requests, tokens_total FROM usage_daily WHERE user_id=$1 AND day=$2', [userId, day]);
    return rows[0] || { requests: 0, tokens_total: 0 };
  }
  return memUsage.get(`${userId}:${day}`) || { requests: 0, tokens_total: 0 };
}

async function incUsage(config, userId, tokens = 0) {
  const day = today();
  const pool = await db.getPool(config);
  if (pool) {
    await pool.query(
      `INSERT INTO usage_daily(user_id, day, requests, tokens_total) VALUES($1,$2,1,$3)
       ON CONFLICT (user_id, day) DO UPDATE SET requests = usage_daily.requests + 1, tokens_total = usage_daily.tokens_total + $3`,
      [userId, day, tokens]
    );
    return;
  }
  const key = `${userId}:${day}`;
  const cur = memUsage.get(key) || { requests: 0, tokens_total: 0 };
  cur.requests += 1;
  cur.tokens_total += tokens;
  memUsage.set(key, cur);
}

async function checkQuota(config, userId, quotaDaily = 1000) {
  const usage = await getUsage(config, userId);
  if (usage.requests >= quotaDaily) {
    const err = new Error('quota_exceeded');
    err.statusCode = 429;
    err.quota = quotaDaily;
    err.used = usage.requests;
    throw err;
  }
  return usage;
}

function _reset() { memUsage.clear(); }

module.exports = { getUsage, incUsage, checkQuota, _reset, today };
