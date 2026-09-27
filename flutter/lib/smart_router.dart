// smart_router.dart — النسخة المحلية لمحرك التوجيه داخل تطبيق Flutter
//
// نفس منطق src/router.js لكن بـ Dart ليعمل offline بالكامل.
// لا يستدعي أي API أثناء التصنيف/الـ heuristics/الكاش.

import 'dart:convert';
import 'dart:math' as math;

/// الفئات الخمس — مطابقة للخطة والـ backend
const categories = ['code', 'creative', 'analysis', 'retrieval', 'general'];

const defaultModels = {
  'code': 'strong-code',
  'creative': 'claude',
  'analysis': 'accurate-math',
  'retrieval': 'fast-cheap',
  'general': 'fast-cheap',
};

// قاموس تقني مصغر — نفس TECH_DICT في features.js
const _techDict = {
  'api','backend','frontend','database','sql','json','javascript','typescript',
  'python','dart','flutter','fastify','postgres','redis','algorithm','function',
  'تحليل','برمجة','قاعدة','بيانات','كود','خوارزمية',
};

// أوزان الشجرة — نسخة مطابقة لـ TREE_WEIGHTS في classifier.js
const _treeWeights = {
  'code':     [2.8, 1.9, 1.2, 0.3, -0.2, 1.5, -0.8, -0.4, -1.0],
  'creative': [-1.2, -0.6, -0.3, 0.4, 0.6, -0.9, 2.2, -0.5, -0.7],
  'analysis': [-0.4, -0.2, 1.6, 0.7, 0.1, -0.6, -0.7, 2.4, -0.6],
  'retrieval':[-0.8, -0.5, -0.2, -0.9, 0.2, -0.7, -0.6, -0.5, 2.0],
  'general':  [0, 0, 0, 0, 0, 0, 0, 0, 0],
};

class Features {
  final String text;
  final int charCount;
  final int wordCount;
  final double arabicRatio;
  final String language;
  final bool hasCode;
  final double codeScore;
  final double technicalDensity;
  final String? intent;
  Features({
    required this.text, required this.charCount, required this.wordCount,
    required this.arabicRatio, required this.language, required this.hasCode,
    required this.codeScore, required this.technicalDensity, this.intent,
  });
}

Features extractFeatures(String input) {
  final text = input.trim();
  final charCount = text.length;
  if (charCount == 0) {
    return Features(text: text, charCount: 0, wordCount: 0, arabicRatio: 0,
      language: 'unknown', hasCode: false, codeScore: 0, technicalDensity: 0);
  }
  final words = RegExp(r'[\p{L}\p{N}_]+', unicode: true).allMatches(text).map((m) => m.group(0)!).toList();
  final arabicChars = RegExp(r'[\u0600-\u06FF]').allMatches(text).length;
  final arabicRatio = charCount > 0 ? arabicChars / charCount : 0.0;
  String language;
  if (arabicRatio > 0.35) language = 'ar';
  else if (arabicRatio > 0.08) language = 'mixed';
  else language = 'en';

  final hasCode = RegExp(r"```|\b(function|def|class|const|let|SELECT|import|async|await)\b|[{}()[\];]{2,}", caseSensitive: false).hasMatch(text);
  final codeLines = text.split('\n').where((l) => RegExp(r'[{}();=]|```').hasMatch(l)).length;
  final codeScore = math.min(1.0, (hasCode ? 0.6 : 0.0) + codeLines * 0.15);

  int tech = 0;
  for (final w in words) if (_techDict.contains(w.toLowerCase())) tech++;
  final technicalDensity = words.isEmpty ? 0.0 : tech / words.length;

  String? intent;
  final intentPatterns = {
    'write': RegExp(r'\b(اكتب|أنشئ|صمم|write|create|design)\b', caseSensitive: false),
    'review': RegExp(r'\b(راجع|review)\b', caseSensitive: false),
    'analyze': RegExp(r'\b(حلل|تحليل|analy[sz]e)\b', caseSensitive: false),
    'summarize': RegExp(r'\b(لخص|summariz)\b', caseSensitive: false),
    'code': RegExp(r'\b(برمج|debug|implement)\b', caseSensitive: false),
    'retrieve': RegExp(r'\b(ما هو|what is|define)\b', caseSensitive: false),
  };
  for (final e in intentPatterns.entries) {
    if (e.value.hasMatch(text)) { intent = e.key; break; }
  }

  return Features(
    text: text, charCount: charCount, wordCount: words.length,
    arabicRatio: arabicRatio, language: language, hasCode: hasCode,
    codeScore: codeScore, technicalDensity: technicalDensity, intent: intent,
  );
}

