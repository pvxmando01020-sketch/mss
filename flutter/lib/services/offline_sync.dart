import 'dart:async';
import 'local_store.dart';
import 'gateway_client.dart';

/// OfflineSync — يعيد إرسال الطابور تلقائياً عند عودة الشبكة
class OfflineSync {
  final LocalStore store;
  final GatewayClient gw;
  Timer? _timer;
  bool _running = false;

  OfflineSync({required this.store, required this.gw});

  void start({Duration interval = const Duration(seconds: 15)}) {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) => _flush());
  }

  void stop() { _timer?.cancel(); _timer = null; }

  Future<void> _flush() async {
    if (_running || store.queue.isEmpty) return;
    _running = true;
    try {
      // تحقق من الاتصال أولاً
      if (!await gw.health()) return;
      while (store.queue.isNotEmpty) {
        final item = store.queue.first;
        try {
          await gw.chat(item['text'] as String);
          await store.dequeue();
        } catch (_) {
          await store.markFailed(item['id'] as String);
          break; // توقف عند أول فشل — حاول لاحقاً
        }
      }
    } finally {
      _running = false;
    }
  }

  Future<void> flushNow() => _flush();
}
