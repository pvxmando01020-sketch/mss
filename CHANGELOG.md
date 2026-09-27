# CHANGELOG — MSS AI Gateway

## 1.0.0 — 2026-09-27 — الرحلة 1→4 مكتملة

### الرحلة الأولى — البنية التحتية (مرحلة 1)
- Fastify Gateway موحد — `src/server.js` (stub للاختبارات بدون تثبيت `fastify`)
- Postgres/Redis/S3 مع fallback memory — `adapters/db.js`, `cacheRedis.js`, `phase1/services/s3.js`
- محول نماذج موحد `callModel` — Claude/Gemini/Kimi/OpenAI + retry/fallback
- `migrations/000_phase1_core.sql` — `users`, `api_keys`, `gateway_models`, `gateway_requests`, `gateway_files`
- Middleware: `requestLogger`, `rateLimit` (120/دقيقة), `errorHandler`, `helmet`/`cors`/`compress`
- Routes: `GET /health`, `/ready`, `/metrics`, `/v1/models`, `POST /v1/chat/completions` (مباشر+stream), `POST /v1/embeddings`

### الرحلة الثانية — التطبيق (مرحلة 2)
- Auth JWT — `phase2/services/authService.js` (jsonwebtoken/bcrypt fallback) — `POST /v1/auth/*`, `GET /v1/auth/me`
- Conversations — `phase2/services/conversationService.js` — CRUD + `POST /:id/chat` + `conversation_id` في `chat/completions`
- Uploads — `POST /v1/uploads` (base64/multipart) → S3
- Quota — `phase2/services/quotaService.js` — `usage_daily` + `429 quota_exceeded`
- `migrations/002_phase2_conversations.sql` — `conversations`, `messages`, `usage_daily`, `sessions`
- `GET /v1/admin/stats`, `/v1/admin/routing` (حماية admin)

### الرحلة الثالثة — التوجيه الذكي (مرحلة 3)
- `features.js` — طول/لغة/كود/كثافة تقنية/نية (unicode-aware)
- `classifier.js` — شجرة قرار 9 أبعاد + `TREE_WEIGHTS` + fallback `bestProb<0.38`
- `store.js` — bandit epsilon-greedy `α=0.2` + `confidence = score*(1-novelty)`
- `cache.js` — `LocalCache` LRU/TTL + `OfflineQueue` + `shouldBypassModel`
- `gateway.js` + `server.js` — `POST /v1/route`, `/v1/feedback/auto`, `GET /v1/routing/stats`
- Flutter — `smart_router.dart` + `local_store.dart` (SharedPrefs) + `gateway_client.dart` + `offline_sync.dart` + `chat/settings/auth` + `routing_badge`

### الرحلة الرابعة — القياس والحماية (مرحلة 4)
- `scripts/benchmark.js` — `7µs/14µs/19µs`, `87KB/2000 events`
- `moderation.js` — `preCheck/postCheck` طبقة موازية `MODERATION_ENABLED`

### الإنتاج
- `docker-compose.yml` (Postgres 16 + Redis 7 + MinIO) + `Dockerfile` + `.env.example` (مع `JWT_SECRET`)
- `docs/API.md`, `docs/DEPLOYMENT.md`
- `scripts/seed.js`, `examples/full-journey.js`, `scripts/load-test.js`
- `45/45` اختبار — `npm test` يعمل بدون DB