List<double> _vectorize(Features f) {
  final wordCountNorm = math.min(1.0, f.wordCount / 120.0);
  return [
    f.hasCode ? 1 : 0,
    f.codeScore,
    math.min(1.0, f.technicalDensity * 4),
    wordCountNorm,
    f.arabicRatio,
    f.intent == 'code' ? 1 : 0,
    f.intent == 'write' ? 1 : 0,
    f.intent == 'analyze' ? 1 : 0,
    (f.intent == 'retrieve' || f.intent == 'summarize') ? 1 : 0,
  ];
}

double _dot(List<double> a, List<double> b) {
  double s = 0; for (int i=0;i<a.length;i++) s+=a[i]*b[i]; return s;
}

class ClassifyResult {
  final String category;
  final double confidence;
  final Map<String,double> probs;
  final String method;
  ClassifyResult(this.category, this.confidence, this.probs, this.method);
}

ClassifyResult classify(String input) {
  final f = extractFeatures(input);
  if (f.wordCount == 0) return ClassifyResult('general', 0.4, {'general':1}, 'empty');

  // rules fallback
  ClassifyResult rulesResult() {
    final t = f.text;
    if (f.hasCode || f.codeScore > 0.55) return ClassifyResult('code', 0.92, {'code':0.92}, 'rules');
    if (RegExp(r'برمج|كود|code|debug', caseSensitive: false).hasMatch(t)) return ClassifyResult('code', 0.82, {'code':0.82}, 'rules');
    if (f.wordCount < 48 && RegExp(r'لخص|ما هو|what is', caseSensitive: false).hasMatch(t)) return ClassifyResult('retrieval', 0.78, {'retrieval':0.78}, 'rules');
    if (RegExp(r'تحليل|إحصاء|statistics', caseSensitive: false).hasMatch(t) || f.technicalDensity > 0.18) return ClassifyResult('analysis', 0.74, {'analysis':0.74}, 'rules');
    if (RegExp(r'قصة|شعر|creative|rewrite', caseSensitive: false).hasMatch(t) || f.intent=='write') return ClassifyResult('creative', 0.71, {'creative':0.71}, 'rules');
    return ClassifyResult('general', 0.55, {'general':0.55}, 'rules');
  }

  final vec = _vectorize(f);
  final logits = categories.map((c) => _dot(vec, _treeWeights[c]!)).toList();
  final m = logits.reduce(math.max);
  final exps = logits.map((v) => math.exp(v - m)).toList();
  final sum = exps.reduce((a,b)=>a+b);
  final probsArr = exps.map((e)=>e/sum).toList();
  final probs = { for (int i=0;i<categories.length;i++) categories[i]: double.parse(probsArr[i].toStringAsFixed(4)) };
  int bestIdx=0; for(int i=1;i<probsArr.length;i++) if(probsArr[i]>probsArr[bestIdx]) bestIdx=i;
  final bestCat = categories[bestIdx];
  final bestProb = probsArr[bestIdx];
  if (bestProb < 0.38) {
    final r = rulesResult();
    if (r.category==bestCat) return ClassifyResult(bestCat, (bestProb+r.confidence)/2, probs, 'tree');
    if (f.hasCode && r.category=='code') return r;
    return ClassifyResult(bestCat, double.parse(bestProb.toStringAsFixed(3)), probs, 'tree');
  }
  return ClassifyResult(bestCat, double.parse(bestProb.toStringAsFixed(3)), probs, 'tree');
}

