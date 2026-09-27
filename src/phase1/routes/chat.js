/**
 * phase1/routes/chat.js — البوابة الأساسية بدون توجيه ذكي (المرحلة 1)
 * POST /v1/chat/completions — استدعاء مباشر لنموذج محدد مع retry/fallback
 * هذه هي الطبقة التي يبنى عليها التوجيه الذكي في المرحلة 3
 */

const { callModel } = require('../../adapters/modelAdapter');
const db = require('../../adapters/db');

async function chatRoutes(fastify, opts) {
  const config = opts.config || require('../../config');

  // POST /v1/chat/completions — مباشر (بدون تصنيف)
  fastify.post('/v1/chat/completions', async (req, reply) => {
    const { model, prompt, text, message, stream } = req.body || {};
    const input = String(prompt ?? text ?? message ?? '').trim();
    if (!input) return reply.code(400).send({ error: 'prompt is required (prompt|text|message)' });
    const chosen = String(model || 'fast-cheap').trim();

    const t0 = Date.now();
    let result;
    let usedFallback = false;
    try {
      result = await callModel(chosen, input, { timeoutMs: 20000 });
    } catch (e) {
      // fallback إلى fast-cheap كما هو موجود في Gateway
      try {
        result = await callModel('fast-cheap', input, { timeoutMs: 15000 });
        usedFallback = true;
      } catch (e2) {
        return reply.code(502).send({ error: 'model_error', detail: String(e2.message || e2) });
      }
    }
    const latency_ms = Date.now() - t0;

    // تسجيل best-effort في gateway_requests
    try {
      const pool = await db.getPool(config);
      if (pool) {
        await pool.query(
          'INSERT INTO gateway_requests(model, prompt, response, latency_ms, status, tokens_prompt, tokens_completion) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [result.model, input.slice(0, 4000), result.text.slice(0, 8000), latency_ms, usedFallback ? 'fallback' : 'ok', result.usage?.prompt_tokens, result.usage?.completion_tokens]
        );
      }
    } catch {}

    // دعم streaming اختياري (SSE) — لو طلب العميل stream=true
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      const chunkSize = 30;
      for (let i = 0; i < result.text.length; i += chunkSize) {
        const chunk = result.text.slice(i, i + chunkSize);
        reply.raw.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 12));
      }
      reply.raw.write(`data: [DONE]\n\n`);
      reply.raw.end();
      return reply;
    }

    return reply.send({
      id: `chatcmpl-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [{ message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
      usage: result.usage,
      latency_ms,
      fallback: usedFallback || undefined,
    });
  });

  // POST /v1/embeddings — stub للمرحلة 1 (للـ RAG مستقبلاً)
  fastify.post('/v1/embeddings', async (req, reply) => {
    const input = String(req.body?.input ?? '').trim();
    if (!input) return reply.code(400).send({ error: 'input is required' });
    // إرجاع متجه وهمي (1536 بُعد) — في الإنتاج استبدل بـ API حقيقي
    const vec = Array.from({ length: 8 }, (_, i) => Number((Math.sin(input.length + i) * 0.5).toFixed(4)));
    return reply.send({ object: 'list', data: [{ object: 'embedding', embedding: vec, index: 0 }], model: 'mock-embed' });
  });
}

module.exports = { chatRoutes };
