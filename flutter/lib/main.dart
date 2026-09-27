import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/local_store.dart';
import 'services/gateway_client.dart';
import 'services/offline_sync.dart';
import 'screens/auth_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = LocalStore();
  await store.init();
  runApp(MyApp(store: store));
}

class MyApp extends StatelessWidget {
  final LocalStore store;
  const MyApp({super.key, required this.store});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: store,
      child: MaterialApp(
        title: 'MSS Smart Router',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF1E3A8A), brightness: Brightness.light),
        darkTheme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF1E3A8A), brightness: Brightness.dark),
        routes: {
          '/': (_) => const ChatScreen(),
          '/auth': (_) => const AuthScreen(),
          '/settings': (_) => const SettingsScreen(),
        },
      ),
    );
  }
}
