# Architecture

```
                   ┌──────────────┐        ┌───────────────┐
   Browser (React) │   web (Vite  │        │ Mobile (Expo  │  iOS/Android widgets,
   ───────────────▶│   build +    │        │ React Native) │  voice, secure storage
                   │  node server)│        └──────┬────────┘
                   └──────┬───────┘               │ HTTPS + WSS
                          │ HTTPS + WSS           │
                   ┌──────▼──────────────────────▼────────┐
                   │ Load balancer (Railway edge / nginx / │
                   │ k8s ingress)  + optional CDN          │
                   └──┬──────────────┬─────────────────┬───┘
         /ws, /api/market   /api/* (auth, trading,   /api/analytics/*
                  │         social, journal, graphql)        │
        ┌─────────▼───────┐ ┌───────▼─────────┐ ┌────────────▼──────┐
        │ market-data      │ │ trading-api ×N  │ │ analytics-api ×N  │
        │ live feed worker │ │ JWT auth, order │ │ performance, risk │
        │ order matcher    │ │ engine, social, │ │ backtests, options│
        │ alerts, margin   │ │ competitions    │ │ ML, screener      │
        └───┬─────────┬────┘ └──┬──────────┬───┘ └──┬────────────┬───┘
            │ publish │ ticks    │ events   │        │            │
            │         ▼          ▼          ▼        ▼            │
            │      ┌──────────────────────────────────┐           │
            │      │ Redis: pub/sub (ticks, user:<id>),│◀──────────┘
            │      │ shared quote cache, rate limits   │
            │      └──────────────────────────────────┘
            ▼
   Binance WS (crypto), Yahoo / Polygon / Alpha Vantage / Finnhub (stocks, FX, indices, commodities),
   RSS + Finnhub + NewsAPI (news), ForexFactory (economic calendar)
                              │
                      ┌───────▼────────┐
                      │ PostgreSQL     │ users, accounts, positions, orders, trades,
                      │ (SQLite in dev)│ equity snapshots, append-only event log,
                      └────────────────┘ journal, social, competitions, ML models
```

## One codebase, three services

`backend/app/main.py` is an application factory. `SERVICE_MODE` selects the router groups:

| Service | `SERVICE_MODE` | `RUN_MARKET_FEED` | Responsibilities |
|---|---|---|---|
| market-data | `market` | `true` (exactly one instance) | Provider connections, quote cache, `/ws` fan-out, pending-order matcher, price alerts, margin calls, option expiry, competition settlement, equity snapshots |
| trading-api | `trading` | `false` | Auth (JWT/OAuth/demo), orders, positions, watchlist, alerts, social, journal, competitions, GraphQL |
| analytics-api | `analytics` | `false` | Performance analytics, stress testing, Monte Carlo VaR, backtests & walk-forward, options chains & payoff, ML pipeline, screener |
| (single service) | `all` | `true` | Everything in one process — the default for Railway and local dev |

Services communicate through Redis: the feed publishes `ticks`; any service publishes `user:<id>` events
(fills, alerts). Every API replica runs a WebSocket hub that subscribes to both channels, so clients can be
connected to any replica behind a load balancer. Without `REDIS_URL` an in-process bus and cache are used.

## Market data

* **Crypto:** Binance public market-data WebSocket (`data-stream.binance.vision`, 24h ticker stream) with REST bootstrap; reconnects with exponential backoff.
* **Stocks / FX / indices / commodities:** Finnhub quotes (if key) → Yahoo Finance chart API, polled every `STOCK_POLL_SECONDS`; closed markets polled less often.
* **History:** Binance klines, Polygon aggregates (key), Yahoo, Alpha Vantage (key). 4h bars are resampled from 1h where needed.
* **Fallback:** if every live source fails, a deterministic GBM simulation keeps the app usable. Simulated quotes are tagged `source: "sim"` and shown as **Simulated** in the UI — never presented as real.
* **Caching:** quotes are snapshotted to Redis every second; candles cached with interval-aware TTLs; history responses carry `Cache-Control: s-maxage` so a CDN/edge cache can serve them.

## Demo trading engine (`backend/app/trading/engine.py`)

* Order types: market, limit, stop, stop-limit, trailing stop; GTC/DAY; bracket (take-profit + stop-loss as an OCO pair).
* Fills at bid/ask with size-based slippage; per-asset-class fees (crypto 0.10%, stocks $0.005/share min $1, …).
* Margin: crypto 1× (spot, no shorting), stocks 2×, indices 5×, commodities 10×, FX 30×. Maintenance-margin liquidation at 50%.
* Risk rules: daily loss limit, concentration cap, max order notional, max open orders, optional market-hours enforcement, competition asset-class restrictions.
* **Event sourcing:** every state change (`AccountOpened`, `OrderPlaced`, `OrderFilled`, `FundsDeposited`, `OptionTraded`, …) is appended to `events`. `GET /api/trading/audit/replay` rebuilds cash and positions from the log and compares them with the live tables.

## Security

JWT access/refresh tokens with server-side revocation (`token_version`), bcrypt password hashing, Google OAuth ID-token verification,
Pydantic validation on every input (unknown fields rejected), SQLAlchemy ORM only (bound parameters — no string-built SQL; the screener
filters whitelisted fields in memory), Redis-backed rate limiting (per user/IP, stricter for auth and orders), security headers + HSTS,
WebSocket origin allow-list, token-in-first-message (not in URL), message size/rate limits and bounded per-client queues.
