# RM Markets

This workspace contains a full Java backend microservices scaffold for RM Markets.

## Services
- auth-service (Spring Boot with JWT auth)
- market-service (mock market data)
- trading-service (order and position simulation)
- analytics-service (indicator and performance endpoints)
- news-service (news headlines and calendar)

## Build and run (each service)

From `backend-java`:

- `mvn clean install`
- For auth service: `cd auth-service && mvn spring-boot:run`
- For market service: `cd market-service && mvn spring-boot:run`
- For trading service: `cd trading-service && mvn spring-boot:run`
- For analytics service: `cd analytics-service && mvn spring-boot:run`
- For news service: `cd news-service && mvn spring-boot:run`

## API samples

- Auth: `POST http://localhost:8081/api/auth/register` and `/login`
- Market: `GET http://localhost:8082/api/market/ticker?symbol=BTCUSD`
- Trading: `POST http://localhost:8083/api/trading/order`
- Analytics: `GET http://localhost:8084/api/analytics/indicator?symbol=AAPL&type=RSI`
- News: `GET http://localhost:8085/api/news/headlines`
