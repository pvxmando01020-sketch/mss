# MSS — AI Chat Gateway — الرحلة الكاملة 1 → 4

> **الرحلة الأولى (مرحلة 1):** تأسيس البوابة — Fastify + Postgres/Redis/S3 + محول موحد للنماذج  
> **الرحلة الثانية (مرحلة 2):** التطبيق — Auth + Conversations + Uploads + Quota  
> **الرحلة الثالثة (مرحلة 3):** التوجيه الذكي — تصنيف محلي + bandit + كاش + OfflineQueue  
> **الرحلة الرابعة (مرحلة 4):** القياس والإشراف — Benchmark + طبقة إشراف موازية

هذا المستودع يطبّق **الخطة الموحدة كاملة**: من تأسيس البوابة حتى التوجيه الذكي الذي يختار النموذج الأنسب لكل سؤال تلقائيًا على الجهاز، ثم التوجيه عبر الـ Gateway الحالي.

---

## لماذا هذه المعمارية؟

- **الرحلة 1 تؤسس الأرضية** — بدونها لا يوجد Gateway ليبني عليه الذكاء.
- **الرحلة 2 تحفظ السياق** — المحادثات والهوية والملفات.
- **الرحلة 3 توفر التكلفة والكمون** — توجيه محلي أولاً بدون استدعاء مزدوج.
- **الرحلة 4 تحمي** — قياس بطارية/ذاكرة + إشراف لا يحجب التوجيه.

---

## المعمارية العامة — 4 طبقات فوق الرحلتين 1 و 2

```
[Flutter App — lib/main.dart]
  → Local Pre-Processor (extractFeatures + classify + heuristics + LocalCache)
  → قرار التوجيه (محلي أولاً، fallback لو غير متأكد)           ← مرحلة 3
  → OfflineQueue (عند فشل الشبكة)                               ← مرحلة 3
  → API Gateway (Fastify src/server.js)                          ← مرحلة 1
    ├── Auth (JWT + API Keys)                                    ← مرحلة 2
    ├── Conversations (CRUD + messages + pagination)              ← مرحلة 2
    ├── Uploads (S3/MinIO)                                       ← مرحلة 2
    ├── محول النماذج (Claude/Gemini/Kimi/OpenAI) + retry/fallback← مرحلة 1
    └── Performance Logger → ScoreStore + Postgres                ← مرحلة 3
  → Moderation (طبقة موازية منفصلة)                              ← مرحلة 4
```

لماذا Flutter؟ نفس ستاك تطبيق التحكم لبوت التداول → تقليل تعدد التقنيات.

---

## بنية المستودع

```
migrations/
  000_phase1_core.sql          # users, api_keys, gateway_models, gateway_requests, gateway_files
  001_routing.sql              # routing_summaries + routing_feedback (مرحلة 3b)
  002_phase2_conversations.sql # conversations, messages, usage_daily, sessions

src/
  phase1/                      # الرحلة الأولى — البنية التحتية
    routes/health.js           # GET /health, /ready, /v1/models
    routes/chat.js             # POST /v1/chat/completions (مباشر), POST /v1/embeddings
    middleware/errorHandler.js, requestLogger.js, rateLimit.js
    services/s3.js             # S3/MinIO مع fallback memory
  phase2/                      # الرحلة الثانية — التطبيق
    routes/auth.js             # POST /v1/auth/register, /login, GET /me, POST /api-keys
    routes/conversations.js    # CRUD conversations + /:id/chat (ذكي) + messages
    routes/uploads.js          # POST /v1/uploads
    services/authService.js    # JWT (jsonwebtoken fallback) + bcrypt fallback
    services/conversationService.js
    middleware/jwt.js          # optionalAuth + requireAuth
  features.js, classifier.js, store.js, cache.js, gateway.js, router.js  # مرحلة 3
  server.js                    # مصنع Fastify الكامل 1+2+3+4 (stub بدون fastify)
  config.js, logger.js, sync.js, moderation.js
  adapters/db.js, cacheRedis.js, modelAdapter.js

flutter/
  lib/smart_router.dart, main.dart
  lib/services/local_store.dart, gateway_client.dart
  lib/screens/chat_screen.dart, settings_screen.dart
  lib/widgets/routing_badge.dart
  test/smart_router_test.dart

tests/
  phase1.test.js  # 8 اختبارات — health, models, chat مباشر, embeddings, S3
  phase2.test.js  # 6 اختبارات — auth, conversations CRUD, uploads, conversation_id
  router.test.js, gateway.test.js, moderation.test.js, logger.test.js, cache.test.js
  # الإجمالي: 45 اختبار

scripts/benchmark.js          # مرحلة 4 — 7µs features, 14µs classify, 19µs route
examples/
  phase1-phase2.js            # عرض حي للرحلتين 1 و 2
  gateway-example.js          # عرض حي للتوجيه الذكي
docker-compose.yml, Dockerfile, .env.example
```

