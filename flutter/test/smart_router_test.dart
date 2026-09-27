import 'package:flutter_test/flutter_test.dart';
import 'package:smart_routing_engine/smart_router.dart';

void main() {
  test('تصنيف عربي — كود', () {
    final r = classify('def hello():\n  print(\"hi\")');
    expect(r.category, 'code');
  });

  test('تصنيف — إبداعي', () {
    final r = classify('اكتب لي قصة قصيرة عن صحراء مصر');
    expect(r.category, 'creative');
  });

  test('استخراج ميزات — لغة عربية', () {
    final f = extractFeatures('لخص لي مقال عن الذكاء الاصطناعي');
    expect(f.language == 'ar' || f.language == 'mixed', true);
    expect(f.intent, 'summarize');
  });

  test('ScoreStore يحدّث ويحسب ثقة', () {
    final s = ScoreStore();
    expect(s.confidence('code', 'strong-code'), 0); // لا عينات → ثقة صفر
    s.update('code', 'strong-code', 1.0);
    expect(s.get('code', 'strong-code') > 0.5, true);
    expect(s.confidence('code', 'strong-code') > 0, true);
  });

  test('route يختار النموذج الافتراضي', () {
    final s = ScoreStore();
    final r = route('اكتب لي قصة عن النيل', s);
    expect(r['category'], 'creative');
    expect(r['model'], 'claude');
  });
}
