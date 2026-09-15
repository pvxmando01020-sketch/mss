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

## عقد الـ API

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/v1/health` | فحص الصحة |
| GET | `/v1/models` | النماذج المتاحة وقدراتها (كاش Redis — TTL 60ث) |
| POST | `/v1/chat` | محادثة ببث SSE — أحداث: `start`, `delta`, `usage`, `done`, `fallback`, `error`. الحقل `persist:false` لإعادة التوليد (لا يحفظ التاريخ المُعاد) |
| POST | `/v1/uploads` | رفع صورة إلى S3 (multipart) → `{key, url, mediaType}` |
| GET | `/v1/files/*` | عرض ملف مخزّن — مقيد بجلسة المصدّر |
| POST | `/v1/conversations` | إنشاء محادثة |
| GET | `/v1/conversations` | محادثات الجلسة (عزل كامل بين الجلسات) |
| GET | `/v1/conversations/{id}` | محادثة + رسائلها + مرفقاتها |
| DELETE | `/v1/conversations/{id}` | حذف |

### الجلسات والمستخدمون
الواجهة تولّد معرّف جلسة (`x-session-id`) من `localStorage`. البوابة تعززه إلى صف
`users.session_token` (مجهول — بدون مصادقة كاملة في هذه المرحلة)، وتُعزَل المحادثات
والمرفقات وحدود الاستخدام **per-session** (عدّادات Redis بمفتاح معرّف الجلسة، لا IP).

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
- [x] **المرحلة 2 — توسعة (التخزين الحقيقي)**:
      - **PostgreSQL** خلف نفس `Store` interface (المخزن في الذاكرة يبقى fallback بدون `DATABASE_URL`):
        `users` (جلسات مجهولة) · `conversations` · `messages` (مع `status`: complete/partial/aborted) · `attachments`.
        Migrations مرقّمة تُطبَّق عند الإقلاع + `npm run migrate -w @mss/api`.
      - **Redis**: عدّادات rate limiting per-session (INCR+EXPIRE) + كاش `/v1/models`.
      - **S3-compatible** (MinIO محلياً، أي مزوّد S3 للإنتاج): رفع المرفقات قبل النموذج،
        مفاتيح مقيدة بالجلسة `attachments/{userId}/…`، proxy `/v1/files/*` للعرض،
        `presignGet` جاهز لنهايات S3 العامة.
      - انقطاع البث يحفظ الرسالة بحالتها الفعلية (`aborted` عند إيقاف المستخدم / `partial` عند فشل التوليد) — لا فقدان صامت.
      - إصلاح: إعادة التوليد لا تُعيد حفظ رسائل التاريخ (حقل `persist`).
      - معايير القبول مُختبَرة: استرجاع كامل بعد إعادة التشغيل، per-session 429، مرفق يظهر بعد إعادة التحميل.
      - يبقى من خطة المرحلة 2: نماذج إضافية، اعتدال محتوى متقدم (نقطة خارجية)، تعديل رسائل.
- [ ] **المرحلة 3 — نضج**: اختيار ذكي (Classifier)، RAG عبر pgvector، وكلاء متعدّدو الأدوار، لوحة تحليلات.

## الهيكل

```
apps/api
  src/adapters    — openai.ts, anthropic.ts, mock.ts (Adapter Pattern)
  src/db          — pool + migrations (001_init)
  src/limiters    — memory.ts, redis.ts (per-session)
  src/router      — القواعد (رؤية/كود/اقتصادي)
  src/safety      — sanitize, moderation
  src/storage     — s3.ts (put/get/presign)
  src/store       — types.ts (العقد) + memory.ts + postgres.ts
  src/routes.ts   — العقد الكامل + uploads/files
apps/web     — Next.js + Tailwind: واجهة الدردشة (RTL, streaming, dark/light, S3 uploads)
docs/        — العقد الفني (Word) + سكربت توليده
tools/       — generate_contract.py (يعيد توليد المستند)
```
