import 'package:flutter/material.dart';
import 'package:rm_markets_app/services/market_service.dart';

class MarketScreen extends StatefulWidget {
  @override
  _MarketScreenState createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  final _marketService = MarketService();
  Map<String, dynamic>? _ticker;
  Stream<Map<String, dynamic>>? _priceStream;

  @override
  void initState() {
    super.initState();
    _loadTicker();
    _priceStream = _marketService.priceStream();
  }

  Future<void> _loadTicker() async {
    final data = await _marketService.ticker('BTCUSD');
    setState(() {
      _ticker = data;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Market')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Latest ticker', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            if (_ticker != null)
              Text('${_ticker!['symbol']}: ${_ticker!['price']} at ${DateTime.fromMillisecondsSinceEpoch(_ticker!['timestamp'])}'),
            SizedBox(height: 16),
            Text('Price stream', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            Expanded(
              child: StreamBuilder<Map<String, dynamic>>(
                stream: _priceStream,
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return Text('Error: ${snapshot.error}');
                  }
                  if (!snapshot.hasData) {
                    return CircularProgressIndicator();
                  }
                  return ListTile(
                    title: Text('${snapshot.data!['symbol']} ${snapshot.data!['price']}'),
                    subtitle: Text('${DateTime.fromMillisecondsSinceEpoch(snapshot.data!['timestamp'])}'),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
