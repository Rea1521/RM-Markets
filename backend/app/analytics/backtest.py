"""Strategy backtester with grid optimisation and walk-forward analysis.

Signals are computed on bar close and executed on the NEXT bar's open, so there
is no look-ahead bias. Position is long (+1), flat (0) or optionally short (-1).
"""
from __future__ import annotations

import itertools
import math
from typing import Callable

import numpy as np

from .. import indicators as ind

# --------------------------------------------------------------------- strategies
# each returns desired position (-1, 0, 1) per bar, given closes & params


def _sma_cross(c: np.ndarray, p: dict, h=None, l=None) -> np.ndarray:
    f, s = ind.sma(c, int(p["fast"])), ind.sma(c, int(p["slow"]))
    return np.where(np.isfinite(s), np.where(f > s, 1, -1), 0)


def _ema_cross(c, p, h=None, l=None):
    f, s = ind.ema(c, int(p["fast"])), ind.ema(c, int(p["slow"]))
    return np.where(np.isfinite(s), np.where(f > s, 1, -1), 0)


def _rsi_reversion(c, p, h=None, l=None):
    r = ind.rsi(c, int(p["period"]))
    pos = np.zeros(len(c))
    state = 0
    for i, v in enumerate(r):
        if not np.isfinite(v):
            continue
        if v < p["oversold"]:
            state = 1
        elif v > p["overbought"]:
            state = -1
        elif state == 1 and v > 50:
            state = 0
        elif state == -1 and v < 50:
            state = 0
        pos[i] = state
    return pos


def _macd(c, p, h=None, l=None):
    m, s, _ = ind.macd(c, int(p["fast"]), int(p["slow"]), int(p["signal"]))
    return np.where(np.isfinite(s), np.where(m > s, 1, -1), 0)


def _bollinger(c, p, h=None, l=None):
    up, mid, lo = ind.bollinger(c, int(p["period"]), float(p["k"]))
    pos = np.zeros(len(c))
    state = 0
    for i in range(len(c)):
        if not np.isfinite(mid[i]):
            continue
        if c[i] < lo[i]:
            state = 1
        elif c[i] > up[i]:
            state = -1
        elif (state == 1 and c[i] >= mid[i]) or (state == -1 and c[i] <= mid[i]):
            state = 0
        pos[i] = state
    return pos


def _breakout(c, p, h, l):
    n = int(p["lookback"])
    pos = np.zeros(len(c))
    state = 0
    for i in range(n, len(c)):
        hh, ll = h[i - n : i].max(), l[i - n : i].min()
        if c[i] > hh:
            state = 1
        elif c[i] < ll:
            state = -1
        pos[i] = state
    return pos


def _buy_hold(c, p, h=None, l=None):
    return np.ones(len(c))


STRATEGIES: dict[str, dict] = {
    "sma_cross": {"name": "SMA crossover", "fn": _sma_cross, "defaults": {"fast": 20, "slow": 50},
                  "grid": {"fast": [5, 10, 20, 30], "slow": [40, 50, 100, 150]}},
    "ema_cross": {"name": "EMA crossover", "fn": _ema_cross, "defaults": {"fast": 12, "slow": 26},
                  "grid": {"fast": [5, 9, 12, 20], "slow": [21, 26, 50, 100]}},
    "rsi_reversion": {"name": "RSI mean reversion", "fn": _rsi_reversion, "defaults": {"period": 14, "oversold": 30, "overbought": 70},
                      "grid": {"period": [7, 14, 21], "oversold": [20, 25, 30, 35], "overbought": [65, 70, 75, 80]}},
    "macd": {"name": "MACD signal cross", "fn": _macd, "defaults": {"fast": 12, "slow": 26, "signal": 9},
             "grid": {"fast": [8, 12, 16], "slow": [21, 26, 34], "signal": [5, 9, 12]}},
    "bollinger": {"name": "Bollinger reversion", "fn": _bollinger, "defaults": {"period": 20, "k": 2.0},
                  "grid": {"period": [10, 20, 30], "k": [1.5, 2.0, 2.5, 3.0]}},
    "breakout": {"name": "Donchian breakout", "fn": _breakout, "defaults": {"lookback": 20},
                 "grid": {"lookback": [10, 20, 40, 55, 80]}},
    "buy_hold": {"name": "Buy & hold (benchmark)", "fn": _buy_hold, "defaults": {}, "grid": {}},
}


