# RM Markets

A risk-free trading simulator with live market data. You get a $100,000 virtual balance to trade crypto, stocks, forex, commodities and indices. Interactive charts, technical indicators, analytics and strategy tools help you learn.

| Part | Stack | Folder |
|---|---|---|
| Backend | Python 3.12 · FastAPI · SQLAlchemy · PostgreSQL (SQLite in dev) · Redis · WebSockets · GraphQL (Strawberry) · NumPy | `backend/` |
| Web | React 18 · TypeScript · Vite · TradingView Lightweight Charts · Zustand | `web/` |
| Mobile | React Native · Expo SDK 57 · Expo Router · react-native-svg · iOS + Android home-screen widgets | `mobile/` |
| Infra | Docker · docker-compose with nginx load balancer · Kubernetes manifests + HPA · GitHub Actions · Railway | `infra/`, `.github/` |

The previous Flutter app and Java/Spring scaffold are kept, untouched, in `_legacy/`.

## Features

**Markets and charts**
- Real-time WebSocket prices. Crypto streams from Binance; stocks, FX, indices and commodities come from Yahoo Finance, plus Finnhub, Polygon and Alpha Vantage when you add API keys. The WebSocket client reconnects automatically with exponential backoff, a heartbeat watchdog, and re-authentication and re-subscription after each reconnect.
- Interactive candlestick charts from 1m to 1W, with volume and synced panes.
- Technical indicators, all calculated server-side:
  - SMA 20/50/200 and EMA
  - RSI and MACD
  - Bollinger Bands
  - ATR, Stochastic, VWAP and OBV
- A plain-English signal summary.
- **Advanced screener:** 154 preset filters across 45 calculated metrics, plus custom rules.

**Demo trading engine**
- Order types: market, limit, stop, stop-limit and trailing stop, plus bracket orders (take-profit and stop-loss linked as an OCO pair).
- Fills at the bid/ask with slippage and per-asset fees.
- Rules: margin and leverage, a margin call with liquidation, a daily loss limit, and no short selling of spot crypto.
- **Options simulator:** Black-Scholes chains with volatility skew, Greeks, buying and writing contracts, multi-leg payoff diagrams and cash settlement at expiry.

**Analytics and strategy tools**
- **Portfolio management:** virtual balance, deposit, withdraw, reset and a live P&L.
- **Performance analytics:** equity curve, drawdown, Sharpe, Sortino and Calmar ratios, VaR, win/loss stats, profit factor, streaks, monthly returns and coaching insights.
- **Strategy backtester:** 7 strategies, grid optimisation and walk-forward optimisation (rolling or anchored) with an efficiency score and no look-ahead bias.
- **Portfolio stress testing:** 8 historical crisis scenarios, custom shocks, and Monte Carlo VaR/CVaR with a correlation matrix.
- **ML pipeline:** 15 engineered features, logistic and ridge regression, walk-forward validation against a naive baseline, and a model registry stored in the database.

**News, community and accounts**
- **News aggregation** from several RSS sources, Finnhub and NewsAPI, tagged by instrument and sentiment.
- **Economic calendar** linked to related headlines and affected instruments.
- **Social feed:** cashtags, likes, comments, follows, trending symbols and a leaderboard.
- **Trading journal:** log trades with emotion, setup, tags and a rating, and see analytics by emotion and setup.
- **Paper trading competitions:** separate competition accounts, leaderboards, prizes and sponsors, and automatic winner notifications.
- **Voice commands:** say "buy 2 Apple", "price of gold", "alert me when bitcoin goes above 70000" and similar. The app always asks you to confirm a trade.
- **Mobile widgets:** a watchlist widget for the Android and iOS home screen.
- **Authentication:** JWT access and refresh tokens with revocation, Google OAuth, and a guest/demo login.

**Production concerns**
- Microservices: market-data, trading and analytics services that talk through Redis pub/sub.
- Redis caching.
- An append-only event log (event sourcing) with a replay audit.
- Rate limiting, input validation, SQL-injection-safe ORM queries and security headers.
- CDN-friendly cache headers.
- Docker and Kubernetes configs and a CI/CD pipeline.

## Run it locally

You need Python 3.12+, Node 20+ and npm. Optionally install Redis and PostgreSQL; SQLite and an in-memory cache are used when they're missing.

```bash
# 1. Backend  ->  http://localhost:8000  (Swagger UI at /docs)
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# 2. Web  ->  http://localhost:5173  (proxies /api and /ws to :8000)
cd web
npm install
npm run dev

# 3. Mobile (phone on the same Wi-Fi, or an emulator)
cd mobile
npm install
npx expo start          # press "s" to switch to Expo Go if you don't have a dev build yet
```

The app connects to Binance and Yahoo by default. If your network blocks them, set `MARKET_PROVIDER_MODE=sim` for offline simulated prices, which are clearly labelled **Simulated** in the UI.

Voice recognition and home-screen widgets on mobile use native modules. Expo Go doesn't include them, so build a development or preview build: `npx expo run:android`, or `npx eas-cli@latest build -p android --profile preview`. In Expo Go, voice falls back to a typed command box and widgets are skipped.

## Tests

```bash
cd backend && pytest -q            # 47 unit + integration tests (SQLite by default)
DATABASE_URL=postgresql://... REDIS_URL=redis://... pytest -q   # same suite on Postgres + Redis
cd web && npm test && npm run typecheck && npm run build
cd mobile && npx jest && npm run typecheck
```

## Deploy

- **Neon + Railway:** see [`docs/deployment.md`](docs/deployment.md). The database lives on Neon; Railway runs two services from this repo (`backend` and `web`) plus a Redis plugin.
- **Docker, whole topology:** `docker compose -f infra/docker-compose.yml up --build`. The API runs behind an nginx load balancer on `:8080` and the web app on `:4173`.
- **Kubernetes:** apply the manifests with `kubectl apply -f infra/k8s/`.

Architecture details are in [`docs/architecture.md`](docs/architecture.md). The REST and WebSocket reference is in [`docs/api.md`](docs/api.md).

## Notes and limits

- RM Markets is an **educational demo**. No real money moves and no orders reach real exchanges.
- **Competition prizes:** the app records the prize and sponsor and notifies winners. Paying out real prizes is up to the organiser and happens outside the app.
- **Market data:** free Yahoo data for stocks can be delayed. For exchange-grade real-time US equities, add a Polygon or Finnhub paid key.
- **ML predictions:** these are a learning tool. The app always shows the model's accuracy next to the baseline.
