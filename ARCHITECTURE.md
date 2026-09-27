# ARCHITECTURE — Smart Routing Engine (مرحلة 3)

وثيقة معمارية تنفيذية للخطة الموحدة. كل القرارات هنا مربوطة بالبنية الحالية Fastify + Postgres/Redis/S3.

---

## 1. المعمارية العامة (4 طبقات)

```
[Flutter App — Local Pre-Processor]
  │  extractFeatures() + classify() + complexity() + LocalCache + shouldBypassModel()
  │  ScoreStore (SQLite على الجهاز — هنا JSON/ذاكرة للتبسيط)
  │  OfflineQueue (رسائل غير مرسلة)
  ▼
[قرار التوجيه — محلي أولاً]
  │  route(text, store, {models, cache}) → {category, complexity, model, confidence, key}
  │  fallback: إذا غير متأكد → اسأل Gateway
  ▼
[API Gateway — Fastify]
  │  POST /v1/route → buildRouteHandler()
  │  محول النموذج → Claude / Gemini / Kimi / ...
  │  إعادة محاولة + fallback بين النماذج (موجود أصلاً)
  │  S3 للملفات، Redis للكاش الساخن، Postgres للملخصات
  ▼
[Performance Logger]
   │  POST /v1/feedback {category, model, quality, latency_ms, regenerated, manualCorrection}
   │  ScoreStore.update() → (1-α)*score + α*quality
   │  summaryForPostgres() → مزامنة دورية (best-effort)
```

**لماذا Flutter؟** نفس ستاك تطبيق التحكم لبوت التداول → تقليل تعدد التقنيات. React Native مقبول لو الفريق أكثر خبرة، لا يوجد سبب تقني يرجحه.

---

## 2. استخراج الميزات (features.js)

تعمل بدون API، على الجهاز فقط.

| الميزة | التنفيذ | ملاحظات |
|---|---|---|
| `charCount` / `wordCount` | `WORD_RE = /[\p{L}\p{N}_]+/gu` | unicode-aware |
| `arabicRatio` | `ARABIC_RE = /[\u0600-\u06FF]/g` | `ar` >0.35، `mixed` >0.08 |
| `hasCode` / `codeScore` | `CODE_SIGNALS` + عد أسطر `{}();=` | `codeScore = min(1, 0.6 + lines*0.15)` |
| `technicalDensity` | `TECH_DICT` (40+ مصطلح) | `count / wordCount` |
| `intent` | `INTENT_PATTERNS` unicode-aware | `write/review/analyze/summarize/code/retrieve` |

حدود unicode مهمة للعربية: `\b` لا يعمل مع العربية بدون `u` flag، لذلك نستخدم `(?:^|[^\p{L}\p{N}_])...(?=[^\p{L}\p{N}_]|$)` مع `iu`.

---

## 3. التصنيف (classifier.js)

### 3a — rule-based (بدون ML)
قواعد مرتبة حسب الأولوية: `code` > `retrieval` (قصير) > `analysis` > `creative` > `general`.

### 3d — شجرة قرار / انحدار لوجستي
- متجه 9 أبعاد: `[hasCode, codeScore, technicalDensity*4, wordCountNorm, arabicRatio, intent_code, intent_write, intent_analyze, intent_retrieve]`
- أوزان `TREE_WEIGHTS` مضمنة كملف ثابت (كيلوبايتات) — قابلة للتحديث OTA بدون إعادة تدريب سحابي.
- `softmax(logits)` → `probs` → أفضل فئة.
- إذا `bestProb < 0.38` → fallback إلى القواعد (يحمي من ضوضاء الأوزان الأولية). إذا اتفق الاثنان نرفع الثقة.

هذا يعطي دقة جيدة بدون TensorFlow Lite أولاً (توفير حجم/بطارية)، مع تحديث تدريجي للأوزان عبر `ScoreStore`.

---

## 4. التعقيد (complexity)

```js
complex: wc>180 || (code && (wc>80 || hasCode)) || (analysis && wc>90) || (ar>0.5 && wc>100)
medium:  wc>35 || technicalDensity>0.12 || !intent
simple:  otherwise
```

يحدد الميزانية:

| المستوى | الإجراء |
|---|---|
| simple | جرّب `LocalCache.get(hashKey(text,cat,model))` أولاً؛ إن وجد → رد فوري |
| medium | النموذج الافتراضي للفئة |
| complex | النموذج الأقوى + إمكانية استدعاء مزدوج للمقارنة (اختياري) |

---

## 5. ScoreStore — التعلم المستمر (store.js)

### الهيكل
```json
{ "category":"code", "model":"claude", "latency_ms":1840, "quality_score":0.8, "regenerated":false, "timestamp":"..." }
```

### Quality proxies (بدون طلب تقييم دائم)
- هل أعاد التوليد؟ `regenerated=true` → quality منخفض
- هل قصّر/عدّل الإجابة؟
- هل النسخة النهائية طويلة نسبيًا (مؤشر اكتفاء)؟
- تقييم يدوي 👍👎 إن وجد

### التحديث — bandit epsilon-greedy
```
score[c][m] = (1-α)*score[c][m] + α*quality        // α=0.2 افتراضيًا
manualCorrection → α×2.5 (حتى 0.6)                // التبديل اليدوي إشارة مؤكدة
pick: 90% الأعلى score، 10% عشوائي من الباقي
confidence = score * (1 - 1/(1+totalSamples))     // novelty_penalty
```

### التخزين
- **على الجهاز**: `SQLite` (هنا `toJSON()/fromJSON()` + `log` آخر 2000 حدث، ملخص آخر 500 للإرسال).
- **على الخادم**: `summaryForPostgres()` → `{ summary:{cat:{model:{score,samples}}}, totalEvents, regenRate }` → `INSERT INTO routing_summaries`.
- **مزامنة**: `mergeSummary()` لدمج ملخص قادم من Postgres (متعدد أجهزة).