def simulate(candles: list[dict], strategy: str, params: dict, *, fee_bps: float = 10, allow_short: bool = False,
             initial: float = 10_000.0, periods_per_year: int = 252, stop_loss_pct: float | None = None) -> dict:
    spec = STRATEGIES[strategy]
    c = np.array([x["c"] for x in candles], dtype=float)
    o = np.array([x["o"] for x in candles], dtype=float)
    h = np.array([x["h"] for x in candles], dtype=float)
    l = np.array([x["l"] for x in candles], dtype=float)
    p = {**spec["defaults"], **(params or {})}
    target = spec["fn"](c, p, h, l)
    if not allow_short:
        target = np.maximum(target, 0)
    n = len(c)
    equity = np.empty(n)
    cash, units, pos = initial, 0.0, 0
    entry_price = 0.0
    trades: list[dict] = []
    fee = fee_bps / 10000
    for i in range(n):
        if i > 0:
            want = int(target[i - 1])  # decided at previous close, executed at this open
            # protective stop
            if stop_loss_pct and pos != 0:
                stop = entry_price * (1 - stop_loss_pct / 100) if pos > 0 else entry_price * (1 + stop_loss_pct / 100)
                if (pos > 0 and l[i] <= stop) or (pos < 0 and h[i] >= stop):
                    px = min(o[i], stop) if pos > 0 else max(o[i], stop)
                    cash += units * px - abs(units) * px * fee
                    trades[-1].update(exit_t=candles[i]["t"], exit=px, ret_pct=(px / entry_price - 1) * 100 * pos, reason="stop")
                    units, pos = 0.0, 0
                    want = 0 if want == trades[-1]["dir"] else want
            if want != pos:
                px = o[i]
                if pos != 0:
                    cash += units * px - abs(units) * px * fee
                    trades[-1].update(exit_t=candles[i]["t"], exit=px, ret_pct=(px / entry_price - 1) * 100 * pos, reason="signal")
                    units, pos = 0.0, 0
                if want != 0:
                    alloc = cash * (1 - fee)
                    units = want * alloc / px
                    cash -= units * px + abs(units) * px * fee
                    pos, entry_price = want, px
                    trades.append({"entry_t": candles[i]["t"], "entry": px, "dir": want})
        equity[i] = cash + units * c[i]
    if pos != 0 and trades:
        trades[-1].update(exit_t=candles[-1]["t"], exit=c[-1], ret_pct=(c[-1] / entry_price - 1) * 100 * pos, reason="open")
    return {"params": p, "equity": equity, "trades": trades, "metrics": metrics(equity, trades, periods_per_year, c)}


def metrics(equity: np.ndarray, trades: list[dict], ppy: int, closes: np.ndarray | None = None) -> dict:
    r = np.diff(equity) / equity[:-1] if len(equity) > 1 else np.array([0.0])
    vol = r.std(ddof=1) if len(r) > 1 else 0.0
    peak = np.maximum.accumulate(equity)
    mdd = float(((equity - peak) / peak).min()) if len(equity) else 0.0
    total = float(equity[-1] / equity[0] - 1) if len(equity) else 0.0
    years = max(len(r) / ppy, 1e-9)
    cagr = (1 + total) ** (1 / years) - 1 if total > -1 else -1.0
    rets = [t["ret_pct"] for t in trades if "ret_pct" in t]
    wins = [x for x in rets if x > 0]
    losses = [x for x in rets if x <= 0]
    downside = r[r < 0]
    return {
        "total_return_pct": round(total * 100, 3),
        "cagr_pct": round(cagr * 100, 3),
        "sharpe": round(float(r.mean() / vol * math.sqrt(ppy)), 3) if vol > 0 else 0.0,
        "sortino": round(float(r.mean() / downside.std(ddof=1) * math.sqrt(ppy)), 3) if len(downside) > 1 and downside.std(ddof=1) > 0 else 0.0,
        "max_drawdown_pct": round(mdd * 100, 3),
        "volatility_pct": round(float(vol * math.sqrt(ppy) * 100), 3),
        "trades": len(rets),
        "win_rate": round(len(wins) / len(rets) * 100, 2) if rets else 0.0,
        "avg_trade_pct": round(float(np.mean(rets)), 3) if rets else 0.0,
        "profit_factor": round(sum(wins) / -sum(losses), 3) if losses and sum(losses) < 0 else None,
        "buy_hold_return_pct": round(float(closes[-1] / closes[0] - 1) * 100, 3) if closes is not None and len(closes) else None,
        "exposure_pct": None,
    }


