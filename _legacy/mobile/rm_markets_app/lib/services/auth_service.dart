import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class AuthService extends ChangeNotifier {
  static const _timeout = Duration(seconds: 8);

  static String get _host {
    if (kIsWeb) return 'localhost';
    // Android emulator uses 10.0.2.2 to reach host machine.
    if (Platform.isAndroid) return '10.0.2.2';
    // iOS simulator can reach host at localhost; real iPhone will need your LAN IP.
    return 'localhost';
  }

  static String get _baseUrl => 'http://$_host:8081/api/auth';
  final _storage = const FlutterSecureStorage();
  String? _token;

  String? get token => _token;
  bool get isAuthenticated => _token != null;

  Future<bool> login(String username, String password) async {
    final response = await http
        .post(
          Uri.parse('$_baseUrl/login'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'username': username, 'password': password}),
        )
        .timeout(_timeout);

    if (response.statusCode == 200) {
      final result = jsonDecode(response.body);
      _token = result['token'];
      await _storage.write(key: 'jwt', value: _token);
      notifyListeners();
      return true;
    }

    return false;
  }

  Future<bool> register(String username, String password) async {
    final response = await http
        .post(
          Uri.parse('$_baseUrl/register'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'username': username, 'password': password}),
        )
        .timeout(_timeout);

    if (response.statusCode == 200 || response.statusCode == 201) {
      return true;
    }

    final body = response.body.isEmpty ? 'Registration failed' : response.body;
    throw Exception(body);
  }

  Future<void> loadToken() async {
    _token = await _storage.read(key: 'jwt');
    notifyListeners();
  }

  Future<void> logout() async {
    _token = null;
    await _storage.delete(key: 'jwt');
    notifyListeners();
  }
}
