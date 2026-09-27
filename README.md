# MSS — محرك التوجيه الذكي (Smart Routing Engine) — المرحلة 3 + 4

> طبقة توجيه ذكية تعمل **محليًا أولاً** فوق البنية الحالية **Fastify Gateway + Postgres/Redis/S3** مع تطبيق موبايل Flutter.

هذا المستودع يطبّق **الخطة الموحدة (مرحلة 3)** التي دمجت "طبقة الإشراف" و"إضافة النماذج" في حل واحد: **اختيار النموذج الأنسب لكل سؤال تلقائيًا على الجهاز، ثم التوجيه عبر الـ Gateway الحالي**، مع **مرحلة 4** (اختبار بطارية/ذاكرة + طبقة إشراف موازية).

---

## لماذا هذه المعمارية؟

- **لا مفاتيح API على الجهاز** — المفاتيح تبقى في الـ backend كما هو مطبق في الـ Gateway.
- **بدون استدعاء مزدوج** — نستخدم heuristics + ثقة مسبقة بدل مقارنة ردّين.
- **خفيف جدًا** — مصنف شجرة قرار/انحدار لوجستي بحجم كيلوبايتات + قواعد احتياطية، لا TensorFlow Lite في البداية.
- **تعلم مستمر بدون RL ثقيل** — bandit بسيط (epsilon-greedy) مع تحديث online.

---

## المعمارية العامة — 4 طبقات

```
[Flutter App — lib/main.dart]
  → Local Pre-Processor (extractFeatures + classify + heuristics + LocalCache)
  → قرار التوجيه (محلي أولاً، fallback لو غير متأكد)
  → OfflineQueue (عند فشل الشبكة) + إعادة المحاولة تلقائيًا
  → API Gateway (Fastify src/server.js) → محول النموذج (Claude/Gemini/Kimi/...)
  → Performance Logger (logger.js) → يحدّث أوزان ScoreStore + يزامن ملخصات لـ Postgres
  → Moderation (moderation.js — طبقة موازية منفصلة، مرحلة 4)
```

لماذا Flutter؟ نفس ستاك تطبيق التحكم لبوت التداول → تقليل تعدد التقنيات.

---

## بنية المستودع

```
src/
  features.js        # استخراج ميزات محلي (طول/لغة/كود/كثافة تقنية/نية)
  classifier.js      # تصنيف + شجرة قرار بأوزان مضمنة + fallback rule-based
  store.js           # ScoreStore — bandit + confidence + ملخص Postgres
  cache.js           # LocalCache (LRU+TTL) + OfflineQueue + hashKey + shouldBypassModel
  gateway.js         # buildRouteHandler + smartRouterPlugin (Fastify)
  server.js          # مصنع Fastify الكامل (health/chat/feedback/stats + retry/fallback)
  config.js          # إعدادات مركزية (env)
  logger.js          # Performance Logger + quality proxies
  sync.js            # مزامنة ملخصات لـ Postgres
  moderation.js      # طبقة إشراف موازية (مرحلة 4)
  router.js          # واجهة موحدة (تستخدمها Gateway وFlutter)
  index.js           # نقطة دخول
  adapters/
    db.js            # Postgres مع fallback memory
    cacheRedis.js    # Redis مع fallback Map
    modelAdapter.js  # محول Claude/Gemini/Kimi (stub → استبدل بـ fetch الحقيقي)
migrations/
  001_routing.sql    # جداول routing_summaries + routing_feedback + user_prefs
flutter/
  lib/
    smart_router.dart          # نفس المنطق بـ Dart — يعمل offline
    main.dart                  # نقطة دخول التطبيق
    services/local_store.dart  # ScoreStore + تثبيت نموذج + طابور offline (SharedPreferences)
    services/gateway_client.dart # HTTP client للـ Gateway (يرسل text فقط)
    screens/chat_screen.dart   # شاشة محادثة + RoutingBadge + 👍👎 + إعادة توليد
    screens/settings_screen.dart # تثبيت نموذج لفئة + إحصائيات Postgres
    widgets/routing_badge.dart # شريحة "تم اختيار Claude — سؤال كتابة إبداعية"
  test/smart_router_test.dart
  pubspec.yaml
tests/
  router.test.js      # ميزات + تصنيف + bandit
  gateway.test.js     # /v1/route /chat/completions /feedback
  moderation.test.js  # طبقة الإشراف
  logger.test.js      # quality proxies
  cache.test.js       # LRU + OfflineQueue + bypass
scripts/
  benchmark.js        # قياس بطارية/ذاكرة (مرحلة 4)
examples/
  gateway-example.js
docker-compose.yml    # Postgres + Redis + MinIO (S3) + Gateway
Dockerfile
.env.example
```

