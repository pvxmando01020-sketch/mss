/**
 * adapters/cacheRedis.js — كاش Redis مع fallback Map
 */

let redisClient = null;
const mem = new Map();

async function getRedis(config) {
  if (redisClient) return redisClient;
  const url = config?.redisUrl;
  if (!url) return null;
  try {
    const Redis = require('ioredis'); // optional
    redisClient = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: false });
    redisClient.on('error', () => {});
    return redisClient;
  } catch { return null; }
}

async function redisGet(config, key) {
  const c = await getRedis(config);
  if (c) {
    try { const v = await c.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  const e = mem.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { mem.delete(key); return null; }
  return e.value;
}

async function redisSet(config, key, value, ttlMs = 21600000) {
  const c = await getRedis(config);
  if (c) {
    try { await c.set(key, JSON.stringify(value), 'PX', ttlMs); return; } catch {}
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (mem.size > 1000) mem.delete(mem.keys().next().value);
}

async function redisDel(config, key) {
  const c = await getRedis(config);
  if (c) try { await c.del(key); } catch {}
  mem.delete(key);
}

function _reset() { mem.clear(); if (redisClient) { try { redisClient.disconnect(); } catch {} redisClient = null; } }

module.exports = { getRedis, redisGet, redisSet, redisDel, _reset };
