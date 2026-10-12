# RM Markets API Specification

## Auth Service (8081)

### POST /api/auth/register
- Request:
  - `username` (string)
  - `password` (string)
- Response: created user object

### POST /api/auth/login
- Request:
  - `username` (string)
  - `password` (string)
- Response:
  - `token` (JWT)

### GET /api/auth/me
- Header: `Authorization: Bearer <token>`
- Response: username

## Market Service (8082)

### GET /api/market/ticker?symbol={symbol}
- Response:
  - `symbol`
  - `price`
  - `timestamp`

### GET /api/market/history?symbol={symbol}
- Response:
  - `symbol`
  - `candles` (OHLC array)

## Trading Service (8083)

### POST /api/trading/order
- Request:
  - `symbol`, `side`, `qty`, `price`
- Response:
  - order details

### GET /api/trading/orders
- Response: list of orders

### GET /api/trading/positions
- Response: list of position objects

## Analytics Service (8084)

### GET /api/analytics/indicator?symbol={symbol}&type={type}
- `type`: RSI, MACD, BOLLINGER
- Response: indicator data

### GET /api/analytics/performance?portfolioId={id}
- Response: total_return, sharpe_ratio

## News Service (8085)

### GET /api/news/headlines
- Response: headline list

### GET /api/news/calendar
- Response: economic events list

## Python ML Service (8090)

### GET /api/v1/ping
- Response: status

### POST /api/v1/indicator/rsi
- Request: symbol+price list
- Response: RSI

### POST /api/v1/backtest
- Request: symbol+price list
- Response: total_return+sharpe_ratio

### POST /api/v1/model/predict
- Request: symbol+feature list
- Response: predicted value