---

## الرحلة الأولى — البنية التحتية (مرحلة 1)

**الهدف:** Fastify Gateway موحد يخفي اختلافات المزودين ويحمي المفاتيح في backend.

| المكون | التنفيذ |
|---|---|
| Fastify | `src/server.js` + `phase1/middleware/*` (CORS للـ preview, helmet, rateLimit) |
| Postgres | `adapters/db.js` (pg مع fallback memory) + `migrations/000_phase1_core.sql` |
| Redis | `adapters/cacheRedis.js` (ioredis مع fallback Map) |
| S3 | `phase1/services/s3.js` (@aws-sdk/client-s3 مع fallback) |
| محول النماذج | `adapters/modelAdapter.js` — واجهة موحدة `callModel(model, text)` + `callTwoForComparison` + retry/fallback |

**واجهات مرحلة 1:**
```bash
GET  /health                         # فحص سريع
GET  /ready                          # postgres + redis
GET  /v1/models                      # adapters + gateway_models
POST /v1/chat/completions            # {prompt|text, model, stream?} — مباشر أو ذكي حسب وجود model
POST /v1/embeddings                  # {input} → vector (mock 8 dims)
```

```js
// مباشر (يحدد النموذج)
await fetch('/v1/chat/completions', { method:'POST', body: JSON.stringify({ prompt:'مرحبا', model:'fast-cheap', direct:true }) })
// ذكي (بدون model → يمر عبر route() في مرحلة 3)
await fetch('/v1/chat/completions', { method:'POST', body: JSON.stringify({ text:'اكتب قصة' }) })
```

---

## الرحلة الثانية — التطبيق (مرحلة 2)

**الهدف:** هوية ومحادثات قابلة للتخزين والاسترجاع.

| المكون | التنفيذ |
|---|---|
| Auth | `phase2/services/authService.js` — JWT (jsonwebtoken fallback) + bcrypt fallback + sessions |
| Conversations | `phase2/services/conversationService.js` — CRUD + pagination |
| Uploads | `phase2/routes/uploads.js` — JSON base64 أو multipart → S3 |

**واجهات مرحلة 2:**
```bash
POST /v1/auth/register  {email,password} → {user}
POST /v1/auth/login     {email,password} → {token, user}
GET  /v1/auth/me        (Bearer) → {user}
POST /v1/auth/api-keys  (Bearer) {provider,key,label}

POST /v1/conversations              {title,model} → {conversation}
GET  /v1/conversations?limit&offset
GET  /v1/conversations/:id          → {conversation, messages}
POST /v1/conversations/:id/messages {role,content,model?}
DELETE /v1/conversations/:id
POST /v1/conversations/:id/chat     {text} → توجيه ذكي + حفظ + استدعاء نموذج
POST /v1/uploads                    {filename,mime,dataBase64} أو multipart
# ربط مرحلة 2 بـ 3:
POST /v1/chat/completions           {text, conversation_id} → يحفظ الرد تلقائياً في المحادثة
```

```js
const { buildApp } = require('./src/server');
const app = await buildApp();
const { conversation: { id } } = (await app.inject({ method:'POST', url:'/v1/conversations', payload:{title:'رحلة'}})).json();
await app.inject({ method:'POST', url:`/v1/conversations/${id}/chat`, payload:{text:'اكتب نكتة'}});
```

---

## الرحلة الثالثة — التوجيه الذكي (مرحلة 3)

تفاصيل الميزات والتصنيف والـ bandit كما في الخطة الموحدة — انظر `ARCHITECTURE.md` §2-6.

