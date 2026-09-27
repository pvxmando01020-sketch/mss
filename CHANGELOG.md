# CHANGELOG — MSS AI Gateway

## 1.1.0 — 2026-09-27 — التعلم من أخطاء الكود والـ Vibe Code

- `src/adapters/codeAnalyzer.js` — يكشف `syntax/security/vibe_mismatch` من ``` blocks + inline code — `errorScore 0..1` + `qualityFromErrors` (0.08 حرج → 0.85 نظيف)
- `src/learning/codeErrorLearner.js` — `CodeErrorLearner` singleton (`alphaError 0.4`, `alphaVibe 0.35`) — `recordError/recordSuccess/getErrorRate/adjustConfidence` — يحفظ في `code_errors`/`code_error_stats` (Postgres) + in-memory `Map` + `recent 500`
- `migrations/003_code_errors.sql` — جداول `code_errors` + `code_error_stats` + VIEW `code_error_rates` + فهارس
- `src/store.js` — أضاف `vibe` إلى `CATEGORIES` (6 فئات) + `DEFAULT_MODELS.vibe='strong-code'` (يتعلم منفصلاً)
- `src/classifier.js` — أضاف `vibe` في `TREE_WEIGHTS` + قاعدة `vibe code` في `classifyRules`
- `src/gateway.js` — `adjustConfidence` عبر `errorRate*0.7` + تجاوز للنموذج الأقل أخطاء إذا `confidence*0.6 > adjusted`
- `src/logger.js` — `estimateQuality` يدعم `codeError/vibeError` بخرائط severity (`critical 0.02/0.05`)
- `src/config.js` — أضاف `vibe:['strong-code','claude']` في `modelsByCategory`
- `src/server.js` — `POST /v1/chat/completions` + `POST /v1/conversations/:id/chat` يكتشفان الكود تلقائياً ويحدّثان الـ learner قبل الرد (`autoError` في الرد) — نقاط جديدة: `POST /v1/feedback/code-error`, `/vibe-error`, `/code-success`, `GET /v1/learning/code-stats`, `POST /v1/code/analyze`
- `flutter` — `gateway_client.dart` (`reportCodeError/reportVibeError/analyzeCode`) + `chat_screen.dart` زر 🐛 + dialog لاختيار type/severity
- `docs/API.md` — قسم جديد للتعلم من أخطاء الكود — `63/63` اختبار (17 جديد)

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
