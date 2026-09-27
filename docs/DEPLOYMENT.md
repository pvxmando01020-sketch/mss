# DEPLOYMENT — MSS AI Gateway 1→4

## المتطلبات

- Node 22+
- Docker + Docker Compose
- Flutter 3.22+ (للتطبيق)

## التشغيل المحلي (بدون Docker — fallback memory)

```bash
npm test                          # 45 اختبار — تعمل بدون DB
npm start                         # http://localhost:3000/health
node scripts/seed.js
```

## التشغيل الكامل (مع Postgres/Redis/S3)

```bash
cp .env.example .env
docker-compose up -d               # db:5432, redis:6379, minio:9000
npm run migrate                    # يطبق 000 + 001 + 002
npm run seed                       # demo@mss.local / demo1234
npm start
# في نافذة أخرى
node examples/full-journey.js
```

## البيئة

| متغير | افتراضي | وصف |
|---|---|---|
| `DATABASE_URL` | memory | `postgres://postgres:postgres@localhost:5432/mss_gateway` |
| `REDIS_URL` | memory | `redis://localhost:6379` |
| `S3_ENDPOINT` | memory | `http://localhost:9000` |
| `JWT_SECRET` | dev-secret | غيّره في الإنتاج |
| `MODERATION_ENABLED` | false | طبقة إشراف موازية |
| `MODELS_JSON` | افتراضي 6 نماذج | تخصيص `modelsByCategory` |

## الـ Preview (E2B / Codespaces)

الخادم يربط `0.0.0.0` و `CORS: origin:true` — الواجهة تستخدم `gateway_client.dart` baseUrl:

```dart
GatewayClient(baseUrl: 'https://3000-xxxx.e2b.app')
```

لا تستخدم `localhost` في كود المتصفح — استخدم relative URLs أو `baseUrl` من env.

## Flutter

```bash
cd flutter
flutter pub get
flutter test
flutter run -d chrome --dart-define=GATEWAY_URL=https://3000-xxxx.e2b.app
```

## المراقبة

- `GET /health` — سريع
- `GET /ready` — فحص postgres/redis
- `GET /metrics` — Prometheus
- `GET /v1/admin/stats` — (Bearer admin)

## الإنتاج

- غيّر `JWT_SECRET` و `PGPASSWORD`
- فعّل `MODERATION_ENABLED=true` إذا لزم
- استخدم Vault لـ API keys بدل env
- راقب `mss_memory_heap_bytes` + `mss_requests_total`