---

## 1) استخراج الميزات محليًا (بدون API)

| الميزة | الحساب |
|---|---|
| طول السؤال | عدد الكلمات/الأحرف |
| اللغة | نسبة الأحرف العربية (`\u0600-\u06FF`) → `ar`/`en`/`mixed` |
| وجود كود | regex لـ ``` , `function`, `def`, أقواس متداخلة |
| كثافة تقنية | نسبة كلمات من قاموس مبني مسبقًا (`api`, `postgres`, `تحليل` ...) |
| نوع الطلب | مطابقة أنماط unicode-aware: `اكتب/صمم/راجع/حلل/لخص` |

```js
const { extractFeatures } = require('./src/features');
extractFeatures('لخص لي مقال عن الذكاء الاصطناعي');
// → { wordCount: 8, language:'ar', hasCode:false, intent:'summarize', ... }
```

---

## 2) التصنيف

| الفئة | النموذج الافتراضي (قابل للتعديل تلقائيًا) |
|---|---|
| `code` | `strong-code` |
| `creative` | `claude` |
| `analysis` | `accurate-math` |
| `retrieval` | `fast-cheap` |
| `general` | `fast-cheap` |

المصنف: شجرة قرار/انحدار لوجستي بأوزان ثابتة (`TREE_WEIGHTS`) + fallback إلى `classifyRules` إذا ثقة الشجرة <0.38.

---

## 3) التعقيد → استراتيجية الموارد

| المستوى | المعيار | الميزانية |
|---|---|---|
| `simple` | سؤال قصير، فئة معروفة | كاش محلي أو نموذج خفيف |
| `medium` | طول متوسط أو فئة بلا سجل كافٍ | النموذج الافتراضي للفئة |
| `complex` | كود طويل / تحليل متعدد الخطوات / عربي طويل مركب | النموذج الأقوى + استدعاء مزدوج |

---

## 4) تتبع الأداء — bandit

```js
const { ScoreStore } = require('./src/store');
const store = new ScoreStore({}, { alpha:0.2, epsilon:0.1 });
store.update('creative','claude',0.9, {latency_ms:1200});
store.update('code','strong-code',0.4, {regenerated:true});
store.update('code','fast-cheap',1.0, {manualCorrection:true}); // α×2.5
store.confidence('creative','claude'); // score * (1 - 1/(1+total))
store.summaryForPostgres(); // → {summary, totalEvents, regenRate}
```

**Quality proxies بدون تقييم صريح:** إعادة التوليد؟ تقصير الإجابة؟ طول النسخة النهائية؟ `logger.js#estimateQuality` يحوّلها إلى 0..1.

---

## 5) Heuristics قبل الاستدعاء

```js
shouldBypassModel({category:'code', model:'fast-cheap', wordCount:80, store})
// → true لو فئة برمجة + سؤال طويل + السجل ضعيف → تجاوز قبل الاستدعاء
```

---

## 6) الكاش وطابور Offline

```js
const { LocalCache, OfflineQueue, hashKey } = require('./src/cache');
const cache = new LocalCache({maxEntries:300, ttlMs:6*60*60*1000});
cache.set(hashKey(text,cat,model), response);

const q = new OfflineQueue();
q.enqueue(text, {category}); // عند فشل الشبكة → يُعاد تلقائيًا عند عودة الاتصال
```

في Flutter: `services/local_store.dart` يحفظ الطابور في `SharedPreferences` + يزامن عند عودة الشبكة (نفس Retry/Offline الموجود في Gateway).

---

## 7) الاستخدام السريع

```js
const { route, ScoreStore } = require('./src/router');
const store = new ScoreStore();
route('اكتب لي دالة فيبوناتشي', store);
// → {category:'code', complexity:'complex', model:'strong-code', confidence:0.31, key:'...'}
```

