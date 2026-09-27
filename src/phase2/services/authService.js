/**
 * phase2/services/authService.js — المصادقة (المرحلة 2)
 * JWT + API Keys + إدارة المستخدمين — تعمل مع Postgres أو memory fallback
 */

const crypto = require('crypto');
const db = require('../../adapters/db');

// fallback memory
const memUsers = new Map(); // email → { id, email, password_hash, role }
const memSessions = new Map(); // token → { user_id, expires_at }

function hashPassword(password) {
  try {
    const bcrypt = require('bcryptjs');
    return bcrypt.hashSync(password, 10);
  } catch {
    // fallback بسيط — ليس للإنتاج، لكن يكفي للاختبارات
    return 'sha256:' + crypto.createHash('sha256').update(String(password)).digest('hex');
  }
}

function verifyPassword(password, hash) {
  try {
    const bcrypt = require('bcryptjs');
    if (hash.startsWith('$2')) return bcrypt.compareSync(password, hash);
  } catch {}
  const h = 'sha256:' + crypto.createHash('sha256').update(String(password)).digest('hex');
  return h === hash;
}

function signJwt(payload, secret, expiresIn = '7d') {
  try {
    const jwt = require('jsonwebtoken');
    return jwt.sign(payload, secret, { expiresIn });
  } catch {
    // fallback — توقيع بسيط base64 (غير آمن للإنتاج، للاختبارات فقط)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }
}

function verifyJwt(token, secret) {
  try {
    const jwt = require('jsonwebtoken');
    return jwt.verify(token, secret);
  } catch (e) {
    // fallback verify
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('invalid token');
    const [h, b, s] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
    if (s !== expected) throw new Error('invalid signature');
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
    return payload;
  }
}

function jwtSecret(config) {
  return config?.jwtSecret || process.env.JWT_SECRET || 'dev-secret-change-me';
}

async function createUser(config, { email, password, role = 'user' }) {
  const normalized = String(email).toLowerCase().trim();
  if (!normalized || !password || String(password).length < 6) throw Object.assign(new Error('email and password (min 6) required'), { statusCode: 400 });
  const hash = hashPassword(password);

  // حاول Postgres أولاً
  const pool = await db.getPool(config);
  if (pool) {
    try {
      const { rows } = await pool.query(
        'INSERT INTO users(email, password_hash, role) VALUES($1,$2,$3) RETURNING id, email, role, created_at',
        [normalized, hash, role]
      );
      return rows[0];
    } catch (e) {
      if (String(e.message).includes('duplicate') || String(e.code) === '23505') throw Object.assign(new Error('email already exists'), { statusCode: 409 });
      throw e;
    }
  }
  if (memUsers.has(normalized)) throw Object.assign(new Error('email already exists'), { statusCode: 409 });
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = { id, email: normalized, password_hash: hash, role, created_at: new Date().toISOString() };
  memUsers.set(normalized, user);
  return { id: user.id, email: user.email, role: user.role, created_at: user.created_at };
}

async function findUserByEmail(config, email) {
  const normalized = String(email).toLowerCase().trim();
  const pool = await db.getPool(config);
  if (pool) {
    const { rows } = await pool.query('SELECT id, email, password_hash, role, created_at FROM users WHERE email=$1', [normalized]);
    return rows[0] || null;
  }
  return memUsers.get(normalized) || null;
}

async function authenticate(config, email, password) {
  const user = await findUserByEmail(config, email);
  if (!user) throw Object.assign(new Error('invalid credentials'), { statusCode: 401 });
  if (!verifyPassword(password, user.password_hash)) throw Object.assign(new Error('invalid credentials'), { statusCode: 401 });
  const secret = jwtSecret(config);
  const token = signJwt({ sub: user.id, email: user.email, role: user.role }, secret);
  // خزن session best-effort
  const pool = await db.getPool(config);
  if (pool) {
    try {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1,$2,NOW() + INTERVAL \'7 days\')', [user.id, hash]);
    } catch {}
  } else {
    memSessions.set(token, { user_id: user.id, expires_at: Date.now() + 7 * 24 * 3600 * 1000 });
  }
  return { token, user: { id: user.id, email: user.email, role: user.role } };
}

async function verifyToken(config, token) {
  const secret = jwtSecret(config);
  const payload = verifyJwt(token, secret);
  return payload;
}

function _reset() { memUsers.clear(); memSessions.clear(); }

module.exports = { createUser, findUserByEmail, authenticate, verifyToken, verifyJwt, signJwt, hashPassword, verifyPassword, jwtSecret, _reset };
