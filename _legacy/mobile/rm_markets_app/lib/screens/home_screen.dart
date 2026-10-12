import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:rm_markets_app/services/auth_service.dart';

class HomeScreen extends StatefulWidget {
  @override
  _HomeScreenState createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void initState() {
    super.initState();
    Provider.of<AuthService>(context, listen: false).loadToken();
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);

    return Scaffold(
      appBar: AppBar(title: Text('RM Markets')),
      body: auth.isAuthenticated ? _buildLoggedIn(auth) : _buildLoginForm(auth),
    );
  }

  Widget _buildLoginForm(AuthService auth) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        children: [
          TextField(controller: _usernameController, decoration: InputDecoration(labelText: 'Username')),
          TextField(controller: _passwordController, decoration: InputDecoration(labelText: 'Password'), obscureText: true),
          SizedBox(height: 16),
          ElevatedButton(
              onPressed: () async {
                final success = await auth.login(_usernameController.text, _passwordController.text);
                if (!success) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Login failed')));
                }
              },
              child: Text('Login')),
          TextButton(
            onPressed: () async {
              try {
                final success = await auth.register(_usernameController.text, _passwordController.text);
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(success ? 'Registration successful' : 'Registration failed')));
              } catch (e) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
              }
            },
            child: Text('Register'),
          ),
        ],
      ),
    );
  }

  Widget _buildLoggedIn(AuthService auth) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text('Authenticated as: ${auth.token?.substring(0, 10) ?? "token"}...'),
        SizedBox(height: 16),
        ElevatedButton(
          onPressed: () async {
            await auth.logout();
          },
          child: Text('Logout'),
        )
      ],
    );
  }
}