def _grid(strategy: str, custom: dict | None = None, max_combos: int = 120) -> list[dict]:
    g = custom or STRATEGIES[strategy]["grid"]
    if not g:
        return [{}]
    keys = list(g)
    combos = [dict(zip(keys, vals)) for vals in itertools.product(*(g[k] for k in keys))]
    if strategy in ("sma_cross", "ema_cross", "macd"):
        combos = [c for c in combos if c.get("fast", 0) < c.get("slow", 1e9)]
    if strategy == "rsi_reversion":
        combos = [c for c in combos if c["oversold"] < c["overbought"]]
    return combos[:max_combos]


def _score(m: dict, objective: str) -> float:
    v = m.get(objective)
    return float(v) if v is not None and math.isfinite(v) else -1e9


def optimize(candles: list[dict], strategy: str, objective: str = "sharpe", **kw) -> dict:
    results = []
    for p in _grid(strategy, kw.pop("grid", None)):
        res = simulate(candles, strategy, p, **kw)
        results.append({"params": res["params"], "metrics": res["metrics"]})
    results.sort(key=lambda r: _score(r["metrics"], objective), reverse=True)
    return {"best": results[0] if results else None, "results": results[:25], "tested": len(results)}


def walk_forward(candles: list[dict], strategy: str, *, windows: int = 5, train_ratio: float = 0.7,
                 objective: str = "sharpe", anchored: bool = False, **kw) -> dict:
    """Rolling (or anchored) walk-forward optimisation.

    The series is cut into `windows` consecutive segments. In each segment the
    first `train_ratio` is used to pick parameters (in-sample), which are then
    applied unchanged to the remaining out-of-sample part. The OOS equity curves
    are chained so the final result reflects only unseen data.
    """
    n = len(candles)
    seg = n // windows
    if seg < 40:
        raise ValueError("Not enough data for walk-forward: need at least 40 bars per window")
    out_windows = []
    oos_equity: list[float] = []
    oos_t: list[int] = []
    capital = kw.get("initial", 10_000.0)
    warm = 60  # bars of history fed before OOS so indicators are warmed up
    for w in range(windows):
        start = 0 if anchored else w * seg
        end = (w + 1) * seg if w < windows - 1 else n
        split = start + int((end - start) * train_ratio) if not anchored else w * seg + int(seg * train_ratio)
        train = candles[start:split]
        test = candles[max(0, split - warm):end]
        opt_res = optimize(train, strategy, objective, **{k: v for k, v in kw.items() if k != "initial"})
        best = opt_res["best"]["params"] if opt_res["best"] else {}
        sim_kw = {k: v for k, v in kw.items() if k != "initial"}
        oos = simulate(test, strategy, best, initial=capital, **sim_kw)
        offset = min(warm, split - max(0, split - warm))
        eq = oos["equity"][offset:]
        # rescale so the curve starts at current capital
        eq = eq / eq[0] * capital if len(eq) and eq[0] else eq
        capital = float(eq[-1]) if len(eq) else capital
        oos_equity.extend(eq.tolist())
        oos_t.extend(c["t"] for c in test[offset:])
        is_m = opt_res["best"]["metrics"] if opt_res["best"] else {}
        oos_m = metrics(np.asarray(eq), [t for t in oos["trades"] if t["entry_t"] >= test[offset]["t"]], kw.get("periods_per_year", 252))
        out_windows.append({
            "window": w + 1, "train_from": train[0]["t"], "train_to": train[-1]["t"], "test_from": test[offset]["t"],
            "test_to": test[-1]["t"], "best_params": best, "in_sample": is_m, "out_of_sample": oos_m,
        })
    eqa = np.asarray(oos_equity)
    agg = metrics(eqa, [], kw.get("periods_per_year", 252))
    is_avg = np.mean([w["in_sample"].get("total_return_pct", 0) for w in out_windows])
    oos_avg = np.mean([w["out_of_sample"].get("total_return_pct", 0) for w in out_windows])
    efficiency = round(float(oos_avg / is_avg), 3) if is_avg not in (0, 0.0) else None
    return {
        "strategy": strategy, "windows": out_windows, "objective": objective, "anchored": anchored,
        "oos_equity": [{"t": t, "equity": round(e, 2)} for t, e in zip(oos_t, oos_equity)],
        "oos_metrics": agg, "walk_forward_efficiency": efficiency,
        "robust": efficiency is not None and efficiency > 0.5 and agg["total_return_pct"] > 0,
    }


def equity_points(candles: list[dict], equity: np.ndarray) -> list[dict]:
    return [{"t": c["t"], "equity": round(float(e), 2)} for c, e in zip(candles, equity)]


Sim = Callable[..., dict]
