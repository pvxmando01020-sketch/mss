/**
 * server.js — مصنع Fastify الكامل للمرحلة 1 + 2 + 3 + 4
 *
 * المرحلة 1: البنية التحتية (Fastify + Postgres/Redis/S3 + محول النماذج)
 * المرحلة 2: التطبيق (Auth + Conversations + Uploads)
 * المرحلة 3: التوجيه الذكي (Smart Routing)
 * المرحلة 4: الإشراف (Moderation) + Benchmark
 *
 * يعمل بدون تثبيت fastify/pg/ioredis — يعيد stub server للاختبارات.
 */

const config = require('./config');
const { ScoreStore } = require('./store');
const { LocalCache } = require('./cache');
const { smartRouterPlugin } = require('./gateway');
const { preCheck, postCheck } = require('./moderation');
const { callModel } = require('./adapters/modelAdapter');
const db = require('./adapters/db');
const { estimateQuality, applyFeedback } = require('./logger');
const { pushSummary } = require('./sync');
const { analyze: analyzeCode, qualityFromErrors } = require('./adapters/codeAnalyzer');
const { singleton: codeErrorLearner } = require('./learning/codeErrorLearner');

function createStores(opts = {}) {
  const store = opts.store ?? new ScoreStore({}, { alpha: config.routing.alpha, epsilon: config.routing.epsilon });
  const cache = opts.cache ?? new LocalCache({ maxEntries: config.routing.cacheMax, ttlMs: config.routing.cacheTtlMs });
  return { store, cache };
}

/**
 * يبني تطبيق Fastify حقيقي لو fastify متوفر، وإلا يعيد stub للاختبارات
 */
