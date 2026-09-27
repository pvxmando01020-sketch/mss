# Flutter — Smart Routing Engine

نسخة Dart من محرك التوجيه الذكي — تعمل محليًا بالكامل (offline).

## الاستخدام

```dart
import 'lib/smart_router.dart';

final store = ScoreStore();

// قرار محلي أولاً
final r = route('اكتب لي دالة تحسب فيبوناتشي', store);
print(r['category']); // code
print(r['model']);    // strong-code

// بعد الرد — تحديث الأداء
store.update('code', 'strong-code', 0.9, latencyMs: 1200);

// التبديل اليدوي من المستخدم = correction قوي
store.update('code', 'fast-cheap', 1.0, manualCorrection: true);

// ملخص للمزامنة مع Postgres عبر Gateway
final summary = store.summary();
```

## التخزين المحلي

في التطبيق الحقيقي احفظ `store` في `SharedPreferences` أو `SQLite`:

```dart
// حفظ
prefs.setString('routing_store', jsonEncode(store.summary()));
// استرجاع
final restored = ScoreStore()..mergeSummary(jsonDecode(prefs.getString('routing_store')!));
```

## التكامل مع Gateway

```dart
final res = await http.post(Uri.parse('$gatewayUrl/v1/route'),
  headers: {'Content-Type':'application/json'},
  body: jsonEncode({'text': userInput}));

// res = {category, model, confidence, complexity, cached, key}
```

عند فشل الشبكة: خزّن في `OfflineQueue` (طبّق نفس منطق `src/cache.js` بـ Dart) وأعد الإرسال عند عودة الاتصال.
