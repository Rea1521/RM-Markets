import math
from datetime import datetime, timedelta, timezone

from app.analytics import options as opt


def test_put_call_parity():
    S, K, T, r, v = 100, 105, 0.5, 0.05, 0.25
    c = opt.black_scholes(S, K, T, r, v, "call")["price"]
    p = opt.black_scholes(S, K, T, r, v, "put")["price"]
    assert abs((c - p) - (S - K * math.exp(-r * T))) < 1e-9


def test_known_value_and_greeks():
    g = opt.black_scholes(100, 100, 1, 0.05, 0.2, "call")
    assert abs(g["price"] - 10.4506) < 1e-3
    assert 0.6 < g["delta"] < 0.65
    assert g["gamma"] > 0 and g["vega"] > 0 and g["theta"] < 0
    p = opt.black_scholes(100, 100, 1, 0.05, 0.2, "put")
    assert -0.4 < p["delta"] < -0.35


def test_implied_vol_roundtrip():
    price = opt.black_scholes(50, 55, 0.25, 0.03, 0.42, "put")["price"]
    assert abs(opt.implied_vol(price, 50, 55, 0.25, 0.03, "put") - 0.42) < 1e-4


def test_chain_and_payoff():
    exp = datetime.now(timezone.utc) + timedelta(days=30)
    rows = opt.chain(200, 0.3, 0.05, exp, 5)
    assert len(rows) == 11
    calls = [r["call"]["price"] for r in rows]
    assert calls == sorted(calls, reverse=True)  # call price falls as strike rises
    pay = opt.payoff([{"type": "call", "strike": 100, "expiry": exp.isoformat(), "qty": 1, "premium": 5}], 100, 0.05, 0.3)
    assert abs(pay["breakevens"][0] - 105) < 0.5
    assert pay["max_loss"] == -5