لا يحتاج RL ثقيل على الهاتف — online update فقط.

---

## 6. Heuristics قبل الاستدعاء (cache.js)

```js
shouldBypassModel({category, model, wordCount, store, threshold:0.52})
// code + wordCount>60 + confidence<threshold → true
// confidence<0.32 && total<4 → true
```

بدل استدعاء نموذجين ومقارنة، نقرر قبل الاستدعاء.

---

## 7. الكاش والطابور (cache.js)

- **LocalCache**: `Map` + `TTL` (افتراضي 6 ساعات) + `LRU` (maxEntries=300). المفتاح `hashKey = sha256(cat::model::text[0..2000])[:32]`.
- **OfflineQueue**: طابور محلي `maxSize=100`، كل عنصر `{id, text, meta, attempts, createdAt}`. بعد 5 محاولات يُحذف لتفادي الانسداد. عند عودة الشبكة يُعاد الإرسال عبر Gateway الذي يملك retry/fallback أصلاً.

---

## 8. تكامل Gateway (gateway.js)

```js
POST /v1/route   { text, overrideModel?, overrideCategory? }
  → buildRouteHandler({store, cache, modelsByCategory, epsilon})
  → { category, model, confidence, complexity, cached, key, candidates, method }

POST /v1/feedback { category, model, quality, latency_ms, regenerated, manualCorrection }
  → store.update(...)
  → persistSummary(store.summaryForPostgres()) // best-effort

GET /v1/routing/stats
  → store.summaryForPostgres()
```

- يدعم `overrideModel` للتبديل اليدوي من UI (شريحة "تم اختيار Claude — سؤال كتابة إبداعية").
- `persistSummary` اختيارية — لو فشلت لا تفشل الطلب.
- المفاتيح لا تمر عبر التطبيق؛ فقط `text` يُرسل.

---

## 9. Flutter — تطبيق كامل

- `lib/smart_router.dart` — نفس المنطق بـ Dart (offline)
- `lib/main.dart` + `lib/services/local_store.dart` (ScoreStore + تثبيت نموذج + OfflineQueue في SharedPreferences) + `lib/services/gateway_client.dart`
- `lib/screens/chat_screen.dart` — محادثة + `widgets/routing_badge.dart` ("تم اختيار Claude — ...") + 👍👎 + إعادة توليد + طابور offline
- `lib/screens/settings_screen.dart` — تثبيت نموذج لفئة (تجاوز كامل) + إحصائيات Postgres
- `test/smart_router_test.dart` — 5 اختبارات Dart

---

## 10. الخصوصية

- **يبقى على الجهاز**: التصنيف، heuristics، سجل الأداء، الكاش، الطابور.
- **يُرسل**: نص الطلب النهائي فقط عبر Gateway (لا يُرسل القطيع/المفاتيح/معلومات التصنيف).
- النموذج المحلي صغير جدًا (decision tree) بدون TFLite أولاً.

---

## 11. خارطة الطريق

| المرحلة | المحتوى | الحالة |
|---|---|---|
| 3a | ميزات + مصنف rule-based | ✅ |
| 3b | سجل أداء + bandit + Postgres summary + logger proxies | ✅ |
| 3c | تطبيق Flutter كامل (chat + settings + OfflineQueue + Gateway client) + خادم Fastify كامل | ✅ |
| 3d | شجرة قرار مدرّبة + تعلم تدريجي (TREE_WEIGHTS + online update) | ✅ |
| 4 | اختبار بطارية/ذاكرة (`scripts/benchmark.js`) + طبقة إشراف موازية (`src/moderation.js`) | ✅ |

تحديات محلولة من البنية الحالية: retry/fallback بين النماذج موجود في Gateway؛ يبقى طابور محلي في Flutter فقط.

---

## 12. قرارات تصميمية ولماذا

| القرار | البديل المرفوض | السبب |
|---|---|---|
| bandit epsilon-greedy بدل RL | PPO / Thompson أثقل | كافٍ عمليًا، لا يحتاج بنية RL على الهاتف |
| شجرة قرار بوزن ثابت + قواعد | Transformer صغير على الجهاز | حجم/بطارية/تعقيد غير مبرر في المرحلة 3 |
| confidence = score*(1-novelty) | استدعاء نموذجين ومقارنة | يوفر تكلفة وكمون |
| ملخصات لـ Postgres فقط | إرسال السجل الخام | خصوصية + توفير نقل |
| Flutter | React Native | نفس ستاك بوت التداول الحالي |

---

## 13. المخاطر والتخفيف

| الخطر | التخفيف |
|---|---|
| تصنيف خاطئ للعربية العامية | أوزان OTA + fallback rules + زر تبديل يدوي بوزن عالٍ |
| سجل ضعيف لفئة جديدة | novelty_penalty عالٍ → ثقة منخفضة → heuristics تتجاوز للبديل |
| كاش قديم | TTL 6 ساعات + LRU + إبطال عند feedback سلبي |
| طابور offline يمتلئ | maxSize + حذف بعد 5 محاولات + إظهار حالة للمستخدم |
| انحياز لنموذج واحد | epsilon 10% استكشاف + مراقبة regenRate |

---

## 14. اختبار الأداء (مرحلة 4)

- قياس ذاكرة `ScoreStore` (2000 حدث ≈ <200KB JSON) + `LocalCache` (300 مدخل).
- قياس بطارية للاستدلال المتكرر (شجرة القرار ~ بضع ميكروثواني).
- إذا لزم → النظر في moderation كطبقة موازية منفصلة، لا كجزء من التوجيه.

