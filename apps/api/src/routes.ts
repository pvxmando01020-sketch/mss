import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Env } from './config';
import { MODEL_REGISTRY, availableModels } from './config';
import type { AdapterMessage, ErrorCode, ModelAdapter, ModelDef, ResolvedAttachment, SseEvent } from './types';
import { toAppError } from './errors';
import type { RateLimiter } from './limiters/types';
import { detectInjection } from './safety/moderation';
import { sanitizeMessages, sanitizeSystemPrompt } from './safety/sanitize';
import { buildContext } from './context';
import { routeModel } from './router';
import type { MessageStatus, Store } from './store/types';
import type { S3Storage } from './storage/s3';
import type { Redis } from 'ioredis';
import { sseHeaders, writeSse } from './sse';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string };
  }
}

const attachmentSchema = z
  .object({
    type: z.literal('image'),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    dataUrl: z.string().min(1).max(14_000_000).optional(),
    fileKey: z.string().max(512).optional(),
  })
  .refine((a) => Boolean(a.dataUrl) || Boolean(a.fileKey), {
    message: 'attachment requires dataUrl or fileKey',
  });

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(32_000),
  attachments: z.array(attachmentSchema).max(4).optional(),
});

const chatSchema = z.object({
  conversationId: z.string().uuid().nullish(),
  model: z.string().min(1).default('auto'),
  systemPrompt: z.string().max(4_000).nullish(),
  /**
   * false on regenerate: the payload re-sends an already-persisted history,
   * so the last user message must NOT be stored again.
   */
  persist: z.boolean().default(true),
  messages: z.array(messageSchema).min(1).max(60),
});

const conversationCreateSchema = z.object({
  title: z.string().max(120).optional(),
  model: z.string().max(60).default('auto'),
  systemPrompt: z.string().max(4_000).optional(),
});

export interface RouteDeps {
  env: Env;
  store: Store;
  limiter: RateLimiter;
  adapters: Map<string, ModelAdapter>;
  storage: S3Storage | null;
  redis: Redis | null;
}

