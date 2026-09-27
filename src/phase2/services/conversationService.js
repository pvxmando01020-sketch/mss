/**
 * phase2/services/conversationService.js — إدارة المحادثات والرسائل (المرحلة 2)
 * Postgres → fallback memory Map
 */

const crypto = require('crypto');
const db = require('../../adapters/db');

const memConvs = new Map(); // id → conv
const memMsgs = new Map(); // convId → [messages]

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

async function createConversation(config, userId, { title, model } = {}) {
  const pool = await db.getPool(config);
  const t = String(title || 'محادثة جديدة').slice(0, 200);
  if (pool) {
    const { rows } = await pool.query(
      'INSERT INTO conversations(user_id, title, model) VALUES($1,$2,$3) RETURNING id, user_id, title, model, created_at, updated_at',
      [userId || null, t, model || null]
    );
    return rows[0];
  }
  const id = uuid();
  const conv = { id, user_id: userId || null, title: t, model: model || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  memConvs.set(id, conv);
  memMsgs.set(id, []);
  return conv;
}

async function listConversations(config, userId, { limit = 20, offset = 0 } = {}) {
  const pool = await db.getPool(config);
  if (pool) {
    const { rows } = await pool.query(
      'SELECT id, user_id, title, model, created_at, updated_at FROM conversations WHERE user_id IS NOT DISTINCT FROM $1::uuid ORDER BY updated_at DESC LIMIT $2 OFFSET $3',
      [userId || null, Math.min(100, limit), offset]
    );
    return rows;
  }
  const all = [...memConvs.values()].filter(c => (c.user_id || null) === (userId || null)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return all.slice(offset, offset + limit);
}

async function getConversation(config, id) {
  const pool = await db.getPool(config);
  if (pool) {
    const { rows } = await pool.query('SELECT id, user_id, title, model, pinned_model, created_at, updated_at FROM conversations WHERE id=$1', [id]);
    return rows[0] || null;
  }
  return memConvs.get(id) || null;
}

async function addMessage(config, conversationId, { role, content, model, category, confidence, latency_ms }) {
  const pool = await db.getPool(config);
  const text = String(content || '').trim();
  if (!text) throw Object.assign(new Error('content required'), { statusCode: 400 });
  if (pool) {
    const { rows } = await pool.query(
      'INSERT INTO messages(conversation_id, role, content, model, category, confidence, latency_ms) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, conversation_id, role, content, model, category, confidence, latency_ms, created_at',
      [conversationId, role, text, model || null, category || null, confidence ?? null, latency_ms ?? null]
    );
    await pool.query('UPDATE conversations SET updated_at=NOW() WHERE id=$1', [conversationId]).catch(()=>{});
    return rows[0];
  }
  const conv = memConvs.get(conversationId);
  if (!conv) throw Object.assign(new Error('conversation not found'), { statusCode: 404 });
  const msg = { id: uuid(), conversation_id: conversationId, role, content: text, model: model || null, category: category || null, confidence: confidence ?? null, latency_ms: latency_ms ?? null, created_at: new Date().toISOString() };
  memMsgs.get(conversationId).push(msg);
  conv.updated_at = new Date().toISOString();
  return msg;
}

async function listMessages(config, conversationId, { limit = 50, offset = 0 } = {}) {
  const pool = await db.getPool(config);
  if (pool) {
    const { rows } = await pool.query(
      'SELECT id, conversation_id, role, content, model, category, confidence, latency_ms, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
      [conversationId, Math.min(200, limit), offset]
    );
    return rows;
  }
  const arr = memMsgs.get(conversationId) || [];
  return arr.slice(offset, offset + limit);
}

async function deleteConversation(config, id, userId) {
  const pool = await db.getPool(config);
  if (pool) {
    const { rowCount } = await pool.query('DELETE FROM conversations WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2::uuid', [id, userId || null]);
    return rowCount > 0;
  }
  const c = memConvs.get(id);
  if (!c || (c.user_id || null) !== (userId || null)) return false;
  memConvs.delete(id);
  memMsgs.delete(id);
  return true;
}

function _reset() { memConvs.clear(); memMsgs.clear(); }

module.exports = { createConversation, listConversations, getConversation, addMessage, listMessages, deleteConversation, _reset };
