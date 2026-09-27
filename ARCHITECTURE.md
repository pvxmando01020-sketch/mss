# ARCHITECTURE — AI Chat Gateway — الرحلة 1 → 4

وثيقة معمارية تنفيذية كاملة. الرحلتان 1 و 2 هما الأساس الذي تبنى عليه الرحلتان 3 و 4.

---

## 0. نظرة عامة — الرحلات الأربع

| الرحلة | المرحلة | الهدف | المخرجات |
|---|---|---|---|
| الأولى | 1 | البنية التحتية: Fastify + Postgres/Redis/S3 + محول موحد | `migrations/000`, `phase1/*`, `adapters/*` |
| الثانية | 2 | التطبيق: Auth + Conversations + Uploads | `migrations/002`, `phase2/*` |
| الثالثة | 3 | الذكاء: توجيه محلي + bandit + كاش + OfflineQueue | `features`, `classifier`, `store`, `cache`, `gateway` |
| الرابعة | 4 | القياس والحماية: Benchmark + Moderation موازٍ | `scripts/benchmark`, `moderation` |

```
[Flutter App — Local Pre-Processor]                     ← مرحلة 3
  │  extractFeatures + classify + complexity + cache
  │  ScoreStore (SQLite/SharedPrefs) + OfflineQueue
  ▼
[قرار التوجيه — محلي أولاً]                              ← مرحلة 3
  │  route(text) → {category, model, confidence}
  ▼
[API Gateway — Fastify src/server.js]                   ← مرحلة 1 + 2
  │  Auth (JWT) + Conversations + Uploads
  │  POST /v1/route, /v1/chat/completions (+ conversation_id)
  │  محول النماذج → Claude/Gemini/Kimi + retry/fallback
  │  S3 للملفات، Redis للكاش الساخن، Postgres للملخصات
  ▼
[Performance Logger]                                    ← مرحلة 3b
  │  POST /v1/feedback/auto → estimateQuality → ScoreStore.update
  ▼
[Moderation — طبقة موازية]                               ← مرحلة 4
   │  preCheck/postCheck — لا تحجب التوجيه
```

---

## 1. الرحلة الأولى — البنية التحتية (مرحلة 1)

**المشكلة:** تعدد مزودين (Anthropic, Google, Moonshot) باختلافات API ومفاتيح حساسة.

**الحل:** `src/server.js` مصنع Fastify موحد + `src/adapters/modelAdapter.js` بواجهة واحدة `callModel(model, text)`.

### المكونات

| المكون | الملف | Fallback بدون تثبيت |
|---|---|---|
| Fastify | `server.js` | stub `inject()` للاختبارات |
| Postgres | `adapters/db.js` (`pg`) | `Map` memory + `memorySummaries` |
| Redis | `adapters/cacheRedis.js` (`ioredis`) | `Map` memory |
| S3 | `phase1/services/s3.js` (`@aws-sdk/client-s3`) | `Map` memory |

### الجداول — `migrations/000_phase1_core.sql`

- `users` (id, email, password_hash, role)
- `api_keys` (user_id, provider, key_hash) — لا يُخزن المفتاح الخام
- `gateway_models` (id, provider, label, cost, max_tokens) — مهيأة بـ 6 نماذج
- `gateway_requests` (model, prompt, response, latency, status, tokens)
- `gateway_files` (s3_key, bucket, filename, mime, size)
- `gateway_settings` (key, value)

### Middleware — `phase1/middleware/*`

- `requestLogger` — onRequest/onResponse + latency
- `rateLimit` — window 60s / 60 طلب (Map fallback)
- `errorHandler` — استجابة موحدة `{error, status, stack?}`

### Routes — `phase1/routes/*`

- `health.js`: `GET /health` (ok, version, phase), `GET /ready` (postgres/redis checks), `GET /v1/models`
- `chat.js`: `POST /v1/chat/completions` (مباشر + streaming SSE), `POST /v1/embeddings` (mock 8 dims)

