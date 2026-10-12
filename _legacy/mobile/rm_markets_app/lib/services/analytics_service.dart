import 'dart:convert';

import 'package:http/http.dart' as http;

class AnalyticsService {
  static const baseUrl = 'http://10.0.2.2:8084/api/analytics';

  Future<Map<String, dynamic>> indicator(String symbol, String type, String prices) async {
    final response = await http.get(Uri.parse('$baseUrl/indicator?symbol=$symbol&type=$type&prices=$prices'));
    return jsonDecode(response.body);
  }

  Future<Map<String, dynamic>> performance(String portfolioId) async {
    final response = await http.get(Uri.parse('$baseUrl/performance?portfolioId=$portfolioId'));
    return jsonDecode(response.body);
  }
}
