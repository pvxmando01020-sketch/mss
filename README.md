# MSS — محرك التوجيه الذكي (Smart Routing Engine) — المرحلة 3

> طبقة توجيه ذكية تعمل **محليًا أولاً** فوق البنية الحالية **Fastify Gateway + Postgres/Redis/S3** مع تطبيق موبايل Flutter.

هذا المستودع يطبّق **الخطة الموحدة (مرحلة 3)** التي دمجت "طبقة الإشراف" و"إضافة النماذج" في حل واحد: **اختيار النموذج الأنسب لكل سؤال تلقائيًا على الجهاز، ثم التوجيه عبر الـ Gateway الحالي**.

---

## لماذا هذه المعمارية؟

- **لا مفاتيح API على الجهاز** — المفاتيح تبقى في الـ backend كما هو مطبق في الـ Gateway.
- **بدون استدعاء مزدوج** — نستخدم heuristics + ثقة مسبقة بدل مقارنة ردّين.
- **خفيف جدًا** — مصنف شجرة قرار/انحدار لوجستي بحجم كيلوبايتات + قواعد احتياطية، لا TensorFlow Lite في البداية.
- **تعلم مستمر بدون RL ثقيل** — bandit بسيط (epsilon-greedy) مع تحديث online.

---

## المعمارية العامة — 4 طبقات

```
[Flutter App]
  → Local Pre-Processor (استخراج ميزات + heuristics + كاش)
  → قرار التوجيه (محلي أولاً، fallback لو غير متأكد)
  → API Gateway (Fastify) → محول النموذج (Claude/Gemini/Kimi/...)
  → Performance Logger → يحدّث أوزان الاختيار محليًا + يزامن ملخصات لـ Postgres
```

لماذا Flutter؟ لأنه نفس الستاك المستخدم في تطبيق التحكم الخاص ببوت التداول، فيقلل تعدد التقنيات. React Native مقبول لو الفريق أكثر خبرة، لكن لا يوجد سبب تقني يرجحه.

---

## بنية المستودع

```
src/
  features.js      # استخراج الميزات محليًا (طول، لغة، كود، كثافة تقنية، نوع الطلب)
  classifier.js    # تصنيف + شجرة قرار بأوزان مضمنة + fallback rule-based
  store.js         # ScoreStore — bandit + confidence + ملخص Postgres
  cache.js         # LocalCache (LRU + TTL) + OfflineQueue + hashKey
  gateway.js       # تكامل Fastify — POST /v1/route, /v1/feedback, /v1/routing/stats
  router.js        # واجهة موحدة (تستخدمها الـ Gateway وFlutter)
  index.js         # نقطة دخول
flutter/
  lib/smart_router.dart  # نفس المنطق بـ Dart — يعمل offline بالكامل
  pubspec.yaml
tests/
  router.test.js   # 13 اختبار (node --test)
examples/
  gateway-example.js  # عرض حي للتوجيه + محاكاة handler Fastify
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
// → { wordCount: 8, language:'ar', hasCode:false, technicalDensity:0, intent:'summarize', ... }
```

---

## 2) التصنيف

**الفئات الخمس + النموذج الافتراضي المبدئي** (قابل للتعديل تلقائيًا من السجل، ليس ثابتًا):

| الفئة | النموذج الافتراضي |
|---|---|
| `code` | `strong-code` |
| `creative` | `claude` |
| `analysis` | `accurate-math` |
| `retrieval` | `fast-cheap` |
| `general` | `fast-cheap` |

**المصنف**: شجرة قرار/انحدار لوجستي بأوزان ثابتة (`TREE_WEIGHTS`) مضمنة في التطبيق، مع fallback إلى `classifyRules` إذا كانت ثقة الشجرة < 0.38 أو فشل الاستدلال.

```js
const { classify } = require('./src/classifier');
classify('def fibonacci(n): ...'); // → { category:'code', confidence:0.92, method:'tree' }
classify('اكتب لي قصة قصيرة');      // → { category:'creative', ... }
```

---

## 3) التعقيد → استراتيجية الموارد

| المستوى | المعيار | الميزانية |
|---|---|---|
| `simple` | سؤال قصير، فئة معروفة، تاريخ موثوق | كاش محلي أو نموذج خفيف |
| `medium` | طول متوسط أو فئة بلا سجل كافٍ | النموذج الافتراضي للفئة |
| `complex` | كود طويل / تحليل متعدد الخطوات / سؤال عربي طويل مركب | النموذج الأقوى + إمكانية استدعاء مزدوج |

```js
const { complexity } = require('./src/classifier');
complexity(features, 'code'); // 'simple' | 'medium' | 'complex'
```

---

## 4) تتبع الأداء والتعلم المستمر (bandit)

```js
const { ScoreStore } = require('./src/store');
const store = new ScoreStore({}, { alpha: 0.2, epsilon: 0.1 });

// بعد كل تفاعل — quality من 👍👎 أو proxies
store.update('creative', 'claude', 0.9, { latency_ms: 1200 });

// proxies بدون تقييم صريح: هل أعاد التوليد؟ هل قصّر الإجابة؟ هل النسخة النهائية طويلة؟
store.update('code', 'strong-code', 0.4, { regenerated: true });

// التبديل اليدوي = correction قوي
store.update('code', 'fast-cheap', 1.0, { manualCorrection: true }); // alpha ×2.5

store.confidence('creative', 'claude'); // score * (1 - noveltyPenalty)
store.summaryForPostgres(); // { summary, totalEvents, regenRate } → يُرسل لـ Postgres
```

- **التحديث**: `score = (1-α)*score + α*quality`
- **الاختيار**: 90% الأعلى score، 10% استكشاف (epsilon-greedy)
- **الثقة المسبقة**: `confidence = score * (1 - 1/(1+totalSamples))`

