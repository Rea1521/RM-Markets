import numpy as np
import pytest

from app.analytics import backtest as bt
from app.market import providers as P
from app.market.universe import BY_SYMBOL


def candles(n=400):
    return P.sim().history(BY_SYMBOL["AAPL"], "1D", n)


def test_buy_hold_matches_price_change():
    c = candles()
    res = bt.simulate(c, "buy_hold", {}, fee_bps=0)
    expected = c[-1]["c"] / c[1]["o"]
    assert abs(res["equity"][-1] / 10_000 - expected) < 1e-9


def test_no_lookahead():
    """Changing the final bar must not change any earlier equity value."""
    c = candles()
    a = bt.simulate(c, "sma_cross", {"fast": 5, "slow": 20})["equity"]
    c2 = [dict(x) for x in c]
    c2[-1]["c"] *= 1.5
    b = bt.simulate(c2, "sma_cross", {"fast": 5, "slow": 20})["equity"]
    assert np.allclose(a[:-1], b[:-1])


@pytest.mark.parametrize("name", list(bt.STRATEGIES))
def test_all_strategies_run(name):
    res = bt.simulate(candles(), name, {}, allow_short=True, stop_loss_pct=10)
    assert np.isfinite(res["equity"]).all()
    assert "sharpe" in res["metrics"]


def test_optimize_and_walk_forward():
    c = candles(600)
    o = bt.optimize(c, "sma_cross")
    assert o["tested"] > 5 and o["best"]["params"]["fast"] < o["best"]["params"]["slow"]
    wf = bt.walk_forward(c, "sma_cross", windows=4)
    assert len(wf["windows"]) == 4 and len(wf["oos_equity"]) > 100
    with pytest.raises(ValueError):
        bt.walk_forward(c[:100], "sma_cross", windows=5)