في `server.js` تم توحيد `POST /v1/chat/completions` ليعمل كـ **مباشر** إذا أرسل `model` + `direct:true`، وإلا **ذكي** عبر `route()`.

---

## 2. الرحلة الثانية — التطبيق (مرحلة 2)

**المشكلة:** بدون هوية ومحادثات، لا سياق ولا حصص ولا ملفات.

**الحل:** `phase2/*` + `migrations/002_phase2_conversations.sql`.

### الجداول

- `conversations` (id, user_id, title, model, pinned_model, updated_at)
- `messages` (conversation_id, role, content, model, category, confidence, latency, regenerated)
- `usage_daily` (user_id, day, requests, tokens)
- `sessions` (user_id, token_hash, expires_at)

### Auth — `phase2/services/authService.js`

- `hashPassword` — `bcryptjs` أو fallback `sha256:`
- `signJwt/verifyJwt` — `jsonwebtoken` أو fallback HMAC-SHA256
- `createUser`, `authenticate`, `verifyToken` — تعمل مع Postgres أو `Map` memory
- JWT secret من `JWT_SECRET` env

### Conversations — `phase2/services/conversationService.js`

- `createConversation`, `listConversations`, `getConversation`, `addMessage`, `listMessages`, `deleteConversation`
- نفس واجهة Postgres/Memory — الاختبارات لا تحتاج DB

### Middleware — `phase2/middleware/jwt.js`

- `optionalAuth` — global preHandler يضيف `request.user` إن وجد `Bearer` صالح، ولا يمنع الضيف
- `requireAuth` — route preHandler يمنع 401 إن لم يوجد user

### Routes

- `auth.js`: `POST /v1/auth/register`, `POST /v1/auth/login`, `GET /v1/auth/me` (requireAuth), `POST /v1/auth/api-keys`
- `conversations.js`: CRUD + `POST /:id/chat` (ذكي داخل المحادثة) + ربط `POST /v1/chat/completions` بـ `conversation_id` للحفظ التلقائي
- `uploads.js`: `POST /v1/uploads` (JSON base64 أو multipart) → S3/Memory + `gateway_files`

---

## 3. الرحلة الثالثة — التوجيه الذكي (مرحلة 3)

### 3.1 استخراج الميزات (`features.js`)

| الميزة | التنفيذ |
|---|---|
| `charCount`/`wordCount` | `WORD_RE = /[\p{L}\p{N}_]+/gu` |
| `arabicRatio` | `ARABIC_RE = /[\u0600-\u06FF]/g` → `ar`>0.35, `mixed`>0.08 |
| `hasCode`/`codeScore` | `CODE_SIGNALS` + عد أسطر `{}();=` |
| `technicalDensity` | `TECH_DICT` (40+ مصطلح) |
| `intent` | `INTENT_PATTERNS` unicode-aware `iu` |

### 3.2 التصنيف (`classifier.js`)

- **3a rule-based:** `code` > `retrieval` (قصير) > `analysis` > `creative` > `general`
- **3d tree:** متجه 9 أبعاد + `TREE_WEIGHTS` + `softmax` → `bestProb<0.38` → fallback rules

### 3.3 التعقيد

```
complex: wc>180 || (code && (wc>80 || hasCode)) || (analysis && wc>90) || (ar>0.5 && wc>100)
medium:  wc>35 || technicalDensity>0.12 || !intent
simple:  otherwise → جرّب LocalCache أولاً
```

### 3.4 ScoreStore (`store.js`)

```js
score = (1-α)*score + α*quality  // α=0.2, manualCorrection→α×2.5
pick: 90% الأعلى, 10% استكشاف
confidence = score * (1 - 1/(1+total)) // novelty_penalty
```

- على الجهاز `SQLite/SharedPrefs` (هنا JSON memory)، على الخادم `summaryForPostgres()` → `routing_summaries`

### 3.5 Heuristics + Cache (`cache.js`)

