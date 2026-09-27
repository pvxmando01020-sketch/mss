import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/local_store.dart';
import '../services/gateway_client.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController(text: 'demo@example.com');
  final _pass = TextEditingController(text: 'secret123');
  bool _isLogin = true;
  bool _loading = false;
  String? _msg;
  String _baseUrl = 'http://localhost:3000';

  Future<void> _submit() async {
    setState(() { _loading = true; _msg = null; });
    try {
      final store = context.read<LocalStore>();
      final gw = GatewayClient(baseUrl: _baseUrl);
      gw.setAuthToken(store.token);
      if (_isLogin) {
        final r = await gw.login(_email.text.trim(), _pass.text);
        await store.setAuth(r['token'] as String, r['user'] as Map<String,dynamic>);
        _msg = 'تم تسجيل الدخول — أهلاً ${r['user']['email']}';
      } else {
        final r = await gw.register(_email.text.trim(), _pass.text);
        _msg = 'تم إنشاء الحساب: ${r['user']['email']} — سجل دخول الآن';
        setState(() => _isLogin = true);
      }
      if (mounted && _msg != null && _isLogin) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_msg!)));
        await Future.delayed(const Duration(milliseconds: 400));
        if (mounted) Navigator.pop(context);
      }
    } catch (e) {
      setState(() => _msg = 'خطأ: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<LocalStore>();
    return Scaffold(
      appBar: AppBar(title: Text(_isLogin ? 'تسجيل الدخول' : 'إنشاء حساب')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        if (store.isLoggedIn) ...[
          Card(child: ListTile(leading: const Icon(Icons.verified_user), title: Text(store.user?['email'] ?? ''), subtitle: Text('دور: ${store.user?['role'] ?? ''}'), trailing: TextButton(onPressed: () async { await store.logout(); setState(() => _msg = 'تم تسجيل الخروج'); }, child: const Text('خروج')))),
          const Divider(),
        ],
        TextField(controller: TextEditingController(text: _baseUrl), decoration: const InputDecoration(labelText: 'Gateway Base URL'), onChanged: (v) => _baseUrl = v),
        const SizedBox(height: 12),
        TextField(controller: _email, decoration: const InputDecoration(labelText: 'البريد الإلكتروني', prefixIcon: Icon(Icons.email)), keyboardType: TextInputType.emailAddress),
        const SizedBox(height: 12),
        TextField(controller: _pass, decoration: const InputDecoration(labelText: 'كلمة المرور', prefixIcon: Icon(Icons.lock)), obscureText: true, onSubmitted: (_) => _submit()),
        const SizedBox(height: 16),
        FilledButton(onPressed: _loading ? null : _submit, child: _loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(_isLogin ? 'دخول' : 'تسجيل')),
        TextButton(onPressed: () => setState(() => _isLogin = !_isLogin), child: Text(_isLogin ? 'ليس لديك حساب؟ أنشئ واحداً' : 'لديك حساب؟ سجل دخول')),
        if (_msg != null) ...[const SizedBox(height: 12), Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)), child: Text(_msg!, style: const TextStyle(height: 1.4)))],
        const SizedBox(height: 24),
        const Text('البيانات لا تُرسل إلا للـ Gateway. المفاتيح تبقى في backend.', style: TextStyle(color: Colors.grey, fontSize: 12)),
      ]),
    );
  }
}
