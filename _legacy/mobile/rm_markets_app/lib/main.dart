import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:rm_markets_app/screens/analytics_screen.dart';
import 'package:rm_markets_app/screens/home_screen.dart';
import 'package:rm_markets_app/screens/market_screen.dart';
import 'package:rm_markets_app/screens/trading_screen.dart';
import 'package:rm_markets_app/services/auth_service.dart';

void main() {
  runApp(RMMApp());
}

class RMMApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthService()),
      ],
      child: MaterialApp(
        title: 'RM Markets',
        theme: ThemeData(primarySwatch: Colors.indigo),
        home: AppTabs(),
      ),
    );
  }
}

class AppTabs extends StatefulWidget {
  @override
  _AppTabsState createState() => _AppTabsState();
}

class _AppTabsState extends State<AppTabs> {
  int _selectedIndex = 0;
  static final List<Widget> _screens = <Widget>[
    HomeScreen(),
    MarketScreen(),
    TradingScreen(),
    AnalyticsScreen(),
  ];

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_selectedIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        onTap: _onItemTapped,
        items: const <BottomNavigationBarItem>[
          BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.show_chart), label: 'Market'),
          BottomNavigationBarItem(icon: Icon(Icons.swap_horiz), label: 'Trading'),
          BottomNavigationBarItem(icon: Icon(Icons.analytics), label: 'Analytics'),
        ],
      ),
    );
  }
}
