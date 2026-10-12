import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

class MarketService {
  static const defaultHost = '10.0.2.2';
  static const baseUrl = 'http://$defaultHost:8082/api/market';
  static const wsUrl = 'ws://$defaultHost:8082/ws/market';

  Future<Map<String, dynamic>> ticker(String symbol) async {
    final res = await http.get(Uri.parse('$baseUrl/ticker?symbol=$symbol'));
    return jsonDecode(res.body);
  }

  Stream<Map<String, dynamic>> priceStream([String symbol = 'BTCUSD']) {
    final controller = StreamController<Map<String, dynamic>>();
    int retryDelaySeconds = 1;

    void connect() {
      final channel = WebSocketChannel.connect(Uri.parse(wsUrl));

      channel.stream.listen((event) {
        try {
          final data = jsonDecode(event as String) as Map<String, dynamic>;
          controller.add(data);
        } catch (e) {
          controller.addError('WS parse error: $e');
        }
      }, onError: (err) {
        controller.addError(err);
        channel.sink.close();
        Future.delayed(Duration(seconds: retryDelaySeconds), () {
          retryDelaySeconds = (retryDelaySeconds * 2).clamp(1, 30);
          connect();
        });
      }, onDone: () {
        if (!controller.isClosed) {
          Future.delayed(Duration(seconds: retryDelaySeconds), () {
            retryDelaySeconds = (retryDelaySeconds * 2).clamp(1, 30);
            connect();
          });
        }
      });
    }

    connect();

    controller.onCancel = () {
      controller.close();
    };

    return controller.stream;
  }

  Future<Stream<Map<String, dynamic>>> priceSseStream([String symbol = 'BTCUSD']) async {
    return Stream.empty();
  }
}
