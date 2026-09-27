/**
 * phase2/routes/uploads.js — رفع الملفات إلى S3/MinIO (المرحلة 2)
 * POST /v1/uploads — multipart أو JSON base64
 */

const crypto = require('crypto');
const s3 = require('../../phase1/services/s3');

async function uploadRoutes(fastify, opts) {
  const config = opts.config || require('../../config');

  fastify.post('/v1/uploads', async (req, reply) => {
    const userId = req.user?.id || null;
    // دعم JSON بسيط: { filename, mime, dataBase64 }
    const { filename, mime, dataBase64 } = req.body || {};
    let buffer, name, type;
    if (dataBase64) {
      buffer = Buffer.from(String(dataBase64), 'base64');
      name = String(filename || `upload-${Date.now()}`);
      type = String(mime || 'application/octet-stream');
    } else if (req.isMultipart) {
      // لو @fastify/multipart متوفر
      try {
        const file = await req.file();
        if (!file) return reply.code(400).send({ error: 'file required' });
        const chunks = [];
        for await (const chunk of file.file) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
        name = file.filename;
        type = file.mimetype;
      } catch (e) {
        return reply.code(400).send({ error: String(e.message) });
      }
    } else {
      return reply.code(400).send({ error: 'provide {filename,mime,dataBase64} or multipart file' });
    }

    if (buffer.length > 20 * 1024 * 1024) return reply.code(413).send({ error: 'file too large (max 20MB)' });

    const ext = (name.split('.').pop() || 'bin').slice(0, 10);
    const key = `uploads/${userId || 'anon'}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const result = await s3.putFile(config, key, buffer, type);

    // سجل metadata في gateway_files
    const db = require('../../adapters/db');
    const pool = await db.getPool(config);
    if (pool) {
      try {
        await pool.query(
          'INSERT INTO gateway_files(user_id, s3_key, bucket, filename, mime_type, size_bytes) VALUES($1,$2,$3,$4,$5,$6)',
          [userId, key, config.s3.bucket, name, type, buffer.length]
        );
      } catch {}
    }

    return reply.code(201).send({ ok: true, key, bucket: config.s3.bucket, filename: name, mime: type, size: buffer.length, persisted: result.persisted });
  });

  fastify.get('/v1/uploads/:key', async (req, reply) => {
    // key قد يحتوي على /
    const key = req.params.key + (req.query?.rest ? `/${req.query.rest}` : '');
    // تبسيط: نتوقع key كامل في params['*'] — لكن نستخدم query fallback
    const actual = req.params['*'] || key;
    const data = await s3.getFile(config, actual);
    if (!data) return reply.code(404).send({ error: 'not found' });
    return reply.send(data);
  });
}

module.exports = { uploadRoutes };
