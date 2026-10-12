import 'package:flutter/material.dart';
import 'package:rm_markets_app/services/trading_service.dart';

class TradingScreen extends StatefulWidget {
  @override
  _TradingScreenState createState() => _TradingScreenState();
}

class _TradingScreenState extends State<TradingScreen> {
  final _service = TradingService();
  final _symbolCtrl = TextEditingController(text: 'AAPL');
  final _qtyCtrl = TextEditingController(text: '1');
  final _priceCtrl = TextEditingController(text: '150');
  String _side = 'BUY';
  Map<String, dynamic>? _portfolio;
  List<dynamic> _orders = [];

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    _portfolio = await _service.getPortfolio();
    _orders = await _service.getOrders();
    setState(() {});
  }

  Future<void> _placeOrder() async {
    try {
      await _service.placeOrder(_symbolCtrl.text, _side, double.parse(_qtyCtrl.text), double.parse(_priceCtrl.text));
      await _refresh();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Order error: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Trading')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(children: [
          Row(children: [
            DropdownButton<String>(value: _side, onChanged: (v) => setState(() => _side = v ?? 'BUY'), items: ['BUY', 'SELL'].map((s) => DropdownMenuItem(value: s, child: Text(s))).toList()),
            SizedBox(width: 8),
            Expanded(child: TextField(controller: _symbolCtrl, decoration: InputDecoration(labelText: 'Symbol'))),
            SizedBox(width: 8),
            Expanded(child: TextField(controller: _qtyCtrl, decoration: InputDecoration(labelText: 'Qty'), keyboardType: TextInputType.number)),
            SizedBox(width: 8),
            Expanded(child: TextField(controller: _priceCtrl, decoration: InputDecoration(labelText: 'Price'), keyboardType: TextInputType.number)),
          ]),
          SizedBox(height: 8),
          ElevatedButton(onPressed: _placeOrder, child: Text('Place Order')),
          SizedBox(height: 16),
          _portfolio == null ? CircularProgressIndicator() : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Cash: ${_portfolio!['cashBalance']}'),
            Text('Equity: ${_portfolio!['equity']}'),
          ]),
          SizedBox(height: 16),
          Expanded(child: ListView.builder(itemCount: _orders.length, itemBuilder: (context, index) {
            final order = _orders[index] as Map<String, dynamic>;
            return ListTile(title: Text('${order['symbol']} ${order['side']} ${order['qty']} @ ${order['price']}'));
          })),
        ]),
      ),
    );
  }
}
