/**
 * phase1/services/s3.js — واجهة S3/MinIO مع fallback memory
 * تُستخدم لرفع الملفات المرفقة في المحادثات (المرحلة 2 ستستهلكها)
 */

const memoryFiles = new Map(); // key → { buffer, mime, size }

let s3Client = null;

async function getS3(config) {
  if (s3Client) return s3Client;
  const endpoint = config?.s3?.endpoint || process.env.S3_ENDPOINT;
  if (!endpoint) return null;
  try {
    const { S3Client } = require('@aws-sdk/client-s3'); // optional
    s3Client = new S3Client({
      region: config.s3.region || 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minio',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minio12345',
      },
    });
    return s3Client;
  } catch { return null; }
}

async function putFile(config, key, buffer, mime) {
  const c = await getS3(config);
  if (c) {
    try {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await c.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: buffer, ContentType: mime }));
      return { persisted: 's3', key };
    } catch {}
  }
  memoryFiles.set(key, { buffer, mime, size: buffer.length });
  return { persisted: 'memory', key };
}

async function getFile(config, key) {
  const c = await getS3(config);
  if (c) {
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const res = await c.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      const chunks = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {}
  }
  return memoryFiles.get(key)?.buffer || null;
}

async function deleteFile(config, key) {
  const c = await getS3(config);
  if (c) {
    try {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await c.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    } catch {}
  }
  memoryFiles.delete(key);
}

function _reset() { memoryFiles.clear(); if (s3Client) { try { s3Client.destroy(); } catch {} s3Client = null; } }

module.exports = { getS3, putFile, getFile, deleteFile, _reset };
