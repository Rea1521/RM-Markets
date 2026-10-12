import math

import numpy as np

from app import indicators as ind


def test_sma_and_ema():
    x = list(range(1, 11))
    s = ind.sma(x, 3)
    assert math.isnan(s[1]) and s[2] == 2 and s[-1] == 9
    e = ind.ema(x, 3)
    assert e[2] == 2  # seeded with SMA
    assert abs(e[3] - (4 * 0.5 + 2 * 0.5)) < 1e-12


def test_rsi_extremes():
    up = list(range(1, 40))
    assert ind.rsi(up, 14)[-1] == 100
    down = list(range(40, 1, -1))
    assert ind.rsi(down, 14)[-1] == 0
    flat_noise = [100 + (1 if i % 2 else -1) for i in range(60)]
    assert 40 < ind.rsi(flat_noise, 14)[-1] < 60


def test_rsi_matches_reference_wilder():
    # classic Wilder example values (Investopedia/stockcharts dataset, 14 period)
    closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
              46.00, 46.03, 46.41, 46.22, 45.64]
    r = ind.rsi(closes, 14)
    assert abs(r[14] - 70.46) < 0.1
    assert abs(r[-1] - 57.9) < 0.6


def test_macd_and_bollinger():
    x = np.linspace(100, 200, 120)
    m, s, h = ind.macd(x)
    assert m[-1] > 0 and np.isfinite(s[-1]) and abs(h[-1] - (m[-1] - s[-1])) < 1e-9
    up, mid, lo = ind.bollinger([10.0] * 30, 20, 2)
    assert up[-1] == mid[-1] == lo[-1] == 10.0


def test_compute_api():
    candles = [{"t": i, "o": 1, "h": 2, "l": 0.5, "c": 1 + i / 100, "v": 10} for i in range(80)]
    out = ind.compute(candles, ["sma20", "ema9", "rsi", "macd", "bollinger", "atr", "stochastic", "vwap", "obv"])
    assert len(out["sma20"]) == 80 and out["sma20"][0] is None
    assert set(out["macd"]) == {"macd", "signal", "hist"}