- `shouldBypassModel` قبل الاستدعاء
- `LocalCache` LRU+TTL (6h, 300) + `hashKey=sha256(cat::model::text)`
- `OfflineQueue` max 100, حذف بعد 5 محاولات

### 3.6 Gateway (`gateway.js` + `server.js`)

- `POST /v1/route`, `POST /v1/feedback/auto`, `GET /v1/routing/stats`
- `server.js` يوحد مرحلة 1 و 3 في `POST /v1/chat/completions` (direct vs smart)

---

## 4. Flutter — يستهلك الرحلتين 1 و 2 + الذكاء

- `smart_router.dart` — offline Dart
- `main.dart` + `services/local_store.dart` (ScoreStore + pinnedModels + OfflineQueue)
- `services/gateway_client.dart` (يرسل `text` + `conversation_id` + `Authorization`)
- `screens/chat_screen.dart` + `widgets/routing_badge.dart` ("تم اختيار Claude — ...") + 👍👎
- `screens/settings_screen.dart` — تثبيت نموذج لفئة + إحصائيات Postgres

---

## 5. الرحلة الرابعة — القياس والإشراف

### Benchmark (`scripts/benchmark.js`)

- 10k تكرار: `extractFeatures 7µs | classify 14µs | route 19µs`
- `ScoreStore 2000 events: 87.5 KB`, `LocalCache 300: ~150 KB`
- **القرار:** البقاء على decision tree — TFLite غير مبرر (<0.1% CPU/1000 توجيه)

### Moderation (`moderation.js`) — طبقة موازية منفصلة

- `preCheck`/`postCheck` → `{action:'allow'|'flag'|'block', reason, score}`
- لا تُبنى كجزء من التوجيه؛ `MODERATION_ENABLED=true` تُفعّلها كـ middleware قبل/بعد
- يجنب حجب غير مبرر ويبقي التوجيه خفيفًا

---

## 6. خارطة الطريق — مكتملة

| الرحلة | المرحلة | المحتوى | الحالة |
|---|---|---|---|
| 1 | 1 | Fastify + Postgres/Redis/S3 + محول موحد + health/embeddings | ✅ |
| 2 | 2 | Auth JWT + Conversations CRUD + Uploads | ✅ |
| 3 | 3a | ميزات + rule-based | ✅ |
| 3 | 3b | bandit + Postgres summary + logger proxies | ✅ |
| 3 | 3c | Flutter + OfflineQueue | ✅ |
| 3 | 3d | شجرة قرار + online update | ✅ |
| 4 | 4 | Benchmark + Moderation موازٍ | ✅ |

---

## 7. قرارات ولماذا

| القرار | البديل | السبب |
|---|---|---|
| Fastify stub للاختبارات | تثبيت fastify إلزامي | يعمل بدون deps ثقيلة في CI |
| Memory fallback لكل من Postgres/Redis/S3 | فشل عند غياب الخدمات | تطوير واختبار بدون docker |
| JWT fallback HMAC | jsonwebtoken إلزامي | اختبارات تمر بدون تثبيت |
| direct vs smart في نفس endpoint | endpoint منفصل | أبسط للعميل + يحافظ على توافق مرحلة 1 |
| Moderation موازٍ | جزء من classifier | لا نريد حجب التوجيه — طبقة منفصلة |

---

## 8. المخاطر

| الخطر | التخفيف |
|---|---|
| تصنيف خاطئ عامي | OTA weights + fallback + تبديل يدوي |
| سجل ضعيف | novelty_penalty عالٍ → heuristics تتجاوز |
| كاش قديم | TTL 6h + LRU |
| طابور offline ممتلئ | max 100 + حذف بعد 5 |
| انحياز نموذج | epsilon 10% |

---

## 9. التشغيل

```bash
docker-compose up -d && npm run migrate  # 000 + 001 + 002
npm test          # 45 اختبار
npm run benchmark
node examples/phase1-phase2.js
node examples/gateway-example.js
```