function sendJsonError(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.code(status).send({ error: { code, message } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const MODELS_CACHE_KEY = 'mss:models';
const MODELS_CACHE_TTL = 60;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Resolve the anonymous session (x-session-id header) into a user row.
  // Every store call below is scoped by req.user.id.
  app.addHook('onRequest', async (req) => {
    if (req.url === '/v1/health') return;
    const token = (req.headers['x-session-id'] as string | undefined) || `anon-${randomUUID()}`;
    req.user = { id: await deps.store.ensureSession(token) };
  });

  app.get('/v1/health', async () => ({ status: 'ok', ts: Date.now() }));

  app.get('/v1/models', async (_req, reply) => {
    const payload = {
      default: 'auto',
      models: MODEL_REGISTRY.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        contextWindow: m.contextWindow,
        capabilities: m.capabilities,
        available:
          m.provider === 'mock' ||
          (m.provider === 'openai' ? Boolean(deps.env.openaiKey) : Boolean(deps.env.anthropicKey)),
      })),
    };
    if (deps.redis) {
      const cached = await deps.redis.get(MODELS_CACHE_KEY).catch(() => null);
      if (cached) {
        reply.header('x-models-cache', 'hit');
        return JSON.parse(cached) as typeof payload;
      }
      await deps.redis
        .set(MODELS_CACHE_KEY, JSON.stringify(payload), 'EX', MODELS_CACHE_TTL)
        .catch(() => undefined);
      reply.header('x-models-cache', 'miss');
    }
    return payload;
  });

  app.post('/v1/conversations', async (req, reply) => {
    const parsed = conversationCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendJsonError(reply, 400, 'INVALID_INPUT', 'validation failed');
      return;
    }
    const c = await deps.store.create(req.user.id, parsed.data);
    reply.code(201).send({ id: c.id, title: c.title, model: c.model, createdAt: c.createdAt });
  });

  app.get('/v1/conversations', async (req) => deps.store.list(req.user.id));

  app.get('/v1/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await deps.store.get(req.user.id, id);
    if (!c) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'conversation not found');
      return;
    }
    return c;
  });

  app.delete('/v1/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.store.delete(req.user.id, id))) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'conversation not found');
      return;
    }
    return { deleted: true };
  });

  // --- Phase 2: attachment uploads to S3 ---
  app.post('/v1/uploads', async (req, reply) => {
    if (!deps.storage) {
      sendJsonError(reply, 503, 'UPSTREAM_ERROR', 'object storage is not configured');
      return;
    }
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) {
      sendJsonError(reply, 400, 'INVALID_INPUT', 'no file uploaded');
      return;
    }
    const ext =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      sendJsonError(reply, 400, 'INVALID_INPUT', 'only png/jpeg/webp images are allowed');
      return;
    }
    const key = `attachments/${req.user.id}/${randomUUID()}.${ext}`;
    const buf = await streamToBuffer(file.file); // ≤ 10MB, enforced by multipart limits
    await deps.storage.put(key, buf, file.mimetype);
    reply.code(201).send({ key, url: `/files/${key}`, mediaType: file.mimetype });
  });

  // File proxy so the UI can render stored attachments over the same origin
  // (scoped to the requesting session; presigned URLs are an alternative for
  // production deployments where the S3 endpoint is publicly reachable).
  app.get('/v1/files/*', async (req, reply) => {
    // find-my-way exposes the '*' wildcard under params['*'] (fastify >= 5.5)
    const key = (req.params as Record<string, string>)['*'] ?? '';
    if (!key.startsWith(`attachments/${req.user.id}/`) || key.includes('..')) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'file not found');
      return;
    }
    if (!deps.storage) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'file not found');
      return;
    }
    const obj = await deps.storage.get(key);
    if (!obj) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'file not found');
      return;
    }
    // Buffer the object (≤ 10MB by upload limits) for a reliable response body.
    const buf = await streamToBuffer(obj.body);
    reply
      .header('content-type', obj.contentType)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(buf);
  });

  app.post('/v1/chat', async (req, reply) => {
    // 1) Strict schema validation.
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      sendJsonError(reply, 400, 'INVALID_INPUT', 'validation failed');
      return;
    }
    const body = parsed.data;
    const userId = req.user.id;

    // 2) Rate limiting — per session (not per IP).
    const rl = await deps.limiter.check(userId);
    if (!rl.ok) {
      reply.header('retry-after', String(rl.retryAfterSec));
      sendJsonError(reply, 429, 'RATE_LIMITED', 'rate limit exceeded');
      return;
    }

    // 3) Input sanitization + injection patterns.
    let messages;
    let systemPrompt;
    try {
      messages = sanitizeMessages(body.messages);
      systemPrompt = sanitizeSystemPrompt(body.systemPrompt);
    } catch (err) {
      const e = toAppError(err);
      sendJsonError(reply, e.httpStatus, e.code, e.message);
      return;
    }
    const warnings: string[] = [];
    for (const m of messages) {
      if (m.role !== 'user') continue;
      for (const hit of detectInjection(m.content)) warnings.push(hit);
    }
    if (warnings.length > 0 && deps.env.moderationStrict) {
      sendJsonError(reply, 451, 'MODERATION_FLAGGED', `blocked: ${[...new Set(warnings)].join(', ')}`);
      return;
    }

    // 4) Conversation resolution (scoped to the session).
    let conversation = body.conversationId
      ? await deps.store.get(userId, body.conversationId)
      : undefined;
    if (body.conversationId && !conversation) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'conversation not found');
      return;
    }
    if (!conversation) {
      conversation = await deps.store.create(userId, {
        model: body.model,
        systemPrompt: systemPrompt,
      });
    }

    // 5) Resolve attachments on every user message:
    //    - fileKey  → verify ownership, fetch object, build dataUrl for adapters
    //    - dataUrl  → persist to S3 (so it survives reloads), keep dataUrl
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user') ?? messages[messages.length - 1];
    const isNewConversation = body.conversationId === undefined || body.conversationId === null;
    const adapterMessages: AdapterMessage[] = [];
    const recordsByIndex = new Map<number, Array<{ fileKey: string; mediaType: string }>>();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
        const resolved: ResolvedAttachment[] = [];
        for (const a of m.attachments) {
          if (a.fileKey) {
            if (!a.fileKey.startsWith(`attachments/${userId}/`)) {
              sendJsonError(reply, 400, 'INVALID_INPUT', 'attachment key not owned by this session');
              return;
            }
            if (!deps.storage) {
              sendJsonError(reply, 503, 'UPSTREAM_ERROR', 'object storage is not configured');
              return;
            }
            const obj = await deps.storage.get(a.fileKey);
            if (!obj) {
              sendJsonError(reply, 404, 'NOT_FOUND', 'attachment object not found');
              return;
            }
            const b64 = (await streamToBuffer(obj.body)).toString('base64');
            resolved.push({
              type: 'image',
              mediaType: a.mediaType,
              dataUrl: `data:${a.mediaType};base64,${b64}`,
              fileKey: a.fileKey,
            });
          } else if (a.dataUrl) {
            let fileKey: string | undefined;
            if (deps.storage) {
              const ext =
                a.mediaType === 'image/png' ? 'png' : a.mediaType === 'image/webp' ? 'webp' : 'jpg';
              fileKey = `attachments/${userId}/${randomUUID()}.${ext}`;
              await deps.storage.put(
                fileKey,
                Buffer.from(a.dataUrl.split(',')[1] ?? '', 'base64'),
                a.mediaType,
              );
            }
            resolved.push({
              type: 'image',
              mediaType: a.mediaType,
              dataUrl: a.dataUrl,
              fileKey,
            });
          }
        }
        adapterMessages.push({ role: m.role, content: m.content, attachments: resolved });
        const recs = resolved
          .filter((r) => r.fileKey)
          .map((r) => ({ fileKey: r.fileKey as string, mediaType: r.mediaType }));
        if (recs.length > 0) recordsByIndex.set(i, recs);
      } else {
        adapterMessages.push({ role: m.role, content: m.content });
      }
    }

    // 6) Persist the turn(s).
    //    - NEW conversation: the payload IS the history → persist it as given.
    //    - EXISTING conversation: the payload re-sends history for context;
    //      persist ONLY the last user message (avoids duplicate rows).
    if (isNewConversation) {
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'system') continue;
        await deps.store.addMessage(userId, conversation.id, {
          role: m.role,
          content: m.content,
          status: 'complete',
          attachments: m.role === 'user' ? recordsByIndex.get(i) : undefined,
        });
      }
    } else if (body.persist) {
      const last = adapterMessages[adapterMessages.length - 1];
      const lastWire = messages[messages.length - 1];
      if (last && last.role === 'user' && lastWire.role === 'user') {
        await deps.store.addMessage(userId, conversation.id, {
          role: 'user',
          content: last.content,
          status: 'complete',
          attachments: recordsByIndex.get(messages.length - 1),
        });
      }
    }

    // 7) Routing + context budget.
    let model: ModelDef;
    try {
      model = routeModel(body.model, lastUser, availableModels(deps.env));
    } catch (err) {
      const e = toAppError(err);
      sendJsonError(reply, e.httpStatus, e.code, e.message);
      return;
    }
    let ctx: ReturnType<typeof buildContext>;
    try {
      ctx = buildContext(model, systemPrompt ?? conversation.systemPrompt, adapterMessages);
    } catch (err) {
      const e = toAppError(err);
      sendJsonError(reply, e.httpStatus, e.code, e.message);
      return;
    }

    // 8) Stream over SSE with retry (exponential backoff) + fallback model.
    reply.hijack();
    const raw = reply.raw;
    sseHeaders(raw);
    writeSse(raw, {
      event: 'start',
      data: {
        conversationId: conversation.id,
        model: model.id,
        warnings: [...new Set(warnings)],
      },
    });

    const controller = new AbortController();
    const onClose = (): void => controller.abort();
    // 'close' on the RESPONSE fires when the client disconnects.
    // ('close' on the request fires as soon as the POST body is consumed.)
    raw.on('close', onClose);

    const MAX_RETRIES = 2;
    const visited = new Set<string>();
    let current: ModelDef = model;
    let full = '';
    let finished = false;
    let aborted = false;
    let stopReason = 'end_turn';
    let usage = { inputTokens: ctx.estimatedTokens, outputTokens: 0 };
    let failure: { code: ErrorCode; message: string } | undefined;

    while (true) {
      if (visited.has(current.id)) {
        failure = failure ?? { code: 'UPSTREAM_ERROR', message: 'all fallbacks exhausted' };
        break;
      }
      visited.add(current.id);
      const adapter = deps.adapters.get(current.id);

      if (!adapter) {
        const next = current.fallback
          ? availableModels(deps.env).find((m) => m.id === current.fallback)
          : undefined;
        if (next && !visited.has(next.id)) {
          writeSse(raw, { event: 'fallback', data: { from: current.id, to: next.id, reason: 'unavailable' } });
          current = next;
          continue;
        }
        failure = { code: 'MODEL_UNAVAILABLE', message: `model ${current.id} is unavailable` };
        break;
      }

      let attempts = 0;
      let sentDelta = false;
      let streamFatal: { code: ErrorCode; message: string } | undefined;

      while (attempts <= MAX_RETRIES && !finished && !aborted) {
        if (attempts > 0) await sleep(300 * Math.pow(4, attempts - 1)); // 0.3s → 1.2s
        attempts += 1;
        let retryable: { code: ErrorCode; message: string } | undefined;

        for await (const ev of adapter.stream(ctx, controller.signal)) {
          if (ev.kind === 'delta') {
            full += ev.text;
            sentDelta = true;
            writeSse(raw, { event: 'delta', data: { text: ev.text } });
          } else if (ev.kind === 'done') {
            finished = true;
            stopReason = ev.stopReason;
            usage = ev.usage;
            break;
          } else if (ev.kind === 'error') {
            if (controller.signal.aborted) {
              aborted = true;
              break;
            }
            if (sentDelta || !ev.retryable) {
              streamFatal = { code: ev.code, message: ev.message };
            } else {
              retryable = { code: ev.code, message: ev.message };
            }
            break;
          }
        }

        if (finished || aborted) break;
        if (streamFatal || !retryable) {
          failure = streamFatal ?? retryable;
          break;
        }
        // retryable and nothing streamed yet → next attempt with backoff
      }

      if (finished || aborted) break;

      // Nothing was sent to the client → transparent fallback to another model.
      if (!sentDelta && current.fallback) {
        const next = availableModels(deps.env).find((m) => m.id === current.fallback);
        if (next && !visited.has(next.id)) {
          writeSse(raw, {
            event: 'fallback',
            data: { from: current.id, to: next.id, reason: failure?.code ?? 'UPSTREAM_ERROR' },
          });
          current = next;
          continue;
        }
      }
      break;
    }

    raw.off('close', onClose);

    const safeWrite = (e: SseEvent): void => {
      try {
        writeSse(raw, e);
      } catch {
        /* client already gone */
      }
    };

    const clientGone = controller.signal.aborted || aborted;

    // 9) Persist the assistant turn with an explicit status:
    //    complete (normal end) / aborted (client stop) / partial (stream failure).
    if (full.length > 0) {
      const status: MessageStatus = finished ? 'complete' : clientGone ? 'aborted' : 'partial';
      await deps.store
        .addMessage(userId, conversation.id, {
          role: 'assistant',
          content: full,
          model: current.id,
          tokens: usage.outputTokens,
          status,
        })
        .catch((err) => {
          app.log.error(`failed to persist assistant message: ${(err as Error).message}`);
        });
    }

    if (clientGone && !finished) {
      safeWrite({ event: 'done', data: { stopReason: 'aborted', conversationId: conversation.id } });
      raw.end();
      return;
    }
    if (finished) {
      safeWrite({
        event: 'usage',
        data: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, model: current.id },
      });
      safeWrite({ event: 'done', data: { stopReason, conversationId: conversation.id } });
      raw.end();
      return;
    }

    safeWrite({
      event: 'error',
      data: { code: failure?.code ?? 'UPSTREAM_ERROR', message: failure?.message ?? 'upstream failure' },
    });
    raw.end();
  });
}

