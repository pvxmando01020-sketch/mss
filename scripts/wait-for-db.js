/**
 * scripts/wait-for-db.js — ينتظر Postgres/Redis قبل بدء الخادم
 * يُستخدم في Docker entrypoint
 */
const config = require('../src/config');
const db = require('../src/adapters/db');

async function waitForPostgres(retries = 30, delay = 1000) {
  // وضع memory fallback صريح — لا تنتظر إذا لم يُضبط DATABASE_URL
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGUSER) {
    console.log('ℹ️  لا يوجد DATABASE_URL — memory fallback (بدون انتظار)');
    return false;
  }
  for (let i = 1; i <= retries; i++) {
    const pool = await db.getPool(config);
    if (pool) {
      try {
        await pool.query('SELECT 1');
        console.log(`✅ Postgres جاهز (محاولة ${i})`);
        return true;
      } catch (e) {
        console.log(`⏳ انتظار Postgres محاولة ${i}/${retries}: ${e.message.slice(0,60)}`);
      }
    } else {
      console.log(`⏳ انتظار Postgres محاولة ${i}/${retries}: لا يوجد pool بعد`);
      // إذا pg غير مثبت، لا فائدة من الانتظار
      try { require('pg'); } catch { console.log('ℹ️  pg غير مثبت — memory fallback'); return false; }
    }
    await new Promise(r => setTimeout(r, delay));
  }
  console.warn('⚠️  Postgres غير متاح بعد 30 محاولة — سيعمل بـ memory fallback');
  return false;
}

if (require.main === module) waitForPostgres().then(()=>process.exit(0));
module.exports = { waitForPostgres };