---

## 8) تكامل Gateway — خادم كامل

```bash
cp .env.example .env
docker-compose up -d          # Postgres + Redis + MinIO
npm run migrate               # ينشئ routing_summaries + routing_feedback + user_prefs
npm start                     # Fastify على 0.0.0.0:3000
```

```js
// src/server.js — يعمل بدون fastify/pg/ioredis (stub للاختبارات)
const { buildApp } = require('./src/server');
const app = await buildApp();
await app.listen({ host:'0.0.0.0', port:3000 });
// GET  /health
// POST /v1/route             {text, overrideModel?}
// POST /v1/chat/completions  {text} → {category, model, response, latency_ms}
// POST /v1/feedback/auto     {category, model, thumbsUp?, regenerated?}
// GET  /v1/routing/stats
// GET  /v1/models
```

المفاتيح تبقى في env على الخادم — التطبيق يرسل فقط `text`. Retry/fallback بين النماذج موجود أصلاً في Gateway.

---

## 9) Flutter — تطبيق كامل

```dart
// lib/main.dart
final store = LocalStore(); await store.init();
// lib/screens/chat_screen.dart — يعرض RoutingBadge تحت كل رد
// lib/screens/settings_screen.dart — تثبيت نموذج لفئة (تجاوز كامل)
```

**شريحة تحت كل رد:**
```dart
RoutingBadge(category: 'creative', model: 'claude', confidence: 0.82, onSwitch: () => showModelPicker())
// → "تم اختيار Claude — سؤال كتابة إبداعية  82%  [تبديل]"
```

التبديل اليدوي يُسجل كـ correction قوي (`manualCorrection:true` → α×2.5).

```bash
cd flutter
flutter pub get
flutter test               # 5 اختبارات Dart
flutter run -d chrome      # يعمل مع Gateway على http://localhost:3000
# للـ preview (E2B): عدّل gateway_client.dart baseUrl إلى https://3000-xxx.e2b.app
```

---

## 10) طبقة الإشراف — مرحلة 4 (موازية)

```js
const { preCheck, postCheck } = require('./src/moderation');
preCheck(text, {blockThreshold:0.92, flagThreshold:0.65})
// → {action:'allow'|'flag'|'block', reason, score}
```

**القرار المعماري:** لا تُبنى كجزء من مسار التوجيه؛ تُشغل كـ middleware موازٍ قبل/بعد الاستدعاء، وتُفعّل عبر `MODERATION_ENABLED=true`. هذا يجنّب حجب غير مبرر ويبقي التوجيه خفيفًا.

---

## 11) التشغيل والاختبار

```bash
npm test              # 31 اختبار (node --test)
npm run benchmark     # قياس بطارية/ذاكرة — مرحلة 4
node examples/gateway-example.js

cd flutter && flutter test
```

**نتائج benchmark (10k توجيه):**
```
extractFeatures: 7.0 µs  | classify: 14.2 µs | route: 19.1 µs
ScoreStore (2000 events): 87.5 KB JSON | LocalCache (300): ~150 KB
→ لا حاجة لـ TFLite — شجرة القرار <0.1% CPU لكل 1000 توجيه
```

---

## 12) خارطة الطريق

| المرحلة | المحتوى | الحالة |
|---|---|---|
| 3a | استخراج ميزات + مصنف rule-based | ✅ |
| 3b | سجل أداء + bandit + ملخص Postgres | ✅ |
| 3c | تطبيق Flutter موصول بالـ Gateway + طابور offline | ✅ |
| 3d | شجرة قرار مدرّبة + تعلم تدريجي | ✅ |
| 4 | اختبار بطارية/ذاكرة + طبقة إشراف موازية | ✅ |

---

## 13) الخصوصية

- التصنيف/heuristics/سجل الأداء/الكاش **يبقى على الجهاز** (SQLite/SharedPreferences).
- لا تُرسل معلومات التصنيف أو مفاتيح API — فقط `text` عبر Gateway.
- النموذج المحلي بلا TFLite — تحديث تدريجي بلا إعادة تدريب سحابي.

---

## الترخيص

MIT
