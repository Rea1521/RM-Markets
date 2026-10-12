"""Technical indicators (numpy). Output arrays are aligned with input; warm-up
values are None so JSON consumers can skip them."""
from __future__ import annotations

import re
from typing import Sequence

import numpy as np


def _arr(x: Sequence[float]) -> np.ndarray:
    return np.asarray(x, dtype=float)


def to_list(a: np.ndarray) -> list[float | None]:
    return [None if not np.isfinite(v) else round(float(v), 8) for v in a]


def sma(x: Sequence[float], n: int) -> np.ndarray:
    a = _arr(x)
    out = np.full(a.shape, np.nan)
    if len(a) >= n:
        c = np.cumsum(np.insert(a, 0, 0.0))
        out[n - 1 :] = (c[n:] - c[:-n]) / n
    return out


def ema(x: Sequence[float], n: int) -> np.ndarray:
    a = _arr(x)
    out = np.full(a.shape, np.nan)
    if len(a) < n:
        return out
    k = 2 / (n + 1)
    out[n - 1] = a[:n].mean()
    for i in range(n, len(a)):
        out[i] = a[i] * k + out[i - 1] * (1 - k)
    return out


def rsi(x: Sequence[float], n: int = 14) -> np.ndarray:
    """Wilder's RSI."""
    a = _arr(x)
    out = np.full(a.shape, np.nan)
    if len(a) <= n:
        return out
    d = np.diff(a)
    gain = np.where(d > 0, d, 0.0)
    loss = np.where(d < 0, -d, 0.0)
    ag, al = gain[:n].mean(), loss[:n].mean()

    def val(g, l):
        if l == 0:
            return 100.0 if g > 0 else 50.0
        return 100 - 100 / (1 + g / l)

    out[n] = val(ag, al)
    for i in range(n + 1, len(a)):
        ag = (ag * (n - 1) + gain[i - 1]) / n
        al = (al * (n - 1) + loss[i - 1]) / n
        out[i] = val(ag, al)
    return out


def macd(x: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    a = _arr(x)
    line = ema(a, fast) - ema(a, slow)
    sig = np.full(a.shape, np.nan)
    valid = np.where(np.isfinite(line))[0]
    if len(valid) >= signal:
        start = valid[0]
        sig[start:] = ema(line[start:], signal)
    return line, sig, line - sig


def bollinger(x: Sequence[float], n: int = 20, k: float = 2.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    a = _arr(x)
    mid = sma(a, n)
    std = np.full(a.shape, np.nan)
    for i in range(n - 1, len(a)):
        std[i] = a[i - n + 1 : i + 1].std(ddof=0)
    return mid + k * std, mid, mid - k * std


def atr(high: Sequence[float], low: Sequence[float], close: Sequence[float], n: int = 14) -> np.ndarray:
    h, l, c = _arr(high), _arr(low), _arr(close)
    prev = np.concatenate([[c[0]], c[:-1]])
    tr = np.maximum.reduce([h - l, np.abs(h - prev), np.abs(l - prev)])
    out = np.full(c.shape, np.nan)
    if len(c) < n:
        return out
    out[n - 1] = tr[:n].mean()
    for i in range(n, len(c)):
        out[i] = (out[i - 1] * (n - 1) + tr[i]) / n
    return out


def stochastic(high, low, close, k: int = 14, d: int = 3) -> tuple[np.ndarray, np.ndarray]:
    h, l, c = _arr(high), _arr(low), _arr(close)
    kk = np.full(c.shape, np.nan)
    for i in range(k - 1, len(c)):
        hh, ll = h[i - k + 1 : i + 1].max(), l[i - k + 1 : i + 1].min()
        kk[i] = 50.0 if hh == ll else (c[i] - ll) / (hh - ll) * 100
    return kk, sma(np.nan_to_num(kk, nan=np.nan), d)


def vwap(high, low, close, volume) -> np.ndarray:
    tp = (_arr(high) + _arr(low) + _arr(close)) / 3
    v = _arr(volume)
    cv = np.cumsum(v)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(cv > 0, np.cumsum(tp * v) / cv, np.nan)


def obv(close, volume) -> np.ndarray:
    c, v = _arr(close), _arr(volume)
    sign = np.sign(np.diff(c, prepend=c[0]))
    return np.cumsum(sign * v)


def compute(candles: list[dict], names: list[str], params: dict | None = None) -> dict:
    """Compute a set of indicators for a candle list. Used by the API."""
    params = params or {}
    c = [x["c"] for x in candles]
    h = [x["h"] for x in candles]
    l = [x["l"] for x in candles]
    v = [x["v"] for x in candles]
    t = [x["t"] for x in candles]
    out: dict = {"t": t}
    for name in names:
        n = name.lower()
        if n == "macd":
            m, s, hist = macd(c, int(params.get("fast", 12)), int(params.get("slow", 26)), int(params.get("signal", 9)))
            out["macd"] = {"macd": to_list(m), "signal": to_list(s), "hist": to_list(hist)}
        elif n.startswith("sma") or re.fullmatch(r"ma\d*", n):
            digits = re.sub(r"\D", "", n)
            p = int(digits or params.get("ma", 20))
            out[name] = to_list(sma(c, p))
        elif n.startswith("ema"):
            p = int(re.sub(r"\D", "", n) or 20)
            out[name] = to_list(ema(c, p))
        elif n == "rsi":
            out["rsi"] = to_list(rsi(c, int(params.get("rsi", 14))))
        elif n in ("bb", "bollinger"):
            up, mid, lo = bollinger(c, int(params.get("bb", 20)), float(params.get("bb_k", 2)))
            out["bollinger"] = {"upper": to_list(up), "middle": to_list(mid), "lower": to_list(lo)}
        elif n == "atr":
            out["atr"] = to_list(atr(h, l, c, 14))
        elif n in ("stoch", "stochastic"):
            k, d = stochastic(h, l, c)
            out["stochastic"] = {"k": to_list(k), "d": to_list(d)}
        elif n == "vwap":
            out["vwap"] = to_list(vwap(h, l, c, v))
        elif n == "obv":
            out["obv"] = to_list(obv(c, v))
        else:
            raise ValueError(f"Unknown indicator {name}")
    return out


SUPPORTED = ["sma20", "sma50", "sma200", "ema9", "ema21", "rsi", "macd", "bollinger", "atr", "stochastic", "vwap", "obv"]