async function buildApp(opts = {}) {
  const { store, cache } = createStores(opts);
  let fastify;
  try {
    const Fastify = require('fastify');
    fastify = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  } catch {
    return buildStubApp(store, cache, opts);
  }

  // —— إضافات عامة (مرحلة 1) ——
  try { await fastify.register(require('@fastify/cors'), { origin: true, credentials: true }); } catch {}
  try { await fastify.register(require('@fastify/helmet')); } catch {}
  try { await fastify.register(require('@fastify/compress')); } catch {}

  // logger
  try { require('./phase1/middleware/requestLogger').requestLogger(fastify); } catch {}

  // auth الاختياري — يضيف request.user إن وجد token
  try {
    const { optionalAuth } = require('./phase2/middleware/jwt');
    fastify.addHook('preHandler', await optionalAuth(config));
  } catch {}

  // rate limiting عام (مرحلة 1) — 120 طلب/دقيقة للـ IP
  try {
    const { rateLimit } = require('./phase1/middleware/rateLimit');
    fastify.addHook('preHandler', rateLimit({ windowMs: 60_000, max: 120 }));
  } catch {}

  // —— المرحلة 1: الصحة والنماذج والمقاييس ——
  try {
    const { healthRoutes } = require('./phase1/routes/health');
    await fastify.register(healthRoutes, { config });
  } catch (e) {
    fastify.get('/health', async () => ({ ok: true, version: '1.1.0', phase: '1+2+3+5' }));
    fastify.get('/v1/models', async () => ({ modelsByCategory: config.modelsByCategory }));
  }
  try {
    const { metricsRoutes } = require('./phase1/routes/metrics');
    await fastify.register(metricsRoutes, { config });
  } catch {}

  // —— المرحلة 2: Auth + Conversations + Uploads + Quota + Admin ——
  try {
    const { authRoutes } = require('./phase2/routes/auth');
    await fastify.register(authRoutes, { config });
  } catch {}
  try {
    const { conversationRoutes } = require('./phase2/routes/conversations');
    await fastify.register(conversationRoutes, { config, store, cache });
  } catch {}
  try {
    const { uploadRoutes } = require('./phase2/routes/uploads');
    await fastify.register(uploadRoutes, { config });
    // دعم multipart لو متوفر
    try { await fastify.register(require('@fastify/multipart'), { limits: { fileSize: 20 * 1024 * 1024 } }); } catch {}
  } catch {}
  try {
    const { adminRoutes } = require('./phase1/routes/admin');
    await fastify.register(adminRoutes, { config, store });
  } catch {}

  // —— المرحلة 3: التوجيه الذكي ——
  await fastify.register(smartRouterPlugin, {
    store, cache,
    modelsByCategory: config.modelsByCategory,
    persistSummary: async (summary) => { await db.persistSummary(config, summary); },
  });

  // إكمال المحادثة الذكي + المباشر (مرحلة 1 + 3 موحدة)
  // إذا أرسل العميل { model } → مباشر (مرحلة 1)، وإلا → توجيه ذكي (مرحلة 3)
  fastify.post('/v1/chat/completions', async (req, reply) => {
    const body = req.body || {};
    const text = String(body.text ?? body.prompt ?? body.message ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text is required' });

    // حصص (مرحلة 2) — تحقق قبل المعالجة
    if (req.user?.id) {
      try {
        const { checkQuota } = require('./phase2/services/quotaService');
        const quota = req.user.quota_daily || 1000;
        await checkQuota(config, req.user.id, quota);
      } catch (qErr) {
        if (qErr.statusCode === 429) return reply.code(429).send({ error: 'quota_exceeded', used: qErr.used, quota: qErr.quota });
      }
    }

    if (config.moderation.enabled) {
      const pre = preCheck(text, config.moderation);
      if (pre.action === 'block') return reply.code(400).send({ error: 'blocked', reason: pre.reason });
    }

    // حالة مباشرة (مرحلة 1): العميل حدد model صراحة وطلب تجاوز ذكي
    const directModel = body.model && typeof body.model === 'string' && body.model !== 'auto' ? String(body.model).trim() : null;
    const useDirect = !!directModel && (body.smart === false || body.bypassRouting === true || !!body.direct);

    let decision, modelToCall;
    if (useDirect) {
      decision = { category: 'general', model: directModel, confidence: 1, complexity: 'medium', method: 'direct', bypassed: true };
      modelToCall = directModel;
    } else {
      const { route } = require('./router');
      decision = route(text, store, { cache, models: config.modelsByCategory, epsilon: config.routing.epsilon });
      if (decision.cached && decision.value) {
        // حفظ في المحادثة لو conversation_id موجود (مرحلة 2)
        const _convIdCached = body.conversation_id ?? body.conversationId;
        if (_convIdCached) {
          try {
            const convService = require('./phase2/services/conversationService');
            await convService.addMessage(config, _convIdCached, { role: 'user', content: text });
            await convService.addMessage(config, _convIdCached, { role: 'assistant', content: decision.value, model: decision.model, category: decision.category, confidence: decision.confidence });
          } catch {}
        }
        return reply.send({ ...decision, response: decision.value, source: 'cache', latency_ms: 0 });
      }
      modelToCall = decision.model;
    }

    const t0 = Date.now();
    let result;
    let usedFallback = false;
    try {
      result = await callModel(modelToCall, text, { timeoutMs: 20000 });
    } catch (e) {
      try {
        result = await callModel('fast-cheap', text, { timeoutMs: 15000 });
        usedFallback = true;
      } catch (e2) {
        return reply.code(502).send({ error: 'model_error', detail: String(e2.message || e) });
      }
    }
    const latency_ms = Date.now() - t0;

    if (config.moderation.enabled) {
      const post = postCheck(result.text, config.moderation);
      if (post.action === 'block') return reply.send({ ...decision, response: '[تم حجب الرد بسبب السياسة]', blocked: true, latency_ms });
    }

    // — التعلم من أخطاء الكود والـ Vibe Code (التحديث الجديد) —
    let autoError = null;
    const vibeCtx = body.vibe_context ?? body.vibeContext ?? null;
    if (decision.category === 'code' || decision.category === 'vibe' || /```/.test(result.text)) {
      codeErrorLearner.recordRequest(decision.category, result.model);
      const analysis = analyzeCode(result.text, { category: decision.category, vibeContext: vibeCtx || text });
      if (analysis.hasCode && analysis.errorScore > 0) {
        const autoQuality = qualityFromErrors(analysis.errorScore);
        autoError = { errorScore: analysis.errorScore, errors: analysis.errors, autoQuality };
        await codeErrorLearner.recordError(store, {
          category: decision.category,
          model: result.model,
          errorType: analysis.errors[0]?.type || 'other',
          severity: analysis.errors[0]?.severity || 'medium',
          code_snippet: analysis.errors[0]?.snippet,
          error_message: analysis.errors[0]?.msg,
          vibe_context: vibeCtx,
          auto_detected: true,
          latency_ms,
          conversation_id: body.conversation_id || body.conversationId || null,
        });
      } else if (analysis.hasCode) {
        codeErrorLearner.recordSuccess(store, decision.category, result.model);
      }
    }

    if (!useDirect && decision.complexity === 'simple') {
      const { hashKey } = require('./cache');
      cache.set(hashKey(text, decision.category, decision.model), result.text);
    }

    // تحديث الحصص بعد النجاح (مرحلة 2)
    if (req.user?.id) {
      try { const { incUsage } = require('./phase2/services/quotaService'); await incUsage(config, req.user.id, result.usage?.prompt_tokens || 0); } catch {}
    }

    // حفظ في المحادثة (مرحلة 2) لو conversation_id مُرسل
    {
      const _convIdSave = body.conversation_id ?? body.conversationId;
      if (_convIdSave) {
      try {
        const convService = require('./phase2/services/conversationService');
        // تأكد أن المحادثة موجودة
        const conv = await convService.getConversation(config, _convIdSave);
        if (conv) {
          // رسالة المستخدم قد تكون حُفظت مسبقاً في /conversations/:id/chat، لكن هنا نحفظها لو لم تكن
          // نتجنب التكرار بفحص آخر رسالة — تبسيط: نحفظ فقط رد المساعد
          await convService.addMessage(config, _convIdSave, { role: 'assistant', content: result.text, model: result.model, category: decision.category, confidence: decision.confidence, latency_ms });
        }
      } catch {}
      }
    }

    // سجل في gateway_requests (مرحلة 1)
    try {
      const pool = await db.getPool(config);
      if (pool) {
        await pool.query(
          'INSERT INTO gateway_requests(model, prompt, response, latency_ms, status, tokens_prompt, tokens_completion) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [result.model, text.slice(0, 4000), result.text.slice(0, 8000), latency_ms, usedFallback ? 'fallback' : 'ok', result.usage?.prompt_tokens, result.usage?.completion_tokens]
        ).catch(()=>{});
      }
    } catch {}

    // streaming اختياري (مرحلة 1)
    if (body.stream) {
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

    return reply.send({ ...decision, response: result.text, latency_ms, usage: result.usage, fallback: usedFallback || undefined, autoError });
  });

  // — التحديث الجديد: التعلم من أخطاء الكود والـ Vibe Code —
  fastify.post('/v1/feedback/code-error', async (req, reply) => {
    const b = req.body ?? {};
    const category = b.category, model = b.model, errorType = b.errorType ?? b.error_type, severity = b.severity;
    const code_snippet = b.code_snippet ?? b.codeSnippet, error_message = b.error_message ?? b.errorMessage, vibe_context = b.vibe_context ?? b.vibeContext;
    const conversation_id = b.conversation_id ?? b.conversationId, message_id = b.message_id ?? b.messageId;
    if (!model) return reply.code(400).send({ error: 'model is required' });
    const cat = category || (vibe_context ? 'vibe' : 'code');
    const sev = ['low','medium','high','critical'].includes(severity) ? severity : 'medium';
    const result = await codeErrorLearner.recordError(store, {
      category: cat, model, errorType: errorType || 'other', severity: sev,
      code_snippet, error_message, vibe_context, auto_detected: false,
      user_id: req.user?.id || null, conversation_id: conversation_id || null, message_id: message_id || null,
    });
    await pushSummary(config, store).catch(() => {});
    return reply.send({ ok: true, ...result, score: store.get(cat, model), errorRate: codeErrorLearner.getErrorRate(cat, model) });
  });

  fastify.post('/v1/feedback/vibe-error', async (req, reply) => {
    const b = req.body ?? {};
    const model = b.model, errorType = b.errorType ?? b.error_type ?? 'vibe_mismatch', severity = b.severity ?? 'medium';
    const code_snippet = b.code_snippet ?? b.codeSnippet, error_message = b.error_message ?? b.errorMessage, vibe_context = b.vibe_context ?? b.vibeContext;
    const conversation_id = b.conversation_id ?? b.conversationId, message_id = b.message_id ?? b.messageId;
    if (!model) return reply.code(400).send({ error: 'model is required' });
    const result = await codeErrorLearner.recordError(store, {
      category: 'vibe', model, errorType, severity: severity || 'medium',
      code_snippet, error_message, vibe_context, auto_detected: false,
      user_id: req.user?.id || null, conversation_id, message_id,
    });
    await pushSummary(config, store).catch(() => {});
    return reply.send({ ok: true, ...result, score: store.get('vibe', model), errorRate: codeErrorLearner.getErrorRate('vibe', model) });
  });

  fastify.post('/v1/feedback/code-success', async (req, reply) => {
    const { category, model } = req.body ?? {};
    if (!model) return reply.code(400).send({ error: 'model is required' });
    const cat = category || 'code';
    codeErrorLearner.recordSuccess(store, cat, model);
    return reply.send({ ok: true, score: store.get(cat, model), errorRate: codeErrorLearner.getErrorRate(cat, model) });
  });

  fastify.get('/v1/learning/code-stats', async (req, reply) => {
    const stats = codeErrorLearner.snapshot();
    // أضف errorRate لكل نموذج/فئة
    const rates = {};
    for (const cat of ['code','vibe']) {
      rates[cat] = {};
      for (const m of ['strong-code','claude','fast-cheap','accurate-math']) {
        rates[cat][m] = codeErrorLearner.getErrorRate(cat, m);
      }
    }
    return reply.send({ ...stats, rates, store: store.summaryForPostgres() });
  });

  // تحليل كود مباشر (للاختبار)
  fastify.post('/v1/code/analyze', async (req, reply) => {
    const b = req.body ?? {};
    const text = b.text, category = b.category, vibe_context = b.vibe_context ?? b.vibeContext;
    if (!text) return reply.code(400).send({ error: 'text is required' });
    const result = analyzeCode(text, { category, vibeContext: vibe_context });
    return reply.send(result);
  });

  // feedback يحسب quality عبر proxies (مرحلة 3b) — محدث ليدعم codeError/vibeError
  fastify.post('/v1/feedback/auto', async (req, reply) => {
    const b = req.body ?? {};
    const category = b.category, model = b.model, latency_ms = b.latency_ms ?? b.latencyMs, regenerated = b.regenerated, editedLength = b.editedLength, originalLength = b.originalLength, thumbsUp = b.thumbsUp, thumbsDown = b.thumbsDown, manualCorrection = b.manualCorrection;
    const conversation_id = b.conversation_id ?? b.conversationId, message_id = b.message_id ?? b.messageId, codeError = b.codeError, vibeError = b.vibeError, errorSeverity = b.errorSeverity ?? b.severity;
    if (!category || !model) return reply.code(400).send({ error: 'category and model required' });
    const quality = estimateQuality({ regenerated, editedLength, originalLength, latency_ms, thumbsUp, thumbsDown, codeError, vibeError, errorSeverity });
    const entry = { category, model, quality_score: quality, latency_ms, regenerated, manualCorrection };
    applyFeedback(store, entry);
    // إذا كان خطأ كود صريح، سجله أيضاً في learner
    if (codeError || vibeError) {
      await codeErrorLearner.recordError(store, {
        category, model, errorType: vibeError ? 'vibe_mismatch' : 'other', severity: errorSeverity || 'medium',
        auto_detected: false, user_id: req.user?.id || null, conversation_id, message_id,
      });
    }
    await db.persistFeedback(config, { ...entry, quality_score: quality }).catch(() => {});
    await pushSummary(config, store).catch(() => {});
    // لو ضمن محادثة، حدّث الرسالة regenerated
    if (conversation_id && message_id) {
      try {
        const pool = await db.getPool(config);
        if (pool) await pool.query('UPDATE messages SET regenerated=$1 WHERE id=$2', [!!regenerated, message_id]);
      } catch {}
    }
    return reply.send({ ok: true, quality, score: store.get(category, model), errorRate: codeErrorLearner.getErrorRate(category, model) });
  });

  // تهيئة DB (best-effort) — يشمل 000 + 001 + 002
  db.ensureSchema(config).catch(() => {});

  // معالج أخطاء موحد
  try {
    const { errorHandler } = require('./phase1/middleware/errorHandler');
    fastify.setErrorHandler(errorHandler);
  } catch {}

  return fastify;
}

// ——— Stub للاختبارات بدون fastify ———
function buildStubApp(store, cache, opts) {
  const routes = []; // { method, path, regex, paramNames, handler, preHandlers }
  const hooks = { preHandler: [] };

  function pathToRegex(path) {
    const paramNames = [];
    const regexStr = path.replace(/:([^/]+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; }).replace(/\//g, '\\/');
    return { regex: new RegExp(`^${regexStr}$`), paramNames };
  }

  function parseRouteArgs(path, a, b) {
    // يدعم: (path, handler)  أو  (path, opts, handler)
    let handler = b ?? a;
    let opts = null;
    if (b && typeof a === 'object' && a !== null && !Array.isArray(a) && typeof b === 'function') {
      opts = a;
      handler = b;
    } else if (typeof a === 'function') {
      handler = a;
    }
    // opts قد تحتوي preHandler
    let preHandlers = [];
    if (opts && opts.preHandler) {
      preHandlers = Array.isArray(opts.preHandler) ? opts.preHandler : [opts.preHandler];
    }
    return { handler, preHandlers };
  }

  const stub = {
    store, cache, config,
    get(path, a, b) {
      const { handler, preHandlers } = parseRouteArgs(path, a, b);
      const { regex, paramNames } = pathToRegex(path);
      routes.push({ method: 'GET', path, regex, paramNames, handler, preHandlers });
    },
    post(path, a, b) {
      const { handler, preHandlers } = parseRouteArgs(path, a, b);
      const { regex, paramNames } = pathToRegex(path);
      routes.push({ method: 'POST', path, regex, paramNames, handler, preHandlers });
    },
    delete(path, a, b) {
      const { handler, preHandlers } = parseRouteArgs(path, a, b);
      const { regex, paramNames } = pathToRegex(path);
      routes.push({ method: 'DELETE', path, regex, paramNames, handler, preHandlers });
    },
    addHook(name, fn) { if (hooks[name]) hooks[name].push(fn); },
    register: async (plugin, pOpts) => {
      if (typeof plugin === 'function') {
        const fakeFastify = {
          get: (p, a, b) => stub.get(p, a, b),
          post: (p, a, b) => stub.post(p, a, b),
          delete: (p, a, b) => stub.delete(p, a, b),
          addHook: stub.addHook,
          register: stub.register,
        };
        await plugin(fakeFastify, { store, cache, ...pOpts, config });
      }
    },
    setErrorHandler: () => {},
    hasPlugin: false,
    inject: async ({ method, url, payload, headers = {} }) => {
      const [pathOnly, qs] = String(url).split('?');
      const query = {};
      if (qs) {
        for (const part of qs.split('&')) {
          const [k, v] = part.split('=');
          if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
        }
      }
      const m = String(method).toUpperCase();
      let matched = null;
      let params = {};
      for (const r of routes) {
        if (r.method !== m) continue;
        const match = pathOnly.match(r.regex);
        if (match) {
          matched = r;
          params = {};
          r.paramNames.forEach((name, idx) => { params[name] = decodeURIComponent(match[idx + 1]); });
          // دعم *: باقي المسار
          if (r.path.includes('*')) {
            const starIdx = r.path.indexOf('*');
            const prefix = r.path.slice(0, starIdx);
            if (pathOnly.startsWith(prefix)) params['*'] = pathOnly.slice(prefix.length);
          }
          break;
        }
      }
      if (!matched) return { statusCode: 404, json: () => ({ error: 'not found', path: url }), body: { error: 'not found' } };
      let body = null, status = 200;
      const req = { body: payload, query, params, headers, url, method: m, user: null, log: { info: () => {}, warn: () => {}, error: () => {} } };
      const reply = {
        code(c) { status = c; return reply; },
        send(p) { body = p; return reply; },
        header: () => reply,
        raw: { writeHead: () => {}, write: () => {}, end: () => {} },
      };
      // شغّل preHandler hooks (optionalAuth)
      for (const hook of hooks.preHandler) {
        // eslint-disable-next-line no-await-in-loop
        await hook(req, reply);
        if (body !== null || status >= 400) break; // لو رد مبكراً
      }
      // شغّل preHandlers الخاصة بالمسار (مثل requireAuth)
      if (body === null && matched.preHandlers && matched.preHandlers.length) {
        for (const hook of matched.preHandlers) {
          // eslint-disable-next-line no-await-in-loop
          await hook(req, reply);
          if (body !== null || status >= 400) break;
        }
      }
      if (body === null) {
        try {
          const ret = await matched.handler(req, reply);
          if (body === null && ret !== undefined) body = ret;
        } catch (e) {
          status = e.statusCode || 500;
          body = { error: e.message || 'internal_error' };
        }
      }
      if (body === null) body = {};
      return { statusCode: status, json: () => body, body };
    },
    listen: async () => ({ address: () => 'stub://' }),
    close: async () => {},
  };

  // سجل مباشرة كل المسارات المطلوبة للـ stub
  return (async () => {
    // health fallback
    stub.get('/health', async (req, reply) => reply.send({ ok: true, version: '1.1.0-stub', phase: '1+2+3+5' }));
    stub.get('/ready', async (req, reply) => reply.send({ ok: true, checks: { postgres: 'memory-fallback', redis: 'memory-fallback' } }));
    stub.get('/v1/models', async (req, reply) => reply.send({ modelsByCategory: config.modelsByCategory, adapters: require('./adapters/modelAdapter').adapters }));
    stub.get('/metrics', async (req, reply) => {
      reply.header('Content-Type', 'text/plain');
      return reply.send('# HELP mss_uptime_seconds Uptime\nmss_uptime_seconds 123\n');
    });

    // optionalAuth + rateLimit للـ stub
    try {
      const { optionalAuth } = require('./phase2/middleware/jwt');
      const hook = await optionalAuth(config);
      stub.addHook('preHandler', hook);
    } catch {}
    try {
      const { rateLimit } = require('./phase1/middleware/rateLimit');
      stub.addHook('preHandler', rateLimit({ windowMs: 60_000, max: 120 }));
    } catch {}

    // سجل كل plugins — auth, conversations, uploads, smartRouter
    try { const { authRoutes } = require('./phase2/routes/auth'); await stub.register(authRoutes, { config }); } catch {}
    try {
      const { conversationRoutes } = require('./phase2/routes/conversations');
      await stub.register(conversationRoutes, { config, store, cache });
    } catch {}
    try { const { uploadRoutes } = require('./phase2/routes/uploads'); await stub.register(uploadRoutes, { config }); } catch {}
    try { const { healthRoutes } = require('./phase1/routes/health'); await stub.register(healthRoutes, { config }); } catch {}

    await stub.register(smartRouterPlugin, {
      store, cache,
      modelsByCategory: config.modelsByCategory,
      persistSummary: async (s) => db.persistSummary(config, s),
    });

    // main smart chat للـ stub (موحد 1+3) — يدعم quota + conversation_id
    stub.post('/v1/chat/completions', async (req, reply) => {
      const body = req.body || {};
      const text = String(body.text ?? body.prompt ?? body.message ?? '').trim();
      if (!text) return reply.code(400).send({ error: 'text is required' });
      if (req.user?.id) {
        try {
          const { checkQuota } = require('./phase2/services/quotaService');
          await checkQuota(config, req.user.id, req.user.quota_daily || 1000);
        } catch (qErr) {
          if (qErr.statusCode === 429) return reply.code(429).send({ error: 'quota_exceeded', used: qErr.used, quota: qErr.quota });
        }
      }
      if (config.moderation.enabled) {
        const pre = preCheck(text, config.moderation);
        if (pre.action === 'block') return reply.code(400).send({ error: 'blocked', reason: pre.reason });
      }
      const directModel = body.model && body.model !== 'auto' ? String(body.model).trim() : null;
      const useDirect = !!directModel && (body.smart === false || body.bypassRouting === true || !!body.direct);
      let decision;
      let modelToCall;
      if (useDirect) {
        decision = { category: 'general', model: directModel, confidence: 1, complexity: 'medium', method: 'direct', bypassed: true };
        modelToCall = directModel;
      } else {
        const { route } = require('./router');
        decision = route(text, store, { cache, models: config.modelsByCategory });
        if (decision.cached && decision.value) {
          const _cidCached = body.conversation_id ?? body.conversationId;
          if (_cidCached) {
            try {
              const convService = require('./phase2/services/conversationService');
              const conv = await convService.getConversation(config, _cidCached);
              if (conv) await convService.addMessage(config, _cidCached, { role: 'assistant', content: decision.value, model: decision.model, category: decision.category, confidence: decision.confidence, latency_ms: 0 });
            } catch {}
          }
          return reply.send({ ...decision, response: decision.value, source: 'cache', latency_ms: 0 });
        }
        modelToCall = decision.model;
      }
      const result = await callModel(modelToCall, text);
      if (config.moderation.enabled) {
        const post = postCheck(result.text, config.moderation);
        if (post.action === 'block') return reply.send({ ...decision, response: '[تم حجب الرد بسبب السياسة]', blocked: true, latency_ms: result.latency_ms });
      }
      let autoError = null;
      const vibeCtxStub = body.vibe_context ?? body.vibeContext ?? null;
      if (decision.category === 'code' || decision.category === 'vibe' || /```/.test(result.text)) {
        codeErrorLearner.recordRequest(decision.category, result.model);
        const analysis = analyzeCode(result.text, { category: decision.category, vibeContext: vibeCtxStub || text });
        if (analysis.hasCode && analysis.errorScore > 0) {
          autoError = { errorScore: analysis.errorScore, errors: analysis.errors, autoQuality: qualityFromErrors(analysis.errorScore) };
          await codeErrorLearner.recordError(store, { category: decision.category, model: result.model, errorType: analysis.errors[0]?.type || 'other', severity: analysis.errors[0]?.severity || 'medium', code_snippet: analysis.errors[0]?.snippet, error_message: analysis.errors[0]?.msg, vibe_context: vibeCtxStub, auto_detected: true });
        } else if (analysis.hasCode) { codeErrorLearner.recordSuccess(store, decision.category, result.model); }
      }
      if (!useDirect && decision.complexity === 'simple') {
        const { hashKey } = require('./cache');
        cache.set(hashKey(text, decision.category, decision.model), result.text);
      }
      {
        const _cidSaveStub = body.conversation_id ?? body.conversationId;
        if (_cidSaveStub) {
        try {
          const convService = require('./phase2/services/conversationService');
          const conv = await convService.getConversation(config, _cidSaveStub);
          if (conv) await convService.addMessage(config, _cidSaveStub, { role: 'assistant', content: result.text, model: result.model, category: decision.category, confidence: decision.confidence, latency_ms: result.latency_ms });
        } catch {}
        }
      }
      if (req.user?.id) {
        try { const { incUsage } = require('./phase2/services/quotaService'); await incUsage(config, req.user.id, result.usage?.prompt_tokens || 0); } catch {}
      }
      try {
        const pool = await db.getPool(config);
        if (pool) await pool.query('INSERT INTO gateway_requests(model, prompt, response, latency_ms, status) VALUES($1,$2,$3,$4,$5)', [result.model, text.slice(0,4000), result.text.slice(0,8000), result.latency_ms, 'ok']).catch(()=>{});
      } catch {}
      if (body.stream) return reply.send({ ...decision, response: result.text, latency_ms: result.latency_ms, streamed: true, autoError });
      return reply.send({ ...decision, response: result.text, latency_ms: result.latency_ms, usage: result.usage, autoError });
    });

    stub.post('/v1/embeddings', async (req, reply) => {
      const input = String(req.body?.input ?? '').trim();
      if (!input) return reply.code(400).send({ error: 'input is required' });
      const vec = Array.from({ length: 8 }, (_, i) => Number((Math.sin(input.length + i) * 0.5).toFixed(4)));
      return reply.send({ object: 'list', data: [{ object: 'embedding', embedding: vec, index: 0 }], model: 'mock-embed' });
    });

    stub.post('/v1/feedback/code-error', async (req, reply) => {
      const b = req.body ?? {};
      const category = b.category, model = b.model, errorType = b.errorType ?? b.error_type, severity = b.severity, code_snippet = b.code_snippet ?? b.codeSnippet, error_message = b.error_message ?? b.errorMessage, vibe_context = b.vibe_context ?? b.vibeContext;
      if (!model) return reply.code(400).send({ error: 'model is required' });
      const cat = category || (vibe_context ? 'vibe' : 'code');
      const result = await codeErrorLearner.recordError(store, { category: cat, model, errorType: errorType || 'other', severity: severity || 'medium', code_snippet, error_message, vibe_context, auto_detected: false });
      return reply.send({ ok: true, ...result, score: store.get(cat, model), errorRate: codeErrorLearner.getErrorRate(cat, model) });
    });
    stub.post('/v1/feedback/vibe-error', async (req, reply) => {
      const b = req.body ?? {};
      const model = b.model, errorType = b.errorType ?? b.error_type ?? 'vibe_mismatch', severity = b.severity, code_snippet = b.code_snippet ?? b.codeSnippet, error_message = b.error_message ?? b.errorMessage, vibe_context = b.vibe_context ?? b.vibeContext;
      if (!model) return reply.code(400).send({ error: 'model is required' });
      const result = await codeErrorLearner.recordError(store, { category: 'vibe', model, errorType: errorType || 'vibe_mismatch', severity: severity || 'medium', code_snippet, error_message, vibe_context, auto_detected: false });
      return reply.send({ ok: true, ...result, score: store.get('vibe', model), errorRate: codeErrorLearner.getErrorRate('vibe', model) });
    });
    stub.post('/v1/feedback/code-success', async (req, reply) => {
      const { category, model } = req.body ?? {};
      if (!model) return reply.code(400).send({ error: 'model is required' });
      const cat = category || 'code';
      codeErrorLearner.recordSuccess(store, cat, model);
      return reply.send({ ok: true, score: store.get(cat, model), errorRate: codeErrorLearner.getErrorRate(cat, model) });
    });
    stub.get('/v1/learning/code-stats', async (req, reply) => {
      const stats = codeErrorLearner.snapshot();
      const rates = {};
      for (const cat of ['code','vibe']) { rates[cat] = {}; for (const m of ['strong-code','claude','fast-cheap','accurate-math']) rates[cat][m] = codeErrorLearner.getErrorRate(cat, m); }
      return reply.send({ ...stats, rates, store: store.summaryForPostgres() });
    });
    stub.post('/v1/code/analyze', async (req, reply) => {
      const b = req.body ?? {};
      const text = b.text, category = b.category, vibe_context = b.vibe_context ?? b.vibeContext;
      if (!text) return reply.code(400).send({ error: 'text is required' });
      return reply.send(analyzeCode(text, { category, vibeContext: vibe_context }));
    });
    stub.post('/v1/feedback/auto', async (req, reply) => {
      const { category, model, latency_ms, regenerated, thumbsUp, thumbsDown, manualCorrection, codeError, vibeError, errorSeverity } = req.body ?? {};
      if (!category || !model) return reply.code(400).send({ error: 'category and model required' });
      const quality = estimateQuality({ regenerated, latency_ms, thumbsUp, thumbsDown, codeError, vibeError, errorSeverity });
      const entry = { category, model, quality_score: quality, latency_ms, regenerated, manualCorrection };
      applyFeedback(store, entry);
      if (codeError || vibeError) await codeErrorLearner.recordError(store, { category, model, errorType: vibeError ? 'vibe_mismatch' : 'other', severity: errorSeverity || 'medium', auto_detected: false });
      return reply.send({ ok: true, quality, score: store.get(category, model), errorRate: codeErrorLearner.getErrorRate(category, model) });
    });

    // إضافة inject helper لـ GET with query
    return stub;
  })();
}

if (require.main === module) {
  (async () => {
    const app = await buildApp();
    const addr = await app.listen({ host: config.host, port: config.port });
    // eslint-disable-next-line no-console
    console.log(`MSS Gateway (1+2+3+5) listening on ${config.host}:${config.port} —`, addr);
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { buildApp, createStores, config };
