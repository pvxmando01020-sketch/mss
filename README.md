# MSS — تطبيق دردشة ذكي متعدد النماذج (Multi-Model AI Chat)

بوابة API موحدة تخفي خلفها مزوّدي النماذج (OpenAI / Claude / أخرى)، مع واجهة دردشة ويب
تبث الردود حرفاً حرفاً (SSE streaming)، دعم RTL كامل، ووضع تلقائي يختار النموذج الأنسب.

> المستند الرسمي: [`docs/technical-contract.docx`](docs/technical-contract.docx) — العقد الفني الكامل (عقد الـ API، مخطط DB، الأمان، خارطة الطريق).

## المعمارية

```
[Browser] ──HTTPS──▶ [Next.js UI] ──SSE──▶ [Fastify API Gateway]
                                              │  validation (Zod) · sanitization
                                              │  rate limit · injection check
                                              │  routing · retry · fallback
                      ┌──────────────────────┼──────────────────────┐
                      ▼                      ▼                      ▼
               [OpenAI Adapter]      [Claude Adapter]      [Mock / future adapters]
                                              │
                 ┌────────────┬──────────────┴──────┬────────────┐
                 ▼            ▼                     ▼            ▼
          [PostgreSQL*]   [Redis*]             [S3*]       [in-memory store]
                 * المرحلة 2 — MVP يستخدم مخزن ذاكرة مؤقتة بنفس الواجهة
```

## التشغيل السريع

```bash
npm install
npm run dev          # يعمل الـ API على 4000 والويب على 3000
```

- الواجهة: http://localhost:3000 (الويب يعبر للـ API عبر rewrite داخلي `/api/*` → `/v1/*`)
- فحص الصحة: http://localhost:4000/v1/health

بدون مفاتيح API تعمل **نماذج العرض (Mock)** لتجربة كامل السلسلة: التحقق، التوجيه، البث، الإيقاف.
لتفعيل النماذج الحقيقية أنشئ `.env` من `.env.example`:

| المتغير | الوظيفة |
|---|---|
| `OPENAI_API_KEY` | تفعيل `openai:gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | تفعيل `anthropic:claude-3-5-haiku` |
| `PORT` | منفذ الـ API (4000) |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` | حدود الاستخدام (60 / 2000) |
| `MODERATION_STRICT` | `true` = حظر أنماط الحقن بدلاً من تحذير |

### Docker

```bash
docker compose up --build
```

## عقد الـ API (MVP)

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/v1/health` | فحص الصحة |
| GET | `/v1/models` | النماذج المتاحة وقدراتها |
| POST | `/v1/chat` | محادثة ببث SSE — أحداث: `start`, `delta`, `usage`, `done`, `fallback`, `error` |
| POST | `/v1/conversations` | إنشاء محادثة |
| GET | `/v1/conversations` | قائمة المحادثات |
| GET | `/v1/conversations/{id}` | محادثة + رسائلها |
| DELETE | `/v1/conversations/{id}` | حذف |

رموز الأخطاء الموحدة: `INVALID_INPUT` · `MODERATION_FLAGGED` · `RATE_LIMITED` · `CONTEXT_TOO_LONG` · `MODEL_UNAVAILABLE` · `UPSTREAM_ERROR` · `NOT_FOUND` · `INTERNAL`

### مثال

```bash
curl -N -X POST http://localhost:4000/v1/chat \
  -H 'content-type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"اكتب دالة debounce في TypeScript"}]}'
```

## إضافة نموذج جديد

سطر واحد في سجلّ النماذج — `apps/api/src/config.ts` (MODEL_REGISTRY):

```ts
{
  id: 'provider:model-id',
  provider: 'openai',        // أو anthropic / mock / مزوّد جديد
  upstreamId: '...',
  name: 'الاسم الظاهر',
  contextWindow: 128000,
  capabilities: ['text', 'code', 'vision'],
  tier: 'cheap',             // cheap | standard | premium
  fallback: 'provider:other-model',
}
```

مزوّد جديد كلياً = كود محوّل (Adapter) إضافي بنفس الواجهة في `apps/api/src/adapters/`.

## حالة المراحل

- [x] **المرحلة 1 — MVP**: Gateway موحد، محوّلات OpenAI + Claude + Mock، بث SSE، اختيار يدوي/تلقائي،
      سجل محادثات، RTL + Dark/Light، إيقاف التوليد، إعادة توليد، إرفاق صور (رؤية)، تحقق Zod،
      تنظيف مدخلات، كشف حقن، حدود استخدام، إدارة سياق، إعادة محاولة + Fallback، رموز أخطاء موحدة.
- [ ] **المرحلة 2 — توسعة**: نماذج إضافية، PostgreSQL + Redis فعليين (الواجهات جاهزة)، S3 للمرفقات، اعتدال متقدم، تعديل رسائل.
- [ ] **المرحلة 3 — نضج**: اختيار ذكي (Classifier)، RAG عبر pgvector، وكلاء متعدّدو الأدوار، لوحة تحليلات.

## الهيكل

```
apps/api     — Fastify + TypeScript: البوابة الموحدة (adapters, router, safety, store, SSE)
apps/web     — Next.js + Tailwind: واجهة الدردشة (RTL, streaming, dark/light)
docs/        — العقد الفني (Word) + سكربت توليده
tools/       — generate_contract.py (يعيد توليد المستند)
```
