import 'dart:convert';

import 'package:http/http.dart' as http;

class TradingService {
  static const baseUrl = 'http://10.0.2.2:8083/api/trading';

  Future<Map<String, dynamic>> placeOrder(String symbol, String side, double qty, double price) async {
    final response = await http.post(Uri.parse('$baseUrl/order'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'symbol': symbol, 'side': side, 'qty': qty, 'price': price}));
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    }
    throw Exception('Order failed: ${response.body}');
  }

  Future<List<dynamic>> getOrders() async {
    final response = await http.get(Uri.parse('$baseUrl/orders'));
    return jsonDecode(response.body) as List<dynamic>;
  }

  Future<Map<String, dynamic>> getPortfolio() async {
    final response = await http.get(Uri.parse('$baseUrl/portfolio'));
    return jsonDecode(response.body);
  }
}
