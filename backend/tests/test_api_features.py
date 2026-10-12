import json

from tests.conftest import _register


def test_market_endpoints(client):
    assert len(client.get("/api/market/instruments").json()) >= 40
    q = client.get("/api/market/quote/btc-usdt").json()
    assert q["symbol"] == "BTCUSDT" and q["bid"] < q["ask"]
    h = client.get("/api/market/history/AAPL?interval=1h&limit=100")
    assert h.status_code == 200 and len(h.json()["candles"]) == 100 and "s-maxage" in h.headers["cache-control"]
    assert client.get("/api/market/history/AAPL?interval=7m").status_code == 422
    assert client.get("/api/market/quote/DOESNOTEXIST").status_code == 404
    i = client.get("/api/market/indicators/ETHUSDT?names=rsi,macd,bollinger,sma50").json()
    assert {"rsi", "macd", "bollinger", "sma50"} <= set(i)
    assert client.get("/api/market/search?q=' OR 1=1 --").status_code == 200  # no injection surface
    m = client.get("/api/market/movers").json()
    assert len(m["gainers"]) == 5


def test_screener(client):
    presets = client.get("/api/analytics/screener/presets").json()
    assert presets["count"] >= 100
    r = client.post("/api/analytics/screener", json={"presets": ["class_crypto"], "conditions": [{"field": "rsi_14", "op": "between", "value": [0, 100]}]})
    assert r.status_code == 200 and all(x["asset_class"] == "crypto" for x in r.json()["results"])
    assert client.post("/api/analytics/screener", json={"conditions": [{"field": "password_hash", "op": "eq", "value": 1}]}).status_code == 422


def test_analytics_stress_backtest_ml(client, headers):
    client.post("/api/trading/orders", headers=headers, json={"symbol": "BTCUSDT", "side": "buy", "qty": 0.2})
    client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 20})
    p = client.get("/api/analytics/performance", headers=headers).json()
    assert p["equity_curve"] and "sharpe" in p["risk"]
    s = client.post("/api/analytics/stress", headers=headers, json={}).json()
    assert len(s["results"]) >= 6 and all(r["pnl"] < 0 for r in s["results"] if r["id"] == "gfc_2008")
    c = client.post("/api/analytics/stress", headers=headers, json={"custom_shocks": {"crypto": -0.5}}).json()
    assert c["results"][0]["pnl"] < 0
    mc = client.get("/api/analytics/stress/monte-carlo?paths=1000", headers=headers).json()
    assert mc["var_99"] >= mc["var_95"] > 0
    bt = client.post("/api/analytics/backtest", headers=headers, json={"symbol": "AAPL", "strategy": "macd"}).json()
    assert len(bt["equity"]) == len(bt["benchmark"])
    wf = client.post("/api/analytics/backtest/walk-forward", headers=headers, json={"symbol": "BTCUSDT", "strategy": "sma_cross", "bars": 800})
    assert wf.status_code == 200 and len(wf.json()["windows"]) == 5
    ml = client.get("/api/analytics/ml/predict/BTCUSDT", headers=headers).json()
    assert 0 <= ml["prob_up"] <= 1


def test_social_journal_competitions(client, headers):
    post = client.post("/api/social/posts", headers=headers, json={"body": "Watching $TSLA and $ETH today", "sentiment": "bullish"}).json()
    assert post["symbols"] == ["TSLA", "ETHUSDT"]
    assert client.post(f"/api/social/posts/{post['id']}/like", headers=headers).json()["liked"]
    client.post(f"/api/social/posts/{post['id']}/comments", headers=headers, json={"body": "nice"})
    feed = client.get("/api/social/feed?symbol=TSLA").json()
    assert feed[0]["comments"] == 1 and feed[0]["likes"] == 1
    assert client.get("/api/social/trending").json()[0]["mentions"] >= 1
    other = _register(client)
    oh = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.delete(f"/api/social/posts/{post['id']}", headers=oh).status_code == 404

    o = client.post("/api/trading/orders", headers=headers, json={"symbol": "AMD", "side": "buy", "qty": 5}).json()
    client.post("/api/trading/positions/AMD/close", headers=headers, json={})
    un = client.get("/api/journal/unjournaled", headers=headers).json()
    assert un and un[0]["symbol"] == "AMD"
    e = client.post("/api/journal", headers=headers, json={"title": "AMD scalp", "trade_id": un[0]["id"], "emotion": "fomo", "tags": ["Scalp"]}).json()
    assert e["symbol"] == "AMD" and e["tags"] == ["scalp"] and e["pnl"] is not None
    assert client.get("/api/journal/analytics", headers=headers).json()["entries"] == 1
    assert o["status"] == "filled"

    comps = client.get("/api/competitions", headers=headers).json()
    crypto = next(c for c in comps if c["allowed_asset_classes"] == ["crypto"])
    j = client.post(f"/api/competitions/{crypto['id']}/join", headers=headers).json()
    assert j["joined"] and j["account_id"]
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 1, "account_id": j["account_id"]})
    assert r.status_code == 422 and "not allowed" in r.json()["detail"]
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "ETHUSDT", "side": "buy", "qty": 0.5, "account_id": j["account_id"]})
    assert r.status_code == 201
    lb = client.get(f"/api/competitions/{crypto['id']}/leaderboard").json()
    assert lb[0]["rank"] == 1
    assert client.post("/api/trading/account/deposit", headers=headers, json={"amount": 100, "account_id": j["account_id"]}).status_code == 403
    # someone else's competition account is not accessible
    assert client.get(f"/api/trading/account?account_id={j['account_id']}", headers=oh).status_code == 404


def test_voice_and_graphql(client, headers):
    assert client.post("/api/voice/parse", json={"text": "buy 3 apple"}).json()["order"]["symbol"] == "AAPL"
    q = {"query": "{ quotes(symbols:[\"AAPL\"]) { symbol price } account { equity } }"}
    r = client.post("/graphql", headers=headers, json=q).json()
    assert r["data"]["quotes"][0]["symbol"] == "AAPL" and r["data"]["account"]["equity"] > 0
    r = client.post("/graphql", headers=headers, json={"query": 'mutation { placeOrder(symbol:"AAPL", side:"buy", qty:1) { status } }'}).json()
    assert r["data"]["placeOrder"]["status"] == "filled"
    r = client.post("/graphql", json={"query": "{ account { equity } }"}).json()
    assert r["errors"]


def test_websocket(client, auth):
    headers, data = auth
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "welcome"
        ws.send_text(json.dumps({"op": "auth", "token": data["access_token"]}))
        assert ws.receive_json() == {"type": "auth", "ok": True, "user_id": data["user"]["id"]}
        ws.send_text(json.dumps({"op": "subscribe", "symbols": ["BTCUSDT", "bogus"]}))
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and snap["quotes"][0]["symbol"] == "BTCUSDT"
        assert ws.receive_json()["symbols"] == ["BTCUSDT"]
        ws.send_text("not json")
        assert ws.receive_json()["error"] == "invalid_json"
        ws.send_text(json.dumps({"op": "ping", "t": 1}))
        assert ws.receive_json()["type"] == "pong"


def test_health_and_headers(client):
    r = client.get("/health")
    assert r.json()["db"] is True
    assert r.headers["x-content-type-options"] == "nosniff" and "x-request-id" in r.headers