يبقى السجل الخام في SQLite على الجهاز (هنا في الذاكرة/JSON)؛ يُرسل فقط الملخص المجمع لـ Postgres.

---

## 5) Heuristics قبل الاستدعاء

```js
const { shouldBypassModel } = require('./src/cache');
shouldBypassModel({ category:'code', model:'fast-cheap', wordCount: 80, store });
// → true لو فئة برمجة + سؤال طويل + السجل ضعيف → تجاوز لنموذج بديل قبل الاستدعاء
```

---

## 6) الكاش وطابور Offline

```js
const { LocalCache, OfflineQueue, hashKey } = require('./src/cache');
const cache = new LocalCache({ maxEntries: 300, ttlMs: 6*60*60*1000 });
const key = hashKey(text, category, model);
cache.set(key, response);
cache.get(key); // LRU + TTL

const queue = new OfflineQueue();
queue.enqueue(text, { category }); // عند فشل الشبكة
queue.dequeue(); // عند عودة الاتصال — إعادة محاولة مع fallback الموجود أصلاً في Gateway
```

---

## 7) الاستخدام السريع — قرار واحد

```js
const { route, ScoreStore } = require('./src/router');
const store = new ScoreStore();

route('اكتب لي دالة تحسب فيبوناتشي', store);
// → { category:'code', complexity:'complex', model:'strong-code', confidence:0.31, key:'...', candidates:[...] }

route('مرحبا', store, { cache: myCache }); // يستخدم الكاش لو simple
route('حلل بيانات 2024', store, { models: { analysis:['accurate-math','claude'] } });
```

---

## 8) تكامل Fastify Gateway

```js
const Fastify = require('fastify');
const { ScoreStore } = require('./src/store');
const { LocalCache } = require('./src/cache');
const { smartRouterPlugin } = require('./src/gateway');

const store = new ScoreStore();
const cache = new LocalCache();

const app = Fastify();
await app.register(smartRouterPlugin, {
  store, cache,
  modelsByCategory: {
    code: ['strong-code','fast-cheap'],
    creative: ['claude','fast-cheap'],
    analysis: ['accurate-math','claude'],
    retrieval: ['fast-cheap'],
    general: ['fast-cheap'],
  },
  persistSummary: async (summary) => {
    // INSERT INTO routing_summaries (data) VALUES ($1)
    await pg.query('INSERT INTO routing_summaries(data) VALUES($1)', [JSON.stringify(summary)]);
  }
});

// POST /v1/route     { text, overrideModel?, overrideCategory? }
// POST /v1/feedback  { category, model, quality, latency_ms, regenerated, manualCorrection }
// GET  /v1/routing/stats
await app.listen({ host:'0.0.0.0', port: 3000 });
```

المفاتيح تبقى في backend — التطبيق يرسل فقط `text`. عند فشل الاتصال أو النموذج، يعمل fallback الموجود أصلاً في الـ Gateway، ويبقى طابور محلي في Flutter للرسائل غير المرسلة.

---

## 9) Flutter — معالجة محلية بالكامل

```dart
import 'package:smart_routing_engine/smart_router.dart';

final store = ScoreStore();
final result = route('اكتب لي قصة قصيرة عن النيل', store);
// result['category'] == 'creative'
// result['model']    == 'claude'
// result['confidence']

// بعد تقييم المستخدم
store.update('creative', 'claude', 0.9, latencyMs: 1200);
if (userSwitchedModel) {
  store.update('creative', 'fast-cheap', 1.0, manualCorrection: true);
}
```

ما يبقى على الجهاز: التصنيف، heuristics، سجل الأداء، الكاش. ما يُرسل: نص الطلب النهائي عبر Gateway فقط.

---

## 10) واجهة المستخدم المقترحة

- شريحة أسفل كل رد: **"تم اختيار Claude — سؤال كتابة إبداعية"** + زر تبديل يدوي فوري.
- التبديل اليدوي يُسجل كـ correction قوي (وزنه أعلى).
- شاشة إعدادات لتثبيت نموذج معين لفئة (تجاوز كامل للتوجيه الذكي).

---

## التشغيل والاختبار

```bash
npm test              # node --test — 13 اختبار
npm run test:verbose  # تقرير مفصل
node examples/gateway-example.js  # عرض حي

# تحقق سريع
node -e "const {route, ScoreStore}=require('./src/router'); console.log(route('لخص لي مقال عن AI', new ScoreStore()))"
```

---

## خارطة الطريق (استكمالًا لمرحلة 1 و2 المنجزتين)

| المرحلة | المحتوى | الحالة |
|---|---|---|
| 3a | استخراج ميزات + مصنف rule-based | ✅ تم |
| 3b | سجل أداء + weighted scoring (bandit) + ملخص Postgres | ✅ تم |
| 3c | Flutter موصول بالـ Gateway + طابور offline | ✅ النواة تمت (lib/smart_router.dart) |
| 3d | استبدال rule-based بشجرة قرار مدرّبة + تعلم تدريجي | ✅ تم (TREE_WEIGHTS + online update) |
| 4 | اختبار بطارية/ذاكرة + إعادة النظر في طبقة الإشراف كخطوة موازية | ⏭ التالي |

---

## الخصوصية

- التصنيف والـ heuristics والكاش وسجل الأداء **تبقى على الجهاز**.
- لا تُرسل معلومات التصنيف أو مفاتيح API — فقط نص الطلب عبر Gateway.
- النموذج المحلي بلا TensorFlow Lite أولاً لتفادي الحجم/البطارية؛ تحديث تدريجي للأوزان بدون إعادة تدريب سحابي.

---

## الترخيص

MIT
