import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../smart_router.dart' as router;

/// LocalStore — يغلف ScoreStore + إعدادات المستخدم + OfflineQueue
/// يبقى على الجهاز بالكامل (لا يُرسل القطيع/المفاتيح).
class LocalStore extends ChangeNotifier {
  late router.ScoreStore scoreStore;
  Map<String, String> pinnedModels = {}; // { category: model } — تجاوز كامل للتوجيه
  final List<Map<String, dynamic>> _offlineQueue = [];
  static const _kStoreKey = 'routing_store_v1';
  static const _kPinnedKey = 'pinned_models_v1';
  static const _kQueueKey = 'offline_queue_v1';
  static const _kTokenKey = 'auth_token_v1';
  static const _kUserKey = 'auth_user_v1';

  String? _token;
  Map<String, dynamic>? _user;
  String? get token => _token;
  Map<String, dynamic>? get user => _user;
  bool get isLoggedIn => _token != null && _user != null;

  bool _ready = false;
  bool get ready => _ready;

  Future<void> init() async {
    scoreStore = router.ScoreStore();
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kStoreKey);
      if (raw != null) {
        final data = jsonDecode(raw) as Map<String, dynamic>;
        // استرجاع الأوزان
        if (data['scores'] != null) {
          for (final cat in (data['scores'] as Map).keys) {
            for (final m in (data['scores'][cat] as Map).keys) {
              final v = (data['scores'][cat][m] as num).toDouble();
              scoreStore.scores[cat]?[m] = v;
            }
          }
        }
        if (data['counts'] != null) {
          for (final cat in (data['counts'] as Map).keys) {
            for (final m in (data['counts'][cat] as Map).keys) {
              scoreStore.counts[cat]?[m] = (data['counts'][cat][m] as num).toInt();
            }
          }
        }
      }
      final pinned = prefs.getString(_kPinnedKey);
      if (pinned != null) pinnedModels = Map<String, String>.from(jsonDecode(pinned));
      final q = prefs.getString(_kQueueKey);
      if (q != null) _offlineQueue.addAll(List<Map<String, dynamic>>.from(jsonDecode(q)));
      _token = prefs.getString(_kTokenKey);
      final u = prefs.getString(_kUserKey);
      if (u != null) _user = Map<String,dynamic>.from(jsonDecode(u));
    } catch (_) {}
    _ready = true;
    notifyListeners();
  }

  Future<void> setAuth(String token, Map<String,dynamic> user) async {
    _token = token; _user = user;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kTokenKey, token);
      await prefs.setString(_kUserKey, jsonEncode(user));
    } catch (_) {}
    notifyListeners();
  }

  Future<void> logout() async {
    _token = null; _user = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kTokenKey);
      await prefs.remove(_kUserKey);
    } catch (_) {}
    notifyListeners();
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kStoreKey, jsonEncode(scoreStore.summary()));
      await prefs.setString(_kPinnedKey, jsonEncode(pinnedModels));
      await prefs.setString(_kQueueKey, jsonEncode(_offlineQueue));
    } catch (_) {}
  }

  // قرار التوجيه — محلي أولاً، مع احترام التثبيت اليدوي
  Map<String, dynamic> decide(String text) {
    final r = router.route(text, scoreStore);
    final pinned = pinnedModels[r['category'] as String];
    if (pinned != null) {
      r['model'] = pinned;
      r['pinned'] = true;
    }
    return r;
  }

  Future<void> recordFeedback(String category, String model, double quality,
      {int? latencyMs, bool regenerated = false, bool manualCorrection = false, bool codeError = false, bool vibeError = false, String? errorSeverity}) async {
    double q = quality;
    double? alphaOv;
    if (codeError || vibeError) {
      const sevMap = {'low': 0.35, 'medium': 0.18, 'high': 0.08, 'critical': 0.02};
      const vibeMap = {'low': 0.4, 'medium': 0.18, 'high': 0.1, 'critical': 0.05};
      final m = vibeError ? vibeMap : sevMap;
      q = m[errorSeverity ?? 'medium'] ?? 0.12;
      alphaOv = vibeError ? 0.35 : 0.4;
    }
    scoreStore.update(category, model, q,
        latencyMs: latencyMs, regenerated: regenerated, manualCorrection: manualCorrection, alphaOverride: alphaOv);
    await _persist();
    notifyListeners();
  }

  // مخصص لأخطاء الكود — يعكس alpha القوي للـ backend
  Future<void> recordCodeError(String category, String model, {String severity='medium', bool isVibe=false}) async {
    await recordFeedback(category, model, 0.12, codeError: !isVibe, vibeError: isVibe, errorSeverity: severity);
  }
  Future<void> recordCodeSuccess(String category, String model) async {
    scoreStore.update(category, model, 0.92, latencyMs: null, alphaOverride: 0.15);
    await _persist();
    notifyListeners();
  }

  Future<void> pinModel(String category, String? model) async {
    if (model == null) {
      pinnedModels.remove(category);
    } else {
      pinnedModels[category] = model;
    }
    await _persist();
    notifyListeners();
  }

  // طابور offline
  List<Map<String, dynamic>> get queue => List.unmodifiable(_offlineQueue);

  Future<void> enqueue(String text, Map<String, dynamic> meta) async {
    _offlineQueue.add({'id': DateTime.now().millisecondsSinceEpoch.toString(), 'text': text, 'meta': meta, 'attempts': 0, 'createdAt': DateTime.now().toIso8601String()});
    if (_offlineQueue.length > 100) _offlineQueue.removeAt(0);
    await _persist();
    notifyListeners();
  }

  Future<Map<String, dynamic>?> dequeue() async {
    if (_offlineQueue.isEmpty) return null;
    final item = _offlineQueue.removeAt(0);
    await _persist();
    notifyListeners();
    return item;
  }

  Future<void> markFailed(String id) async {
    final idx = _offlineQueue.indexWhere((e) => e['id'] == id);
    if (idx == -1) return;
    _offlineQueue[idx]['attempts'] = (_offlineQueue[idx]['attempts'] as int) + 1;
    if (_offlineQueue[idx]['attempts'] >= 5) _offlineQueue.removeAt(idx);
    await _persist();
    notifyListeners();
  }

  Map<String, dynamic> summary() => scoreStore.summary();
}
