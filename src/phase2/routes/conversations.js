/**
 * phase2/routes/conversations.js — إدارة المحادثات (المرحلة 2)
 * تُستخدم قبل التوجيه الذكي لتخزين السجل، وبعده لحفظ category/confidence
 */

const convService = require('../services/conversationService');
const { optionalAuth, requireAuth } = require('../middleware/jwt');

async function conversationRoutes(fastify, opts) {
  const config = opts.config || require('../../config');

  // إنشاء محادثة
  fastify.post('/v1/conversations', async (req, reply) => {
    const userId = req.user?.id || null;
    const { title, model } = req.body || {};
    const conv = await convService.createConversation(config, userId, { title, model });
    return reply.code(201).send({ conversation: conv });
  });

  // قائمة محادثات المستخدم (أو الضيف)
  fastify.get('/v1/conversations', async (req) => {
    const userId = req.user?.id || null;
    const limit = Math.min(100, Number(req.query?.limit || 20));
    const offset = Number(req.query?.offset || 0);
    const items = await convService.listConversations(config, userId, { limit, offset });
    return { conversations: items, limit, offset };
  });

  // جلب محادثة مع رسائلها
  fastify.get('/v1/conversations/:id', async (req, reply) => {
    const conv = await convService.getConversation(config, req.params.id);
    if (!conv) return reply.code(404).send({ error: 'not found' });
    // تحقق ملكية (لو مسجل)
    if (req.user && conv.user_id && conv.user_id !== req.user.id) return reply.code(403).send({ error: 'forbidden' });
    const messages = await convService.listMessages(config, conv.id, { limit: 200 });
    return { conversation: conv, messages };
  });

  // إضافة رسالة (user أو assistant)
  fastify.post('/v1/conversations/:id/messages', async (req, reply) => {
    const conv = await convService.getConversation(config, req.params.id);
    if (!conv) return reply.code(404).send({ error: 'conversation not found' });
    if (req.user && conv.user_id && conv.user_id !== req.user.id) return reply.code(403).send({ error: 'forbidden' });
    const { role, content, model, category, confidence, latency_ms } = req.body || {};
    if (!['user','assistant','system'].includes(role)) return reply.code(400).send({ error: 'role must be user|assistant|system' });
    const msg = await convService.addMessage(config, conv.id, { role, content, model, category, confidence, latency_ms });
    return reply.code(201).send({ message: msg });
  });

  // حذف محادثة
  fastify.delete('/v1/conversations/:id', async (req, reply) => {
    const userId = req.user?.id || null;
    const ok = await convService.deleteConversation(config, req.params.id, userId);
    if (!ok) return reply.code(404).send({ error: 'not found or forbidden' });
    return reply.send({ ok: true });
  });

  // مسار مريح: إنشاء محادثة + إرسال أول رسالة والتوجه الذكي في خطوة واحدة (يستهلكه Flutter)
  // POST /v1/conversations/:id/chat  { text } → يوجّه ذكيًا + يحفظ + يستدعي النموذج
  fastify.post('/v1/conversations/:id/chat', async (req, reply) => {
    const conv = await convService.getConversation(config, req.params.id);
    if (!conv) return reply.code(404).send({ error: 'conversation not found' });
    const text = String(req.body?.text ?? req.body?.prompt ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // حفظ رسالة المستخدم
    await convService.addMessage(config, conv.id, { role: 'user', content: text });

    // توجيه ذكي (مرحلة 3) + استدعاء نموذج
    const { route } = require('../../router');
    const { ScoreStore } = require('../../store');
    const { LocalCache } = require('../../cache');
    // استخدم stores من opts لو متوفرة (من server.js)، وإلا أنشئ مؤقتة
    const store = opts.store || new ScoreStore();
    const cache = opts.cache || new LocalCache();
    const decision = route(text, store, { cache, models: (opts.config || config).modelsByCategory });

    const { callModel } = require('../../adapters/modelAdapter');
    const { analyze, qualityFromErrors } = require('../../adapters/codeAnalyzer');
    const { singleton } = require('../../learning/codeErrorLearner');
    const t0 = Date.now();
    const result = await callModel(decision.model, text);
    const latency_ms = Date.now() - t0;
    singleton.recordRequest(decision.category, result.model);
    const vibeCtx = req.body?.vibe_context ?? req.body?.vibeContext ?? null;
    const analysis = analyze(result.text, { category: decision.category, vibeContext: vibeCtx || text });
    let autoError = null;
    if (analysis.hasCode && analysis.errorScore > 0) {
      autoError = { errorScore: analysis.errorScore, errors: analysis.errors, autoQuality: qualityFromErrors(analysis.errorScore) };
      await singleton.recordError(store, { category: decision.category, model: result.model, errorType: analysis.errors[0]?.type || 'other', severity: analysis.errors[0]?.severity || 'medium', code_snippet: analysis.errors[0]?.snippet, error_message: analysis.errors[0]?.msg, vibe_context: vibeCtx, auto_detected: true, conversation_id: conv.id });
    } else if (analysis.hasCode) { singleton.recordSuccess(store, decision.category, result.model); }

    const assistantMsg = await convService.addMessage(config, conv.id, {
      role: 'assistant', content: result.text, model: decision.model, category: decision.category, confidence: decision.confidence, latency_ms,
    });

    return reply.send({ ...decision, response: result.text, latency_ms, message: assistantMsg, conversation_id: conv.id, autoError });
  });
}

module.exports = { conversationRoutes };
