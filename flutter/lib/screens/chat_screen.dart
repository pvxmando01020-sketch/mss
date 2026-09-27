import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/local_store.dart';
import '../services/gateway_client.dart';
import '../widgets/routing_badge.dart';

class ChatMessage {
  final String text;
  final bool isUser;
  final Map<String, dynamic>? routing; // {category, model, confidence, complexity}
  final String? response;
  ChatMessage({required this.text, required this.isUser, this.routing, this.response});
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _controller = TextEditingController();
  final _messages = <ChatMessage>[];
  bool _sending = false;
  String _gatewayUrl = 'http://localhost:3000';
  late GatewayClient _gw;

  @override
  void initState() {
    super.initState();
    final store = context.read<LocalStore>();
    _gw = GatewayClient(baseUrl: _gatewayUrl, authToken: store.token);
    // تحديث التوكن عند تغيّر حالة المصادقة
    store.addListener(() {
      if (mounted) _gw.setAuthToken(store.token);
    });
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    final store = context.read<LocalStore>();
    // قرار محلي أولاً
    final local = store.decide(text);
    final category = local['category'] as String;

    setState(() {
      _messages.add(ChatMessage(text: text, isUser: true));
      _messages.add(ChatMessage(text: text, isUser: false, routing: local));
      _sending = true;
    });
    _controller.clear();

    try {
      // حاول عبر Gateway (مع fallback محلي لو فشل)
      final res = await _gw.chat(text).timeout(const Duration(seconds: 20));
      if (!mounted) return;
      setState(() {
        final last = _messages.last;
        _messages[_messages.length - 1] = ChatMessage(text: last.text, isUser: false, routing: res, response: res['response'] as String?);
      });
      // سجل latency كـ proxy
      final latency = res['latency_ms'] as int?;
      await store.recordFeedback(category, res['model'] as String? ?? local['model'] as String, 0.72, latencyMs: latency);
    } catch (e) {
      // فشل الشبكة → خزّن في طابور offline
      await store.enqueue(text, {'category': category, 'model': local['model']});
      if (!mounted) return;
      setState(() {
        final last = _messages.last;
        _messages[_messages.length - 1] = ChatMessage(text: last.text, isUser: false, routing: local, response: '⚠️ لا يوجد اتصال — تم حفظ الرسالة في الطابور وسيُعاد إرسالها تلقائيًا عند عودة الشبكة.');
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _manualSwitch(int index, String newModel) async {
    final msg = _messages[index];
    if (msg.routing == null) return;
    final store = context.read<LocalStore>();
    final cat = msg.routing!['category'] as String;
    final oldModel = msg.routing!['model'] as String;
    // سجل correction قوي
    await store.recordFeedback(cat, newModel, 1.0, manualCorrection: true);
    await store.recordFeedback(cat, oldModel, 0.2);
    setState(() {
      _messages[index] = ChatMessage(text: msg.text, isUser: false, routing: {...msg.routing!, 'model': newModel, 'manual': true}, response: msg.response);
    });
    // أعد الإرسال عبر Gateway بالنموذج المثبت
    try {
      final res = await _gw.chat(msg.text);
      setState(() => _messages[index] = ChatMessage(text: msg.text, isUser: false, routing: res, response: res['response'] as String?));
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LocalStore>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('MSS — التوجيه الذكي'),
        actions: [
          if (store.isLoggedIn) Chip(label: Text(store.user?['email']?.toString().split('@').first ?? ''), avatar: const Icon(Icons.person, size: 16))
          else TextButton(onPressed: () => Navigator.pushNamed(context, '/auth'), child: const Text('دخول')),
          if (store.queue.isNotEmpty)
            Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Chip(label: Text('طابور: ${store.queue.length}'), avatar: const Icon(Icons.cloud_off, size: 16))),
          IconButton(icon: const Icon(Icons.settings), onPressed: () => Navigator.pushNamed(context, '/settings')),
        ],
      ),
      body: Column(children: [
        if (!store.ready) const LinearProgressIndicator(),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: _messages.length,
            itemBuilder: (_, i) {
              final m = _messages[i];
              if (m.isUser) {
                return Align(alignment: Alignment.centerRight, child: Container(margin: const EdgeInsets.symmetric(vertical: 6), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Theme.of(context).colorScheme.primaryContainer, borderRadius: BorderRadius.circular(16)), child: Text(m.text)));
              }
              final r = m.routing;
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (r != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: RoutingBadge(
                      category: r['category'] as String? ?? 'general',
                      model: r['model'] as String? ?? 'fast-cheap',
                      confidence: (r['confidence'] as num?)?.toDouble() ?? 0,
                      method: r['method'] as String?,
                      pinned: r['pinned'] == true,
                      onSwitch: () => _showSwitchSheet(i, r['category'] as String),
                    ),
                  ),
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 6),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(16)),
                  child: Text(m.response ?? '— جارٍ التوجيه...', style: const TextStyle(height: 1.4)),
                ),
                if (r != null)
                  Row(children: [
                    IconButton(icon: const Icon(Icons.thumb_up, size: 18), onPressed: () => store.recordFeedback(r['category'] as String, r['model'] as String, 0.92, thumbsUp: true)),
                    IconButton(icon: const Icon(Icons.thumb_down, size: 18), onPressed: () => store.recordFeedback(r['category'] as String, r['model'] as String, 0.15, thumbsDown: true)),
                    IconButton(icon: const Icon(Icons.refresh, size: 18), onPressed: () {
                      store.recordFeedback(r['category'] as String, r['model'] as String, 0.25, regenerated: true);
                      _manualSwitch(i, r['model'] as String);
                    }),
                  ]),
              ]);
            },
          ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
            child: Row(children: [
              Expanded(child: TextField(controller: _controller, minLines: 1, maxLines: 4, decoration: InputDecoration(hintText: 'اكتب سؤالك… (سيُصنف محليًا أولاً)', border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)), contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10)), onSubmitted: (_) => _send())),
              const SizedBox(width: 8),
              FilledButton(onPressed: _sending ? null : _send, child: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send)),
            ]),
          ),
        ),
      ]),
    );
  }

  void _showSwitchSheet(int index, String category) {
    final models = ['claude', 'strong-code', 'accurate-math', 'fast-cheap', 'gemini', 'kimi'];
    showModalBottomSheet(context: context, builder: (_) => ListView(children: [
      ListTile(title: Text('اختر نموذجًا لفئة: $category'), subtitle: const Text('سيُسجل كـ correction قوي ويحدّث الأوزان')),
      for (final m in models) ListTile(title: Text(m), onTap: () { Navigator.pop(context); _manualSwitch(index, m); }),
    ]));
  }
}
