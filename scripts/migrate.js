/**
 * scripts/migrate.js — تشغيل migrations عبر pg Pool (بدون psql)
 * يعمل داخل Docker أو محليًا — fallback memory إذا لم يتوفر DB
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const db = require('../src/adapters/db');

async function run() {
  const pool = await db.getPool(config);
  if (!pool) {
    console.log('⚠️  لا يوجد Postgres — تخطي migrations (memory fallback)');
    return;
  }
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  console.log(`→ تشغيل ${files.length} migration...`);
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`  • ${f}`);
    try {
      await pool.query(sql);
      console.log(`    ✓ ${f}`);
    } catch (e) {
      // تجاهل أخطاء if exists لكن أظهرها
      if (String(e.message).includes('already exists')) {
        console.log(`    ↺ موجود مسبقاً: ${e.message.slice(0, 120)}`);
      } else {
        console.error(`    ✗ ${f}:`, e.message.slice(0, 300));
        throw e;
      }
    }
  }
  console.log('✅ كل migrations اكتملت');
  try { await pool.query('SELECT COUNT(*) FROM code_errors'); console.log('  • code_errors جاهز'); } catch {}
  await pool.end().catch(()=>{});
}

if (require.main === module) run().catch(e=>{ console.error(e); process.exit(1); });
module.exports = { run };
