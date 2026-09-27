# API — MSS AI Gateway 1→4

Base URL: `http://localhost:3000` — كل المفاتيح تبقى في `env` على الخادم.

## الصحة والنماذج (مرحلة 1)

| Method | Path | الوصف |
|---|---|---|
| GET | `/health` | سريع — `{ok, version, phase}` |
| GET | `/ready` | `postgres`/`redis` checks |
| GET | `/metrics` | Prometheus `mss_*` |
| GET | `/v1/models` | `modelsByCategory` + `adapters` |

## المحادثة (مرحلة 1 — مباشر)

```http
POST /v1/chat/completions
Body: { prompt|text|message, model?, stream?, direct?, conversation_id? }
→ { id, choices:[{message:{content}}], usage, latency_ms }  // مباشر
→ { category, model, response, latency_ms }                  // ذكي (بدون model)
```

```http
POST /v1/embeddings
Body: { input }
→ { data:[{embedding: number[8]}] }
```

## المصادقة (مرحلة 2)

```http
POST /v1/auth/register  {email, password, role?} → {user}
POST /v1/auth/login     {email, password} → {token, user}
GET  /v1/auth/me        (Bearer) → {user}
POST /v1/auth/api-keys  (Bearer) {provider, key, label} → {key_hash}
```

## المحادثات (مرحلة 2)

```http
POST   /v1/conversations                    {title, model?} → {conversation}
GET    /v1/conversations?limit&offset       → {conversations}
GET    /v1/conversations/:id                → {conversation, messages}
POST   /v1/conversations/:id/messages       {role, content} → {message}
DELETE /v1/conversations/:id                → {ok}
POST   /v1/conversations/:id/chat           {text} → توجيه ذكي + حفظ
POST   /v1/uploads                          {filename,mime,dataBase64} → {key}
```

ربط 2↔3: `POST /v1/chat/completions` مع `conversation_id` يحفظ الرد تلقائياً.

## التوجيه الذكي (مرحلة 3)

```http
POST /v1/route            {text, overrideModel?} → {category, model, confidence, complexity}
POST /v1/feedback/auto    {category, model, thumbsUp?, regenerated?, latency_ms?, codeError?, vibeError?} → {quality, score, errorRate}
GET  /v1/routing/stats    → {summary, totalEvents, regenRate}
```

## التعلم من أخطاء الكود والـ Vibe Code (التحديث الجديد)

```http
POST /v1/feedback/code-error    {model, category?, errorType?, severity?, code_snippet?, vibe_context?} → {quality, score, errorRate}
POST /v1/feedback/vibe-error    {model, severity?, vibe_context?, code_snippet?} → {quality, score, errorRate}  # vibe افتراضي
POST /v1/feedback/code-success  {model, category?} → {ok, score, errorRate}
GET  /v1/learning/code-stats    → {counts, recent, rates:{code:{},vibe:{}}, store}
POST /v1/code/analyze           {text, category?, vibe_context?} → {hasCode, errors:[{type, severity, msg}], errorScore, vibeScore}
```

- `category` = `code` | `vibe` | `creative` | `analysis` | `retrieval` | `general` — الـ **vibe** للكود التفاعلي الجمالي.
- `errorType` = `syntax` | `runtime` | `logic` | `security` | `style` | `vibe_mismatch` | `test_fail` | `other`
- `severity` = `low` | `medium` | `high` | `critical` — يحدد `alpha` في `CodeErrorLearner` (0.4 للكود، 0.35 للـ vibe) وجودة العقاب
- `POST /v1/chat/completions` الآن يكتشف الكود تلقائياً عبر `codeAnalyzer` (``` + security/vibe patterns) ويحدّث `errorRate` قبل الرد → `autoError:{errorScore, errors, autoQuality}` في الرد إذا وُجدت أخطاء
- `Flutter` — زر `🐛` في كل رد كود يفتح dialog للإبلاغ (نوع + خطورة + مقتطف)
- الجداول: `code_errors` + `code_error_stats` (migration `003_code_errors.sql`) + VIEW `code_error_rates`

## الإدارة (مرحلة 1+2)

```http
GET /v1/admin/stats   (Bearer admin) → {users, conversations, messages, requests}
GET /v1/admin/routing (Bearer admin) → {routing}
```

## الإشراف (مرحلة 4)

```js
const { preCheck } = require('./src/moderation');
preCheck(text, {blockThreshold:0.92, flagThreshold:0.65})
// → {action:'allow'|'flag'|'block', reason, score}
```
يُفعّل بـ `MODERATION_ENABLED=true` في `.env`.

## الأخطاء

| Code | المعنى |
|---|---|
| 400 | `text is required` / `email and password required` |
| 401 | `unauthorized` |
| 403 | `admin only` / `forbidden` |
| 429 | `rate_limited` أو `quota_exceeded` |
| 502 | `model_error` |

## Rate & Quota

- `X-RateLimit-Limit/Remaining/Reset` على كل رد
- حصص: `usage_daily` — `1000/يوم` افتراضياً — تُفحص في `POST /v1/chat/completions` للمستخدم المسجل
