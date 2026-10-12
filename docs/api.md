# RM Markets API reference

Interactive docs (Swagger UI) are served by the backend at **`/docs`**, ReDoc at **`/redoc`**, GraphiQL at **`/graphql`**.

Authentication: `Authorization: Bearer <access_token>` (JWT, 30 min). Refresh with `POST /api/auth/refresh`.
Most trading endpoints accept `?account_id=` to act on a competition account instead of the main account.

## WebSocket `/ws`

```jsonc
// client -> server
{"op": "auth", "token": "<access JWT>"}            // optional: enables private events
{"op": "subscribe", "symbols": ["BTCUSDT", "AAPL"]} // "*" = all instruments
{"op": "unsubscribe", "symbols": ["AAPL"]}
{"op": "ping", "t": 123}
// server -> client
{"type": "welcome", "heartbeat": 25}
{"type": "snapshot", "quotes": [...]}
{"type": "tick", "symbol": "BTCUSDT", "price": 67284.45, "bid": ..., "ask": ..., "change_pct": ..., "source": "binance"}
{"type": "order_filled" | "order_rejected" | "price_alert" | "margin_call" | "competition", "title": "...", "body": "..."}
{"type": "heartbeat"} {"type": "pong"} {"type": "error", "error": "rate_limited"}
```

## REST endpoints

| Method | Path |
|---|---|
| POST | `/api/analytics/backtest` |
| POST | `/api/analytics/backtest/optimize` |
| GET | `/api/analytics/backtest/runs` |
| GET | `/api/analytics/backtest/strategies` |
| POST | `/api/analytics/backtest/walk-forward` |
| GET | `/api/analytics/ml/models` |
| GET | `/api/analytics/ml/predict/{symbol}` |
| POST | `/api/analytics/ml/train` |
| GET | `/api/analytics/options/chain/{symbol}` |
| GET | `/api/analytics/options/expiries` |
| POST | `/api/analytics/options/orders` |
| POST | `/api/analytics/options/payoff` |
| POST | `/api/analytics/options/price` |
| GET | `/api/analytics/performance` |
| POST | `/api/analytics/screener` |
| GET | `/api/analytics/screener/fields` |
| GET | `/api/analytics/screener/presets` |
| POST | `/api/analytics/stress` |
| GET | `/api/analytics/stress/monte-carlo` |
| GET | `/api/analytics/stress/scenarios` |
| POST | `/api/auth/demo` |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/me` |
| PATCH | `/api/auth/me` |
| POST | `/api/auth/oauth/google` |
| POST | `/api/auth/password` |
| POST | `/api/auth/refresh` |
| POST | `/api/auth/register` |
| GET | `/api/calendar` |
| GET | `/api/competitions` |
| POST | `/api/competitions` |
| GET | `/api/competitions/{comp_id}` |
| POST | `/api/competitions/{comp_id}/join` |
| GET | `/api/competitions/{comp_id}/leaderboard` |
| GET | `/api/journal` |
| POST | `/api/journal` |
| GET | `/api/journal/analytics` |
| GET | `/api/journal/unjournaled` |
| DELETE | `/api/journal/{entry_id}` |
| PUT | `/api/journal/{entry_id}` |
| GET | `/api/market/history/{symbol}` |
| GET | `/api/market/indicators/{symbol}` |
| GET | `/api/market/instruments` |
| GET | `/api/market/movers` |
| GET | `/api/market/quote/{symbol}` |
| GET | `/api/market/quotes` |
| GET | `/api/market/search` |
| GET | `/api/market/signals/{symbol}` |
| GET | `/api/market/status` |
| GET | `/api/news` |
| GET | `/api/social/feed` |
| GET | `/api/social/leaderboard` |
| POST | `/api/social/posts` |
| DELETE | `/api/social/posts/{post_id}` |
| GET | `/api/social/posts/{post_id}/comments` |
| POST | `/api/social/posts/{post_id}/comments` |
| POST | `/api/social/posts/{post_id}/like` |
| GET | `/api/social/trending` |
| GET | `/api/social/users/{username}` |
| POST | `/api/social/users/{username}/follow` |
| GET | `/api/trading/account` |
| POST | `/api/trading/account/deposit` |
| POST | `/api/trading/account/reset` |
| POST | `/api/trading/account/withdraw` |
| GET | `/api/trading/accounts` |
| GET | `/api/trading/alerts` |
| POST | `/api/trading/alerts` |
| DELETE | `/api/trading/alerts/{alert_id}` |
| GET | `/api/trading/audit/replay` |
| GET | `/api/trading/history` |
| GET | `/api/trading/notifications` |
| POST | `/api/trading/notifications/read` |
| DELETE | `/api/trading/orders` |
| GET | `/api/trading/orders` |
| POST | `/api/trading/orders` |
| DELETE | `/api/trading/orders/{order_id}` |
| GET | `/api/trading/positions` |
| POST | `/api/trading/positions/close-all` |
| POST | `/api/trading/positions/{symbol}/close` |
| GET | `/api/trading/rules` |
| GET | `/api/trading/trades` |
| GET | `/api/trading/watchlist` |
| POST | `/api/trading/watchlist` |
| DELETE | `/api/trading/watchlist/{symbol}` |
| POST | `/api/voice/parse` |
| GET | `/graphql` |
| POST | `/graphql` |
| GET | `/health` |
