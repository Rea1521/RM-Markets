import pytest

from app.db import SessionLocal
from app.market import service as market
from app.models import Order
from app.trading import engine


def quote_override(symbol, price):
    q = dict(market.get_quote(symbol))
    q.update(price=price, bid=price, ask=price)
    return {q["symbol"]: q}


def test_market_buy_updates_cash_and_position(client, headers):
    before = client.get("/api/trading/account", headers=headers).json()
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 10})
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "filled" and o["filled_price"] > 0
    after = client.get("/api/trading/account", headers=headers).json()
    assert after["cash"] == pytest.approx(before["cash"] - 10 * o["filled_price"] - o["fee"])
    pos = {p["symbol"]: p for p in after["positions"]}
    assert pos["AAPL"]["qty"] == 10


def test_rules_reject(client, headers):
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "BTCUSDT", "side": "sell", "qty": 1})
    assert r.status_code == 422 and "Short selling" in r.json()["detail"]
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "BTCUSDT", "side": "buy", "qty": 5})
    assert r.status_code == 422 and "buying power" in r.json()["detail"].lower()
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "NOPE", "side": "buy", "qty": 1})
    assert r.status_code == 422
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 1, "type": "limit"})
    assert r.status_code == 422  # limit_price missing
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 1, "stop_loss": 99999})
    assert r.status_code == 422
    rejected = client.get("/api/trading/orders?status=rejected", headers=headers).json()
    assert len(rejected) >= 1


def test_stock_short_and_leverage(client, headers):
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "TSLA", "side": "sell", "qty": 10})
    assert r.status_code == 201
    acct = client.get("/api/trading/account", headers=headers).json()
    p = next(p for p in acct["positions"] if p["symbol"] == "TSLA")
    assert p["qty"] == -10 and p["side"] == "short"
    assert acct["margin_used"] > 0


def test_limit_order_fills_when_price_crosses(client, headers):
    price = market.get_price("ETHUSDT")
    r = client.post("/api/trading/orders", headers=headers,
                    json={"symbol": "ETHUSDT", "side": "buy", "qty": 1, "type": "limit", "limit_price": round(price * 0.9, 2)})
    oid = r.json()["id"]
    assert r.json()["status"] == "pending"
    with SessionLocal() as db:
        assert engine.match_pending(db, quote_override("ETHUSDT", price * 0.95)) == 0
        assert engine.match_pending(db, quote_override("ETHUSDT", price * 0.85)) == 1
        o = db.get(Order, oid)
        assert o.status == "filled" and o.filled_price == pytest.approx(price * 0.85)


def test_bracket_oco(client, headers):
    price = market.get_price("MSFT")
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "MSFT", "side": "buy", "qty": 5,
                                                                    "take_profit": round(price * 1.1, 2), "stop_loss": round(price * 0.95, 2)})
    assert r.status_code == 201
    pend = [o for o in client.get("/api/trading/orders?status=pending&symbol=MSFT", headers=headers).json()]
    assert {o["type"] for o in pend} == {"limit", "stop"} and len({o["oco_group"] for o in pend}) == 1
    with SessionLocal() as db:
        engine.match_pending(db, quote_override("MSFT", price * 1.2))
    orders = client.get("/api/trading/orders?symbol=MSFT", headers=headers).json()
    statuses = {o["type"]: o["status"] for o in orders if o["parent_id"]}
    assert statuses == {"limit": "filled", "stop": "cancelled"}
    pos = [p for p in client.get("/api/trading/positions", headers=headers).json()["positions"] if p["symbol"] == "MSFT"]
    assert pos == []


def test_trailing_stop(client, headers):
    client.post("/api/trading/orders", headers=headers, json={"symbol": "NVDA", "side": "buy", "qty": 5})
    price = market.get_price("NVDA")
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "NVDA", "side": "sell", "qty": 5, "type": "trailing_stop", "trail_percent": 5})
    oid = r.json()["id"]
    with SessionLocal() as db:
        engine.match_pending(db, quote_override("NVDA", price * 1.2))  # ratchets anchor up
        o = db.get(Order, oid)
        assert o.status == "pending" and o.stop_price == pytest.approx(price * 1.2 * 0.95)
        engine.match_pending(db, quote_override("NVDA", price * 1.13))
        db.refresh(o)
        assert o.status == "filled"