```js
const { route, ScoreStore } = require('./src/router');
const store = new ScoreStore();
route('اكتب دالة فيبوناتشي', store); // → {category:'code', model:'strong-code', confidence:0.31}
```

**نقاط الاتصال:**
```bash
POST /v1/route            {text, overrideModel?} → {category, model, confidence}
POST /v1/feedback/auto    {category,model,thumbsUp?,regenerated?} → يحسب quality
GET  /v1/routing/stats
```

---

## الرحلة الرابعة — القياس والإشراف (مرحلة 4)

```bash
npm run benchmark
# extractFeatures: 7.1 µs | classify: 14.0 µs | route: 20.0 µs
# ScoreStore (2000 events): 87.5 KB | LocalCache 300: ~150 KB
# → لا حاجة لـ TFLite — <0.1% CPU لكل 1000 توجيه

const { preCheck } = require('./src/moderation');
preCheck(text, {blockThreshold:0.92}); // → {action:'allow'|'flag'|'block'}
```

طبقة الإشراف **موازية منفصلة** — لا تحجب التوجيه، تُفعّل بـ `MODERATION_ENABLED=true`.

---

## التشغيل الكامل (الرحلات 1 → 4)

```bash
cp .env.example .env
docker-compose up -d              # Postgres + Redis + MinIO
npm run migrate                   # ينشئ 000 + 001 + 002 (أو psql $DATABASE_URL -f migrations/*.sql)
npm start                         # Fastify 0.0.0.0:3000  (يعمل حتى بدون docker — fallback memory)

# اختبارات
npm test                          # 45 اختبار — phase1 + phase2 + routing + gateway + moderation + logger + cache
npm run benchmark
node examples/phase1-phase2.js    # عرض حي للرحلتين 1 و 2
node examples/gateway-example.js  # عرض حي للتوجيه الذكي

# Flutter (يستهلك الرحلتين 1 و 2 + الذكاء)
cd flutter && flutter pub get && flutter test
flutter run -d chrome  # baseUrl في gateway_client.dart → http://localhost:3000 أو https://3000-xxx.e2b.app
```

**الـ Preview (E2B):** الخادم يربط `0.0.0.0` ويسمح بـ `https://{port}-{sandbox}.e2b.app` عبر CORS — الواجهة تستخدم relative URLs أو `gateway_client.dart` baseUrl.

---

## Flutter — يستهلك الرحلتين 1 و 2 + الذكاء

```dart
final store = LocalStore(); await store.init();
// Auth (مرحلة 2)
final gw = GatewayClient(baseUrl: 'http://localhost:3000');
await http.post(Uri.parse('$baseUrl/v1/auth/register'), body: jsonEncode({...}));
// Conversations
final conv = await gw.createConversation('رحلة');
// Chat ذكي مع حفظ تلقائي
final r = await gw.chat('اكتب قصة', conversationId: conv.id);
// Badge
RoutingBadge(category: r['category'], model: r['model'], confidence: r['confidence'])
```

---

## خارطة الطريق — مكتملة

| الرحلة | المرحلة | المحتوى | الحالة |
|---|---|---|---|
| الأولى | 1 | Fastify + Postgres/Redis/S3 + محول موحد + health/models/embeddings | ✅ |
| الثانية | 2 | Auth (JWT) + Conversations CRUD + Uploads + Quota | ✅ |
| الثالثة | 3a | استخراج ميزات + مصنف rule-based | ✅ |
| الثالثة | 3b | سجل أداء + bandit + ملخص Postgres + logger proxies | ✅ |
| الثالثة | 3c | Flutter كامل + طابور offline | ✅ |
| الثالثة | 3d | شجرة قرار مدرّبة + تعلم تدريجي | ✅ |
| الرابعة | 4 | Benchmark بطارية/ذاكرة + إشراف موازٍ | ✅ |

---

## الخصوصية

- **يبقى على الجهاز:** التصنيف/heuristics/سجل الأداء/الكاش/طابور offline (مرحلة 3).
- **يبقى في backend:** مفاتيح النماذج (مرحلة 1)، JWT secret، ملفات S3.
- **يُرسل:** `text` فقط عبر Gateway.

---

## الترخيص

MIT
