# DEPLOYMENT — MSS AI Gateway 1.1.0

## المتطلبات

- Node 22+
- Docker + Docker Compose 2.20+
- Flutter 3.22+ (للتطبيق)
- `JWT_SECRET` ≥ 32 محرف في الإنتاج

## التشغيل المحلي (بدون Docker — fallback memory)

```bash
npm test                          # 63 اختبار — تعمل بدون DB
npm start                         # http://localhost:3000/health
node scripts/seed.js
```

## التشغيل الكامل (Docker —موصى به)

```bash
cp .env.example .env
# عدّل JWT_SECRET و PGPASSWORD في .env
docker compose up -d --build      # ينتظر DB تلقائياً ثم يطبق migrations 000→003
docker compose logs -f gateway    # راقب: MSS Gateway (1+2+3+5) listening...
curl http://localhost:3000/health # → {"ok":true,"version":"1.1.0"}
curl http://localhost:3000/ready  # → checks postgres/redis
npm run seed                      # demo@mss.local / demo1234
npm start                         # أو افتح التطبيق
# في نافذة أخرى
node examples/full-journey.js
```

### ما يحدث تلقائياً عند `up`

1. `db` يبدأ + `pg_isready` healthcheck
2. `redis` + `minio` healthchecks
3. `gateway` ينتظر `service_healthy` لـ db/redis
4. `scripts/wait-for-db.js` → يتحقق من `SELECT 1`
5. `scripts/migrate.js` → يطبّق `migrations/000_*.sql` → `003_code_errors.sql` (يدعم إعادة التشغيل idempotent)
6. `node src/server.js` مع `HEALTHCHECK` كل 30s على `/health`

## المتغيرات

| متغير | افتراضي | وصف |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@db:5432/mss_gateway` | سيُستخدم fallback memory إذا فشل |
| `REDIS_URL` | `redis://redis:6379` | fallback Map |
| `S3_BUCKET` / `S3_ENDPOINT` | `mss-uploads` / `http://minio:9000` | fallback memory |
| `JWT_SECRET` | `dev` | **غيّره في الإنتاج ≥32** |
| `PGPASSWORD` | `postgres` | كلمة مرور Postgres |
| `ROUTING_ALPHA` / `EPSILON` | `0.2` / `0.1` | bandit params |
| `ROUTING_CACHE_TTL` | `21600000` (6h) | TTL الكاش |
| `MODERATION_ENABLED` | `false` | `true` لتفعيل الإشراف |
| `MODELS_JSON` | 6 فئات code/vibe... | `{"code":["strong-code",...],"vibe":[...]}` |

## الإنتاج

```bash
# على السيرفر
cp .env.example .env
nano .env # ضع JWT_SECRET طويل عشوائي: openssl rand -base64 32
# احذف المنافذ المكشوفة لـ DB/Redis
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# أو على Railway/Render: استخدم DATABASE_URL الخارجي وادفع الصورة
docker build -t registry.example/mss:1.1.0 .
docker push registry.example/mss:1.1.0
```

**قائمة التحقق للإنتاج:**
- [ ] `JWT_SECRET` عشوائي ≥32 (الخادم يرفض الافتراضي في `NODE_ENV=production`)
- [ ] `PGPASSWORD` قوي + `POSTGRES_PASSWORD` متطابق
- [ ] احذف `ports: ["5432:5432"]` لـ db/redis أو قيده `127.0.0.1:5432:5432`
- [ ] فعّل `MODERATION_ENABLED=true` إذا لزم
- [ ] خزّن مفاتيح النماذج في Vault لا في `env` ( `api_keys` جدول + `POST /v1/auth/api-keys`)
- [ ] راقب `GET /metrics` + `GET /v1/admin/stats` (Bearer admin)
- [ ] فعل نسخ احتياطي لـ `pgdata` ( `docker volume` + `pg_dump`)

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
# إصدار
flutter build apk --release --dart-define=GATEWAY_URL=https://api.example.com
flutter build ios --release
```

## المراقبة والاستكشاف

```bash
docker compose ps
docker compose logs gateway --tail 100
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/metrics | head -20
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/v1/admin/stats
curl http://localhost:3000/v1/learning/code-stats | jq
docker compose down -v  # حذف كامل مع البيانات
```

### الأعطال الشائعة

| مشكلة | حل |
|---|---|
| `pg_isready: no response` | انتظر 10s — healthcheck يعيد المحاولة |
| `JWT_SECRET change-me` warning | ضع قيمة ≥32 في `.env` وأعد `up` |
| `migrations already exists` | طبيعي — idempotent |
| `quota_exceeded` | المستخدم وصل 1000/يوم — انتظر أو زد `quota_daily` |
| `rate_limited` | 120/دقيقة لكل IP — جرّب `scripts/load-test.js 8 3` |

## الترقيات

```bash
git pull
docker compose build gateway
docker compose up -d
docker compose exec gateway node scripts/migrate.js # يطبق 003 تلقائياً إذا ناقص
```

