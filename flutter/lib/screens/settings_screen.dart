import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/local_store.dart';
import '../services/gateway_client.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _urlCtrl = TextEditingController(text: 'http://localhost:3000');
  Map<String, dynamic>? _stats;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final gw = GatewayClient(baseUrl: _urlCtrl.text);
      final s = await gw.stats();
      if (mounted) setState(() => _stats = s);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LocalStore>();
    final categories = ['code', 'creative', 'analysis', 'retrieval', 'general'];
    final models = ['strong-code', 'claude', 'accurate-math', 'fast-cheap', 'gemini', 'kimi'];
    return Scaffold(
      appBar: AppBar(title: const Text('الإعدادات — التوجيه')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('تثبيت نموذج لفئة (تجاوز كامل للتوجيه الذكي)', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        const Text('عند التثبيت، سيُستخدم هذا النموذج دائمًا لتلك الفئة بدون المرور بالمصنف.', style: TextStyle(color: Colors.grey)),
        const SizedBox(height: 16),
        for (final cat in categories)
          Card(
            child: ListTile(
              title: Text(cat),
              subtitle: Text(store.pinnedModels[cat] != null ? 'مثبت: ${store.pinnedModels[cat]}' : 'تلقائي (ذكي)'),
              trailing: DropdownButton<String>(
                value: store.pinnedModels[cat],
                hint: const Text('تلقائي'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('تلقائي')),
                  for (final m in models) DropdownMenuItem(value: m, child: Text(m)),
                ],
                onChanged: (v) => context.read<LocalStore>().pinModel(cat, v),
              ),
            ),
          ),
        const Divider(height: 32),
        Text('Gateway', style: Theme.of(context).textTheme.titleMedium),
        TextField(controller: _urlCtrl, decoration: const InputDecoration(labelText: 'Base URL', hintText: 'http://localhost:3000'), onSubmitted: (_) => _loadStats()),
        const SizedBox(height: 8),
        FilledButton.tonal(onPressed: _loadStats, child: const Text('تحديث الإحصائيات')),
        if (_stats != null) ...[
          const SizedBox(height: 12),
          Text('الملخص من Postgres:', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
            child: Text(_stats.toString(), style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
          ),
        ],
        const Divider(height: 32),
        Text('السجل المحلي', style: Theme.of(context).textTheme.titleMedium),
        Text('العينات: ${store.summary()['counts'].toString().substring(0, 200)}...'),
        const SizedBox(height: 8),
        Text('طابور offline: ${store.queue.length} رسالة'),
        if (store.queue.isNotEmpty)
          ...store.queue.map((e) => ListTile(title: Text(e['text'] as String), subtitle: Text('${e['meta']} — محاولات: ${e['attempts']}'))),
        const SizedBox(height: 16),
        Text('الخصوصية', style: Theme.of(context).textTheme.titleMedium),
        const Text('التصنيف والكاش والسجل يبقون على الجهاز. يُرسل نص الطلب فقط عبر Gateway. المفاتيح تبقى في backend.'),
      ]),
    );
  }
}
