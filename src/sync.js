/**
 * sync.js — مزامنة ملخصات ScoreStore إلى Postgres + سحب/دمج (multi-device)
 */

const db = require('./adapters/db');

/**
 * يدفع ملخص واحد إلى Postgres (best-effort، لا يرمي خطأ)
 */
async function pushSummary(config, store) {
  const summary = store.summaryForPostgres();
  try {
    const res = await db.persistSummary(config, summary);
    return res;
  } catch (e) {
    return { persisted: 'error', error: String(e) };
  }
}

/**
 * دفع دوري كل N ثانية
 */
function startPeriodicSync(config, store, intervalMs = 5 * 60 * 1000) {
  const id = setInterval(() => { pushSummary(config, store).catch(() => {}); }, intervalMs);
  if (id.unref) id.unref();
  return () => clearInterval(id);
}

/**
 * سحب آخر ملخص ودمجه في Store المحلي (للمزامنة عبر أجهزة)
 */
async function pullAndMerge(config, store, limit = 1) {
  const rows = await db.getRecentSummaries(config, limit);
  if (!rows.length) return null;
  const latest = rows[0].data ?? rows[0];
  // latest قد يكون string JSON لو جاء من memory
  const obj = typeof latest === 'string' ? JSON.parse(latest) : latest;
  if (obj?.summary) store.mergeSummary(obj);
  else if (obj?.scores) store.mergeSummary({ summary: obj });
  return obj;
}

module.exports = { pushSummary, startPeriodicSync, pullAndMerge };
