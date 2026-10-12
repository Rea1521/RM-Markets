#!/usr/bin/env bash
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

function wait_for_url() {
  local url=$1
  local name=$2
  local max_retries=30
  local count=0

  echo "Waiting for $name at $url ..."
  until curl -sSf "$url" > /dev/null; do
    ((count++))
    if [ $count -ge $max_retries ]; then
      echo "ERROR: $name did not become available after $max_retries attempts"
      return 1
    fi
    sleep 2
  done
  echo "$name is up"
}

wait_for_url "http://localhost:8081/api/auth/register" "Auth service"
wait_for_url "http://localhost:8082/api/market/ticker?symbol=BTCUSD" "Market service"
wait_for_url "http://localhost:8083/api/trading/positions" "Trading service"
wait_for_url "http://localhost:8084/api/analytics/indicator?symbol=AAPL" "Analytics service"
wait_for_url "http://localhost:8085/api/news/headlines" "News service"
wait_for_url "http://localhost:8090/api/v1/ping" "Python ML service"

cat <<'EOF'
All services are reachable. Running smoke tests now:
EOF

# Auth register + login + me
curl -s -X POST http://localhost:8081/api/auth/register -H "Content-Type: application/json" -d '{"username": "testuser", "password": "testpass"}' | jq .
AUTH_TOKEN=$(curl -s -X POST http://localhost:8081/api/auth/login -H "Content-Type: application/json" -d '{"username": "testuser", "password": "testpass"}' | jq -r .token)

curl -s -H "Authorization: Bearer $AUTH_TOKEN" http://localhost:8081/api/auth/me | jq .

# Market ticker
curl -s http://localhost:8082/api/market/ticker?symbol=ETHUSD | jq .

# Trading order + list
curl -s -X POST http://localhost:8083/api/trading/order -H "Content-Type: application/json" -d '{"symbol":"AAPL","side":"BUY","qty":1,"price":150}' | jq .
curl -s http://localhost:8083/api/trading/orders | jq .

# Analytics indicator
curl -s -G http://localhost:8084/api/analytics/indicator --data-urlencode "symbol=AAPL" --data-urlencode "type=RSI" | jq .

# News headlines
curl -s http://localhost:8085/api/news/headlines | jq .

# Python ML service
curl -s -X POST http://localhost:8090/api/v1/indicator/rsi -H "Content-Type: application/json" -d '{"symbol":"AAPL","prices":[150,151,152,153,154,155,156,157,158,159,160,161,162,163,164]}' | jq .

echo "✅ All smoke checks completed successfully"
