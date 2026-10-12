import 'package:flutter/material.dart';
import 'package:rm_markets_app/services/analytics_service.dart';
import 'package:syncfusion_flutter_charts/charts.dart';

class AnalyticsScreen extends StatefulWidget {
  @override
  _AnalyticsScreenState createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  final _service = AnalyticsService();
  String _symbol = 'AAPL';
  String _indicator = 'RSI';
  String _prices = '100,101,102,103,104,103,102,101,100';
  Map<String, dynamic>? _result;
  List<_PricePoint> _points = [];

  Future<void> _run() async {
    _result = await _service.indicator(_symbol, _indicator, _prices);
    _points = _parsePrices(_prices);
    setState(() {});
  }

  List<_PricePoint> _parsePrices(String prices) {
    final parts = prices.split(',');
    final List<_PricePoint> data = [];
    for (var i = 0; i < parts.length; i++) {
      final v = double.tryParse(parts[i].trim());
      if (v != null) {
        data.add(_PricePoint(i, v));
      }
    }
    return data;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Analytics')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(children: [
          Row(children: [
            Expanded(child: TextField(decoration: InputDecoration(labelText: 'Symbol'), onChanged: (v) => _symbol = v)),
            SizedBox(width: 8),
            DropdownButton<String>(value: _indicator, onChanged: (v) => setState(() => _indicator = v ?? 'RSI'), items: ['RSI', 'MACD', 'BOLLINGER', 'SMA', 'EMA'].map((i) => DropdownMenuItem(value: i, child: Text(i))).toList()),
          ]),
          SizedBox(height: 8),
          TextField(controller: TextEditingController(text: _prices), decoration: InputDecoration(labelText: 'Prices (comma delimited)'), onChanged: (v) => _prices = v),
          SizedBox(height: 8),
          ElevatedButton(onPressed: _run, child: Text('Compute')),
          SizedBox(height: 12),
          Expanded(
            child: SfCartesianChart(
              title: ChartTitle(text: 'Price series for $_symbol'),
              primaryXAxis: NumericAxis(title: AxisTitle(text: 'Index')),
              primaryYAxis: NumericAxis(title: AxisTitle(text: 'Price')),
              series: <CartesianSeries<_PricePoint, int>>[
                LineSeries<_PricePoint, int>(
                  dataSource: _points,
                  xValueMapper: (p, _) => p.index,
                  yValueMapper: (p, _) => p.price,
                  name: 'Price',
                  markerSettings: MarkerSettings(isVisible: true),
                ),
              ],
            ),
          ),
          if (_result != null) ...[
            Text('Result', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            Text(_result.toString()),
          ]
        ]),
      ),
    );
  }
}

class _PricePoint {
  final int index;
  final double price;

  _PricePoint(this.index, this.price);
}