String complexityFor(Features f, String category) {
  final wc = f.wordCount;
  if (wc > 180 || (category=='code' && (wc>80 || f.hasCode)) || (category=='analysis' && wc>90)) return 'complex';
  if (wc>35 || f.technicalDensity>0.12 || f.intent==null) return 'medium';
  return 'simple';
}

// ScoreStore محلي — يحفظ في SharedPreferences/SQLite (هنا في الذاكرة للتبسيط)
class ScoreStore {
  final double alpha;
  final double epsilon;
  final Map<String, Map<String,double>> scores = {};
  final Map<String, Map<String,int>> counts = {};
  final List<Map<String,dynamic>> log = [];

  ScoreStore({this.alpha=0.2, this.epsilon=0.1}) {
    for (final c in categories) {
      scores[c] = { for (final m in defaultModels.values) m: 0.5 };
      counts[c] = { for (final m in defaultModels.values) m: 0 };
    }
  }

  double get(String cat, String model) => scores[cat]?[model] ?? 0.5;
  int count(String cat, String model) => counts[cat]?[model] ?? 0;

  double update(String cat, String model, double quality, {int? latencyMs, bool regenerated=false, bool manualCorrection=false}) {
    scores.putIfAbsent(cat, ()=>{});
    counts.putIfAbsent(cat, ()=>{});
    scores[cat]!.putIfAbsent(model, ()=>0.5);
    counts[cat]!.putIfAbsent(model, ()=>0);
    final a = manualCorrection ? math.min(0.6, alpha*2.5) : alpha;
    final q = quality.clamp(0,1);
    scores[cat]![model] = (1-a)*scores[cat]![model]! + a*q;
    counts[cat]![model] = counts[cat]![model]! + 1;
    log.add({'category':cat,'model':model,'quality_score':q,'latency_ms':latencyMs,'regenerated':regenerated,'timestamp':DateTime.now().toIso8601String()});
    if (log.length>2000) log.removeRange(0, log.length-2000);
    return scores[cat]![model]!;
  }

  double confidence(String cat, String model) {
    final total = (counts[cat]?.values.fold<int>(0,(a,b)=>a+b)) ?? 0;
    final penalty = 1/(1+total);
    return double.parse((get(cat, model)*(1-penalty)).toStringAsFixed(3));
  }

  Map<String,dynamic> summary() => {
    'scores': scores, 'counts': counts,
    'totalEvents': log.length,
  };
}

// قرار التوجيه الكامل — يعمل offline
Map<String,dynamic> route(String input, ScoreStore store, {Map<String,List<String>>? modelsByCategory}) {
  final f = extractFeatures(input);
  final cls = classify(input);
  final lvl = complexityFor(f, cls.category);
  final models = modelsByCategory?[cls.category] ?? [defaultModels[cls.category]!];
  final ranked = models.map((m)=>{'model':m,'score':store.get(cls.category,m),'samples':store.count(cls.category,m)}).toList()
    ..sort((a,b)=>(b['score'] as double).compareTo(a['score'] as double));
  final best = ranked.first;
  final total = ranked.fold<int>(0,(n,x)=>n+(x['samples'] as int));
  final confidence = double.parse(((best['score'] as double)*(1-1/(1+total))).toStringAsFixed(3));
  return {
    'category': cls.category,
    'complexity': lvl,
    'model': best['model'],
    'confidence': confidence,
    'features': {'wordCount':f.wordCount,'language':f.language,'hasCode':f.hasCode},
    'candidates': ranked,
    'method': cls.method,
  };
}
