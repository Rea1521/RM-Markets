# RM Markets System Architecture

## Overview

RM Markets is a modular trading simulation platform with the following layers:

- Frontend: Flutter mobile app
- Backend Java microservices: Auth, Market, Trading, Analytics, News
- Python ML service: FastAPI strategy/indicator model
- Database: PostgreSQL (plus Redis cache)
- Local development orchestration: Docker Compose

## Microservices

- **Authentication Service** (Java Spring Boot, `auth-service`)
  - User registration/login
  - JWT-based security
  - Role-based access

- **Market Data Service** (Java Spring Boot, `market-service`)
  - Mock live ticker
  - Historical candle endpoints

- **Trading Engine Service** (Java Spring Boot, `trading-service`)
  - Order placement simulation
  - Position tracking

- **Analytics Service** (Java Spring Boot, `analytics-service`)
  - Indicator calculation
  - Performance metrics

- **News Service** (Java Spring Boot, `news-service`)
  - Market headlines
  - Economic calendar

- **ML/Strategy Service** (Python FastAPI, `python-ml-service`)
  - RSI and backtest endpoints
  - Basic regression prediction model

## Data flow

1. Flutter mobile app calls the backend REST APIs for login, quotes, trading, analytics.
2. Market service provides ticker and historical data.
3. Trading service processes buy/sell requests and returns positions.
4. Analytics service returns indicator values.
5. Python service offers advanced ML endpoints.
6. PostgreSQL stores users and portfolio data; Redis caches frequent market data.

## Local Dev and Docker Compose

`infra/docker-compose.yml` includes:

- `postgres`
- `redis`
- `auth-service`, `market-service`, `trading-service`, `analytics-service`, `news-service`
- `python-ml-service`

---

## App roadmap

1. Add full PostgreSQL schema normalization
2. Implement real external market datasource (AlphaVantage/Polygon)
3. Add comprehensive unit/integration tests
4. Add GraphQL endpoint in `market-service`
5. Add cloud deployment (Kubernetes + Helm)
