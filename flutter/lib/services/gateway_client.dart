import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// GatewayClient — يرسل فقط نص الطلب، المفاتيح تبقى في backend
class GatewayClient {
  final String baseUrl; // مثال: https://3000-xxxx.e2b.app  أو http://localhost:3000
  final Duration timeout;
  GatewayClient({required this.baseUrl, this.timeout = const Duration(seconds: 20)});

  Uri _u(String path) => Uri.parse('$baseUrl$path');

  /// POST /v1/route — قرار التوجيه من الخادم (fallback لو غير متأكد محليًا)
  Future<Map<String, dynamic>> route(String text, {String? overrideModel, String? overrideCategory}) async {
    final res = await http.post(_u('/v1/route'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'text': text, if (overrideModel != null) 'overrideModel': overrideModel, if (overrideCategory != null) 'overrideCategory': overrideCategory})).timeout(timeout);
    if (res.statusCode != 200) throw Exception('route failed ${res.statusCode}: ${res.body}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// POST /v1/chat/completions — توجيه + استدعاء نموذج
  Future<Map<String, dynamic>> chat(String text) async {
    final res = await http.post(_u('/v1/chat/completions'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'text': text})).timeout(timeout);
    if (res.statusCode != 200) throw Exception('chat failed ${res.statusCode}: ${res.body}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// POST /v1/feedback أو /v1/feedback/auto
  Future<void> feedback(Map<String, dynamic> payload, {bool auto = true}) async {
    final path = auto ? '/v1/feedback/auto' : '/v1/feedback';
    await http.post(_u(path), headers: {'Content-Type': 'application/json'}, body: jsonEncode(payload)).timeout(timeout);
  }

  Future<Map<String, dynamic>> stats() async {
    final res = await http.get(_u('/v1/routing/stats')).timeout(timeout);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<bool> health() async {
    try {
      final res = await http.get(_u('/health')).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) { return false; }
  }
}
