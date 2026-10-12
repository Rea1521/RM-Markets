from app import voice
from app.analytics import ml
from app.market import providers as P
from app.market.universe import BY_SYMBOL


def test_voice_orders():
    r = voice.parse("Buy 10 shares of Tesla")
    assert r["intent"] == "place_order" and r["order"]["symbol"] == "TSLA" and r["order"]["qty"] == 10
    r = voice.parse("sell half bitcoin at 70,000")
    assert r["order"] == {"symbol": "BTCUSDT", "side": "sell", "qty": 0.5, "type": "limit", "limit_price": 70000.0}
    assert voice.parse("buy apple")["missing"] == ["qty"]


def test_voice_other_intents():
    assert voice.parse("what's the price of ethereum")["symbol"] == "ETHUSDT"
    assert voice.parse("open my portfolio")["route"] == "/portfolio"
    a = voice.parse("alert me when gold goes above 2500")
    assert a["intent"] == "create_alert" and a["condition"] == "above" and a["price"] == 2500
    assert voice.parse("close all positions")["intent"] == "close_all"
    assert voice.parse("blah blah")["intent"] == "unknown"


def test_ml_pipeline():
    c = P.sim().history(BY_SYMBOL["ETHUSDT"], "1D", 600)
    m = ml.train(c)
    assert 0 <= m["metrics"]["accuracy"] <= 1 and len(m["metrics"]["fold_accuracy"]) == 4
    p = ml.predict(m, c)
    assert 0 <= p["prob_up"] <= 1 and p["signal"] in ("bullish", "bearish", "neutral")