def test_close_cancel_and_event_replay(client, headers):
    client.post("/api/trading/orders", headers=headers, json={"symbol": "EURUSD", "side": "buy", "qty": 10000})
    client.post("/api/trading/orders", headers=headers, json={"symbol": "EURUSD", "side": "sell", "qty": 4000})
    r = client.post("/api/trading/positions/EURUSD/close", headers=headers, json={})
    assert r.status_code == 200 and r.json()["qty"] == 6000
    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 1, "type": "limit", "limit_price": 1})
    assert client.delete(f"/api/trading/orders/{r.json()['id']}", headers=headers).json()["status"] == "cancelled"
    assert client.delete(f"/api/trading/orders/{r.json()['id']}", headers=headers).status_code == 409
    audit = client.get("/api/trading/audit/replay", headers=headers).json()
    assert audit["consistent"], audit
    hist = client.get("/api/trading/history", headers=headers).json()
    assert {"OrderFilled", "OrderPlaced", "OrderCancelled"} <= {h["type"] for h in hist}


def test_funds_and_reset(client, headers):
    a = client.post("/api/trading/account/deposit", headers=headers, json={"amount": 5000}).json()
    assert a["net_deposits"] == 5000
    assert client.post("/api/trading/account/withdraw", headers=headers, json={"amount": 10_000_000}).status_code == 422
    client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 3})
    r = client.post("/api/trading/account/reset", headers=headers, json={"starting_balance": 50000}).json()
    assert r["equity"] == 50000 and r["positions"] == []
    assert client.get("/api/trading/audit/replay", headers=headers).json()["consistent"]


def test_other_users_cannot_touch_my_orders(client, headers, auth):
    from tests.conftest import _register

    r = client.post("/api/trading/orders", headers=headers, json={"symbol": "AAPL", "side": "buy", "qty": 1, "type": "limit", "limit_price": 1})
    other = {"Authorization": f"Bearer {_register(client)['access_token']}"}
    assert client.delete(f"/api/trading/orders/{r.json()['id']}", headers=other).status_code == 404


def test_options_trade_and_settlement(client, headers):
    chain = client.get("/api/analytics/options/chain/AAPL").json()
    row = chain["rows"][len(chain["rows"]) // 2]
    r = client.post("/api/analytics/options/orders", headers=headers, json={
        "underlying": "AAPL", "option_type": "call", "strike": row["strike"], "expiry": chain["expiry"], "contracts": 2})
    assert r.status_code == 201, r.text
    acct = client.get("/api/trading/account", headers=headers).json()
    assert acct["option_positions"][0]["contracts"] == 2
    r = client.post("/api/analytics/options/orders", headers=headers, json={
        "underlying": "AAPL", "option_type": "call", "strike": row["strike"], "expiry": chain["expiry"], "contracts": -2})
    assert r.json()["status"] == "closed"
    assert client.get("/api/trading/audit/replay", headers=headers).json()["consistent"]


def test_watchlist_alerts_notifications(client, headers):
    wl = client.get("/api/trading/watchlist", headers=headers).json()
    assert any(q["symbol"] == "BTCUSDT" for q in wl)
    assert client.post("/api/trading/watchlist", headers=headers, json={"symbol": "SOL/USDT"}).json()["symbol"] == "SOLUSDT"
    client.delete("/api/trading/watchlist/BTCUSDT", headers=headers)
    assert not any(q["symbol"] == "BTCUSDT" for q in client.get("/api/trading/watchlist", headers=headers).json())
    price = market.get_price("XAUUSD")
    client.post("/api/trading/alerts", headers=headers, json={"symbol": "gold", "condition": "above", "price": price * 1.01})
    with SessionLocal() as db:
        assert engine.check_alerts(db, quote_override("XAUUSD", price * 1.02)) >= 1
    n = client.get("/api/trading/notifications", headers=headers).json()
    assert any(i["kind"] == "price_alert" for i in n["items"])


def test_margin_call_liquidates(client, headers):
    client.post("/api/trading/account/reset", headers=headers, json={"starting_balance": 10000})
    price = market.get_price("USDJPY")
    qty = round(10000 * 25 / price, 0)  # ~25x on FX (30x allowed)
    assert client.post("/api/trading/orders", headers=headers, json={"symbol": "USDJPY", "side": "buy", "qty": qty}).status_code == 201
    crash = quote_override("USDJPY", price * 0.97)  # -3% * 25x = -75% equity
    import app.market.service as svc

    svc.LOCAL_QUOTES.update(crash)
    try:
        with SessionLocal() as db:
            assert engine.maintenance_check(db) >= 1
    finally:
        svc.LOCAL_QUOTES.pop("USDJPY", None)
    assert not [p for p in client.get("/api/trading/positions", headers=headers).json()["positions"] if p["symbol"] == "USDJPY"]
