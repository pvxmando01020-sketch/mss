import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Env } from './config';
import { MODEL_REGISTRY, availableModels } from './config';
import type { ErrorCode, ModelAdapter, ModelDef, SseEvent } from './types';
import { toAppError } from './errors';
import { RateLimiter } from './safety/rateLimit';
import { detectInjection } from './safety/moderation';
import { sanitizeMessages, sanitizeSystemPrompt } from './safety/sanitize';
import { buildContext } from './context';
import { routeModel } from './router';
import type { Store } from './store';
import { sseHeaders, writeSse } from './sse';

const attachmentSchema = z.object({
  type: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  dataUrl: z.string().min(1).max(14_000_000),
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
}

function sendJsonError(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.code(status).send({ error: { code, message } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/v1/health', async () => ({ status: 'ok', ts: Date.now() }));

  app.get('/v1/models', async () => ({
    default: 'auto',
    models: MODEL_REGISTRY.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow,
      capabilities: m.capabilities,
      available: m.provider === 'mock' || (m.provider === 'openai' ? Boolean(deps.env.openaiKey) : Boolean(deps.env.anthropicKey)),
    })),
  }));

  app.post('/v1/conversations', async (req, reply) => {
    const parsed = conversationCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendJsonError(reply, 400, 'INVALID_INPUT', 'validation failed');
      return;
    }
    const c = deps.store.create(parsed.data);
    reply.code(201).send({ id: c.id, title: c.title, model: c.model, createdAt: c.createdAt });
  });

  app.get('/v1/conversations', async () => deps.store.list());

  app.get('/v1/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = deps.store.get(id);
    if (!c) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'conversation not found');
      return;
    }
    return c;
  });

  app.delete('/v1/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.store.delete(id)) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'conversation not found');
      return;
    }
    return { deleted: true };
  });

  app.post('/v1/chat', async (req, reply) => {
    // 1) Strict schema validation.
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      sendJsonError(reply, 400, 'INVALID_INPUT', 'validation failed');
      return;
    }
    const body = parsed.data;

    // 2) Rate limiting per user (x-user-id header, falls back to IP).
    const userId = (req.headers['x-user-id'] as string | undefined) || req.ip;
    const rl = deps.limiter.check(userId);
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

    // 4) Conversation resolution + persistence of the user turn.
    let conversation = body.conversationId ? deps.store.get(body.conversationId) : undefined;
    if (body.conversationId && !conversation) {
      sendJsonError(reply, 404, 'NOT_FOUND', 'conversation not found');
      return;
    }
    if (!conversation) {
      conversation = deps.store.create({
        model: body.model,
        systemPrompt: systemPrompt,
      });
    }
    for (const m of messages) {
      if (m.role === 'user') {
        deps.store.addMessage(conversation.id, { role: 'user', content: m.content });
      }
    }

    // 5) Routing + context budget.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user') ?? messages[messages.length - 1];
    const available = availableModels(deps.env);
    let model: ModelDef;
    try {
      model = routeModel(body.model, lastUser, available);
    } catch (err) {
      const e = toAppError(err);
      sendJsonError(reply, e.httpStatus, e.code, e.message);
      return;
    }
    let ctx: ReturnType<typeof buildContext>;
    try {
      ctx = buildContext(model, systemPrompt ?? conversation.systemPrompt, messages);
    } catch (err) {
      const e = toAppError(err);
      sendJsonError(reply, e.httpStatus, e.code, e.message);
      return;
    }

    // 6) Stream over SSE with retry (exponential backoff) + fallback model.
    reply.hijack();
    const raw = reply.raw;
    sseHeaders(raw);
    writeSse(raw, {
      event: 'start',
      data: { conversationId: conversation.id, model: model.id, warnings: [...new Set(warnings)] },
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
        const next = current.fallback ? available.find((m) => m.id === current.fallback) : undefined;
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
        const next = available.find((m) => m.id === current.fallback);
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
    if (finished || clientGone) {
      if (full.length > 0) {
        deps.store.addMessage(conversation.id, {
          role: 'assistant',
          content: full,
          model: current.id,
          tokens: usage.outputTokens,
        });
      }
      if (clientGone && !finished) {
        safeWrite({ event: 'done', data: { stopReason: 'aborted', conversationId: conversation.id } });
      } else {
        safeWrite({
          event: 'usage',
          data: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, model: current.id },
        });
        safeWrite({ event: 'done', data: { stopReason, conversationId: conversation.id } });
      }
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
