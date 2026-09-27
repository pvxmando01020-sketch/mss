import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// GatewayClient — يرسل فقط نص الطلب، المفاتيح تبقى في backend
class GatewayClient {
  final String baseUrl; // مثال: https://3000-xxxx.e2b.app  أو http://localhost:3000
  final Duration timeout;
  String? _authToken;
  GatewayClient({required this.baseUrl, this.timeout = const Duration(seconds: 20), String? authToken}) : _authToken = authToken;

  void setAuthToken(String? token) => _authToken = token;
  Map<String,String> get _headers => {
    'Content-Type': 'application/json',
    if (_authToken != null) 'Authorization': 'Bearer $_authToken',
  };

  Uri _u(String path) => Uri.parse('$baseUrl$path');

  // — Auth (المرحلة 2) —
  Future<Map<String,dynamic>> register(String email, String password) async {
    final res = await http.post(_u('/v1/auth/register'), headers: {'Content-Type':'application/json'}, body: jsonEncode({'email':email,'password':password})).timeout(timeout);
    if (res.statusCode != 201) throw Exception('register failed ${res.statusCode}: ${res.body}');
    return jsonDecode(res.body) as Map<String,dynamic>;
  }
  Future<Map<String,dynamic>> login(String email, String password) async {
    final res = await http.post(_u('/v1/auth/login'), headers: {'Content-Type':'application/json'}, body: jsonEncode({'email':email,'password':password})).timeout(timeout);
    if (res.statusCode != 200) throw Exception('login failed ${res.statusCode}: ${res.body}');
    final data = jsonDecode(res.body) as Map<String,dynamic>;
    _authToken = data['token'] as String?;
    return data;
  }

  /// POST /v1/route — قرار التوجيه من الخادم (fallback لو غير متأكد محليًا)
  Future<Map<String, dynamic>> route(String text, {String? overrideModel, String? overrideCategory}) async {
    final res = await http.post(_u('/v1/route'),
        headers: _headers,
        body: jsonEncode({'text': text, if (overrideModel != null) 'overrideModel': overrideModel, if (overrideCategory != null) 'overrideCategory': overrideCategory})).timeout(timeout);
    if (res.statusCode != 200) throw Exception('route failed ${res.statusCode}: ${res.body}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// POST /v1/chat/completions — توجيه + استدعاء نموذج (يدعم conversation_id)
  Future<Map<String, dynamic>> chat(String text, {String? conversationId, String? model}) async {
    final res = await http.post(_u('/v1/chat/completions'),
        headers: _headers,
        body: jsonEncode({'text': text, if (conversationId != null) 'conversation_id': conversationId, if (model != null) 'model': model})).timeout(timeout);
    if (res.statusCode != 200) throw Exception('chat failed ${res.statusCode}: ${res.body}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// POST /v1/feedback أو /v1/feedback/auto
  Future<void> feedback(Map<String, dynamic> payload, {bool auto = true}) async {
    final path = auto ? '/v1/feedback/auto' : '/v1/feedback';
    await http.post(_u(path), headers: _headers, body: jsonEncode(payload)).timeout(timeout);
  }

  Future<Map<String, dynamic>> stats() async {
    final res = await http.get(_u('/v1/routing/stats'), headers: _headers).timeout(timeout);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  // Conversations (المرحلة 2)
  Future<Map<String,dynamic>> createConversation(String title) async {
    final res = await http.post(_u('/v1/conversations'), headers: _headers, body: jsonEncode({'title':title})).timeout(timeout);
    if (res.statusCode != 201) throw Exception('create conv failed ${res.statusCode}');
    return jsonDecode(res.body) as Map<String,dynamic>;
  }

  Future<bool> health() async {
    try {
      final res = await http.get(_u('/health')).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) { return false; }
  }
}
