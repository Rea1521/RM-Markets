"""Advanced screener: ~45 computed metrics per instrument and a catalogue of
100+ preset filters, plus arbitrary user-built conditions on whitelisted fields
(no SQL is involved: filtering is done on computed rows, so there is no
injection surface)."""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
from fastapi import HTTPException

from .. import indicators as ind
from ..cache import cached
from ..market import service as market
from ..market.universe import INSTRUMENTS, Instrument

log = logging.getLogger("rm.screener")

# field -> (label, group, type)
FIELDS: dict[str, tuple[str, str, str]] = {
    "price": ("Price", "Price", "num"), "change_pct": ("Change % (day)", "Price", "num"),
    "gap_pct": ("Gap % (open vs prev close)", "Price", "num"), "day_range_pct": ("Day range %", "Price", "num"),
    "volume": ("Volume", "Volume", "num"), "dollar_volume": ("Dollar volume", "Volume", "num"),
    "rel_volume": ("Relative volume (vs 20d)", "Volume", "num"), "avg_volume_20": ("Avg volume (20d)", "Volume", "num"),
    "perf_1w": ("Performance 1W %", "Performance", "num"), "perf_1m": ("Performance 1M %", "Performance", "num"),
    "perf_3m": ("Performance 3M %", "Performance", "num"), "perf_6m": ("Performance 6M %", "Performance", "num"),
    "perf_ytd": ("Performance YTD %", "Performance", "num"), "perf_1y": ("Performance 1Y %", "Performance", "num"),
    "rsi_14": ("RSI (14)", "Oscillators", "num"), "rsi_7": ("RSI (7)", "Oscillators", "num"),
    "stoch_k": ("Stochastic %K", "Oscillators", "num"), "macd_hist": ("MACD histogram (norm.)", "Oscillators", "num"),
    "macd_bullish": ("MACD above signal", "Oscillators", "bool"), "macd_cross_up": ("MACD bullish cross (3 bars)", "Oscillators", "bool"),
    "sma20_dist": ("Distance from SMA20 %", "Moving averages", "num"), "sma50_dist": ("Distance from SMA50 %", "Moving averages", "num"),
    "sma200_dist": ("Distance from SMA200 %", "Moving averages", "num"), "above_sma20": ("Above SMA20", "Moving averages", "bool"),
    "above_sma50": ("Above SMA50", "Moving averages", "bool"), "above_sma200": ("Above SMA200", "Moving averages", "bool"),
    "golden_cross": ("SMA50 above SMA200", "Moving averages", "bool"), "ema_trend_up": ("EMA9 above EMA21", "Moving averages", "bool"),
    "bb_pctb": ("Bollinger %B", "Volatility", "num"), "bb_width": ("Bollinger width %", "Volatility", "num"),
    "atr_pct": ("ATR % of price", "Volatility", "num"), "volatility_30d": ("Volatility 30d (ann.) %", "Volatility", "num"),
    "beta": ("Beta vs S&P 500", "Risk", "num"), "max_drawdown_1y": ("Max drawdown 1Y %", "Risk", "num"),
    "sharpe_1y": ("Sharpe ratio 1Y", "Risk", "num"), "dist_52w_high": ("Distance from 52W high %", "52-week", "num"),
    "dist_52w_low": ("Distance above 52W low %", "52-week", "num"), "new_52w_high": ("At 52W high", "52-week", "bool"),
    "new_52w_low": ("At 52W low", "52-week", "bool"), "up_streak": ("Consecutive up days", "Pattern", "num"),
    "down_streak": ("Consecutive down days", "Pattern", "num"), "inside_day": ("Inside day", "Pattern", "bool"),
    "asset_class": ("Asset class", "Descriptive", "str"), "sector": ("Sector", "Descriptive", "str"),
    "market_open": ("Market open now", "Descriptive", "bool"),
}

OPS = {"gt", "gte", "lt", "lte", "eq", "neq", "between", "in"}


def _p(id_, name, group, conds):
    return {"id": id_, "name": name, "group": group, "conditions": conds}


def _c(field, op, value):
    return {"field": field, "op": op, "value": value}


def build_presets() -> list[dict]:
    P: list[dict] = []
    for lvl in (10, 20, 25, 30, 35, 40):
        P.append(_p(f"rsi14_lt_{lvl}", f"RSI(14) below {lvl}", "Oscillators", [_c("rsi_14", "lt", lvl)]))
    for lvl in (50, 60, 65, 70, 75, 80, 90):
        P.append(_p(f"rsi14_gt_{lvl}", f"RSI(14) above {lvl}", "Oscillators", [_c("rsi_14", "gt", lvl)]))
    for lvl in (20, 30):
        P.append(_p(f"rsi7_lt_{lvl}", f"RSI(7) below {lvl}", "Oscillators", [_c("rsi_7", "lt", lvl)]))
    for lvl in (70, 80):
        P.append(_p(f"rsi7_gt_{lvl}", f"RSI(7) above {lvl}", "Oscillators", [_c("rsi_7", "gt", lvl)]))
    P += [_p("stoch_os", "Stochastic oversold (<20)", "Oscillators", [_c("stoch_k", "lt", 20)]),
          _p("stoch_ob", "Stochastic overbought (>80)", "Oscillators", [_c("stoch_k", "gt", 80)]),
          _p("macd_bull", "MACD above signal", "Oscillators", [_c("macd_bullish", "eq", True)]),
          _p("macd_bear", "MACD below signal", "Oscillators", [_c("macd_bullish", "eq", False)]),
          _p("macd_cross", "MACD fresh bullish cross", "Oscillators", [_c("macd_cross_up", "eq", True)]),
          _p("macd_hist_pos", "MACD histogram positive", "Oscillators", [_c("macd_hist", "gt", 0)]),
          _p("macd_hist_neg", "MACD histogram negative", "Oscillators", [_c("macd_hist", "lt", 0)])]
    for ma in (20, 50, 200):
        P.append(_p(f"above_sma{ma}", f"Price above SMA{ma}", "Moving averages", [_c(f"above_sma{ma}", "eq", True)]))
        P.append(_p(f"below_sma{ma}", f"Price below SMA{ma}", "Moving averages", [_c(f"above_sma{ma}", "eq", False)]))
        for d in (2, 5, 10):
            P.append(_p(f"sma{ma}_above_{d}", f"{d}%+ above SMA{ma}", "Moving averages", [_c(f"sma{ma}_dist", "gt", d)]))
            P.append(_p(f"sma{ma}_below_{d}", f"{d}%+ below SMA{ma}", "Moving averages", [_c(f"sma{ma}_dist", "lt", -d)]))
    P += [_p("golden", "Golden cross regime (SMA50 > SMA200)", "Moving averages", [_c("golden_cross", "eq", True)]),
          _p("death", "Death cross regime (SMA50 < SMA200)", "Moving averages", [_c("golden_cross", "eq", False)]),
          _p("ema_up", "Short-term uptrend (EMA9 > EMA21)", "Moving averages", [_c("ema_trend_up", "eq", True)]),
          _p("ema_down", "Short-term downtrend (EMA9 < EMA21)", "Moving averages", [_c("ema_trend_up", "eq", False)]),
          _p("full_uptrend", "Full uptrend (above 20/50/200)", "Moving averages",
             [_c("above_sma20", "eq", True), _c("above_sma50", "eq", True), _c("above_sma200", "eq", True)])]
    for k, label in (("perf_1w", "1W"), ("perf_1m", "1M"), ("perf_3m", "3M"), ("perf_6m", "6M"), ("perf_ytd", "YTD"), ("perf_1y", "1Y")):
        for v in (0, 10, 25):
            P.append(_p(f"{k}_up_{v}", f"{label} performance > {v}%", "Performance", [_c(k, "gt", v)]))
        for v in (0, 10):
            P.append(_p(f"{k}_down_{v}", f"{label} performance < -{v}%", "Performance", [_c(k, "lt", -v)]))
    for v in (1, 3, 5):
        P.append(_p(f"day_up_{v}", f"Up {v}%+ today", "Price", [_c("change_pct", "gt", v)]))
        P.append(_p(f"day_down_{v}", f"Down {v}%+ today", "Price", [_c("change_pct", "lt", -v)]))
    P += [_p("gap_up", "Gap up > 1%", "Price", [_c("gap_pct", "gt", 1)]),
          _p("gap_down", "Gap down > 1%", "Price", [_c("gap_pct", "lt", -1)]),
          _p("wide_range", "Wide day range (> 3%)", "Price", [_c("day_range_pct", "gt", 3)]),
          _p("price_lt_10", "Price under $10", "Price", [_c("price", "lt", 10)]),
          _p("price_10_100", "Price $10-$100", "Price", [_c("price", "between", [10, 100])]),
          _p("price_gt_100", "Price over $100", "Price", [_c("price", "gt", 100)])]
    for v in (1.5, 2, 3):
        P.append(_p(f"relvol_{v}", f"Relative volume > {v}x", "Volume", [_c("rel_volume", "gt", v)]))
    P += [_p("relvol_low", "Relative volume < 0.5x", "Volume", [_c("rel_volume", "lt", 0.5)]),
          _p("dollar_vol_1b", "Dollar volume > $1B", "Volume", [_c("dollar_volume", "gt", 1e9)]),
          _p("dollar_vol_100m", "Dollar volume > $100M", "Volume", [_c("dollar_volume", "gt", 1e8)])]
    P += [_p("bb_below", "Below lower Bollinger band", "Volatility", [_c("bb_pctb", "lt", 0)]),
          _p("bb_above", "Above upper Bollinger band", "Volatility", [_c("bb_pctb", "gt", 1)]),
          _p("bb_squeeze", "Bollinger squeeze (width < 5%)", "Volatility", [_c("bb_width", "lt", 5)]),
          _p("bb_expansion", "Bollinger expansion (width > 15%)", "Volatility", [_c("bb_width", "gt", 15)])]
    for v in (1, 2, 4):
        P.append(_p(f"atr_gt_{v}", f"ATR > {v}% of price", "Volatility", [_c("atr_pct", "gt", v)]))
    for v in (10, 20, 40, 60):
        P.append(_p(f"vol_lt_{v}", f"Volatility under {v}%", "Volatility", [_c("volatility_30d", "lt", v)]))
    P += [_p("vol_gt_80", "Volatility over 80%", "Volatility", [_c("volatility_30d", "gt", 80)]),
          _p("beta_high", "High beta (> 1.5)", "Risk", [_c("beta", "gt", 1.5)]),
          _p("beta_low", "Low beta (< 0.8)", "Risk", [_c("beta", "lt", 0.8)]),
          _p("beta_neg", "Negative beta (hedge)", "Risk", [_c("beta", "lt", 0)]),
          _p("dd_small", "Max drawdown 1Y better than -15%", "Risk", [_c("max_drawdown_1y", "gt", -15)]),
          _p("dd_big", "Max drawdown 1Y worse than -40%", "Risk", [_c("max_drawdown_1y", "lt", -40)]),
          _p("sharpe_gt_1", "Sharpe 1Y > 1", "Risk", [_c("sharpe_1y", "gt", 1)]),
          _p("sharpe_gt_2", "Sharpe 1Y > 2", "Risk", [_c("sharpe_1y", "gt", 2)]),
          _p("sharpe_neg", "Sharpe 1Y negative", "Risk", [_c("sharpe_1y", "lt", 0)])]
    for v in (2, 5, 10):
        P.append(_p(f"near_high_{v}", f"Within {v}% of 52W high", "52-week", [_c("dist_52w_high", "gt", -v)]))
    for v in (10, 25):
        P.append(_p(f"near_low_{v}", f"Within {v}% of 52W low", "52-week", [_c("dist_52w_low", "lt", v)]))
    P += [_p("far_from_high", "30%+ below 52W high", "52-week", [_c("dist_52w_high", "lt", -30)]),
          _p("new_high", "New 52-week high", "52-week", [_c("new_52w_high", "eq", True)]),
          _p("new_low", "New 52-week low", "52-week", [_c("new_52w_low", "eq", True)]),
          _p("up_3", "Up 3+ days in a row", "Pattern", [_c("up_streak", "gte", 3)]),
          _p("down_3", "Down 3+ days in a row", "Pattern", [_c("down_streak", "gte", 3)]),
          _p("inside", "Inside day", "Pattern", [_c("inside_day", "eq", True)]),
          _p("open_now", "Market open now", "Descriptive", [_c("market_open", "eq", True)])]
    for ac in ("crypto", "stock", "forex", "commodity", "index"):
        P.append(_p(f"class_{ac}", f"Asset class: {ac}", "Descriptive", [_c("asset_class", "eq", ac)]))
    for sec in sorted({i.sector for i in INSTRUMENTS if i.asset_class == "stock"}):
        P.append(_p("sector_" + sec.lower().replace(" ", "_"), f"Sector: {sec}", "Descriptive", [_c("sector", "eq", sec)]))
    # strategy combos
    P += [_p("oversold_uptrend", "Oversold pullback in uptrend", "Strategies",
             [_c("rsi_14", "lt", 40), _c("above_sma200", "eq", True)]),
          _p("momentum_leaders", "Momentum leaders", "Strategies",
             [_c("perf_3m", "gt", 10), _c("above_sma50", "eq", True), _c("rsi_14", "between", [50, 75])]),
          _p("breakout_volume", "Breakout on volume", "Strategies", [_c("dist_52w_high", "gt", -2), _c("rel_volume", "gt", 1.5)]),
          _p("mean_reversion_long", "Mean-reversion long setup", "Strategies", [_c("bb_pctb", "lt", 0.05), _c("rsi_14", "lt", 35)]),
          _p("mean_reversion_short", "Mean-reversion short setup", "Strategies", [_c("bb_pctb", "gt", 0.95), _c("rsi_14", "gt", 65)]),
          _p("low_vol_quality", "Low-volatility quality", "Strategies", [_c("volatility_30d", "lt", 25), _c("sharpe_1y", "gt", 0.5)]),
          _p("falling_knife", "Falling knives (avoid)", "Strategies", [_c("perf_1m", "lt", -15), _c("above_sma200", "eq", False)]),
          _p("trend_squeeze", "Squeeze in uptrend", "Strategies", [_c("bb_width", "lt", 8), _c("golden_cross", "eq", True)])]
    return P


PRESETS = build_presets()
PRESET_BY_ID = {p["id"]: p for p in PRESETS}


def _pct(a, b):
    return (a / b - 1) * 100 if b else None


def _row(inst: Instrument, spx_r: np.ndarray | None) -> dict | None:
    try:
        candles = market.get_history(inst.symbol, "1D", 300)["candles"]
        q = market.get_quote(inst.symbol)
    except HTTPException:
        return None
    if len(candles) < 30:
        return None
    c = np.array([x["c"] for x in candles], dtype=float)
    h = np.array([x["h"] for x in candles], dtype=float)
    l = np.array([x["l"] for x in candles], dtype=float)
    v = np.array([x["v"] for x in candles], dtype=float)
    price = q["price"]
    c[-1] = price
    last = lambda a: (float(a[-1]) if len(a) and np.isfinite(a[-1]) else None)  # noqa: E731
    sma20, sma50, sma200 = ind.sma(c, 20), ind.sma(c, 50), ind.sma(c, 200)
    m, s, hist = ind.macd(c)
    up, mid, lo = ind.bollinger(c, 20, 2)
    k, _ = ind.stochastic(h, l, c)
    atr = ind.atr(h, l, c, 14)
    lr = np.diff(np.log(c))
    year = c[-252:]
    ytd_start = None
    y0 = datetime(datetime.now(timezone.utc).year, 1, 1, tzinfo=timezone.utc).timestamp()
    for x in candles:
        if x["t"] >= y0:
            ytd_start = x["o"]
            break
    up_streak = down_streak = 0
    for i in range(len(c) - 1, 0, -1):
        if c[i] > c[i - 1] and down_streak == 0:
            up_streak += 1
        elif c[i] < c[i - 1] and up_streak == 0:
            down_streak += 1
        else:
            break
    ppy = 365 if inst.is_24_7 else 252
    r1y = lr[-252:]
    beta = None
    if spx_r is not None and len(spx_r) > 30 and inst.symbol != "SPX":
        n = min(len(spx_r), len(lr), 250)
        a, b = lr[-n:], spx_r[-n:]
        if np.var(b) > 0:
            beta = float(np.cov(a, b)[0, 1] / np.var(b, ddof=1))
    peak = np.maximum.accumulate(year)
    avg_v20 = float(v[-21:-1].mean()) if len(v) > 21 else float(v.mean())
    cur_vol = q.get("volume") or float(v[-1])
    mb = last(m) is not None and last(s) is not None and last(m) > last(s)
    cross = any(np.isfinite(m[i]) and np.isfinite(s[i]) and m[i - 1] <= s[i - 1] and m[i] > s[i] for i in range(len(c) - 3, len(c)))
    row = {
        "symbol": inst.symbol, "display": inst.display, "name": inst.name, "asset_class": inst.asset_class, "sector": inst.sector,
        "price": price, "change_pct": q["change_pct"], "gap_pct": _pct(q["open"], q["prev_close"]),
        "day_range_pct": _pct(q["high"], q["low"]), "volume": cur_vol, "dollar_volume": cur_vol * price,
        "avg_volume_20": avg_v20, "rel_volume": cur_vol / avg_v20 if avg_v20 else None,
        "perf_1w": _pct(price, c[-6]) if len(c) > 6 else None, "perf_1m": _pct(price, c[-22]) if len(c) > 22 else None,
        "perf_3m": _pct(price, c[-64]) if len(c) > 64 else None, "perf_6m": _pct(price, c[-127]) if len(c) > 127 else None,
        "perf_ytd": _pct(price, ytd_start) if ytd_start else None, "perf_1y": _pct(price, year[0]),
        "rsi_14": last(ind.rsi(c, 14)), "rsi_7": last(ind.rsi(c, 7)), "stoch_k": last(k),
        "macd_hist": (last(hist) / price * 100) if last(hist) is not None else None, "macd_bullish": bool(mb), "macd_cross_up": bool(cross),
        "sma20_dist": _pct(price, last(sma20)) if last(sma20) else None, "sma50_dist": _pct(price, last(sma50)) if last(sma50) else None,
        "sma200_dist": _pct(price, last(sma200)) if last(sma200) else None,
        "above_sma20": bool(last(sma20) and price > last(sma20)), "above_sma50": bool(last(sma50) and price > last(sma50)),
        "above_sma200": bool(last(sma200) and price > last(sma200)),
        "golden_cross": bool(last(sma50) and last(sma200) and last(sma50) > last(sma200)),
        "ema_trend_up": bool(last(ind.ema(c, 9)) and last(ind.ema(c, 21)) and last(ind.ema(c, 9)) > last(ind.ema(c, 21))),
        "bb_pctb": ((price - last(lo)) / (last(up) - last(lo))) if last(up) and last(up) != last(lo) else None,
        "bb_width": ((last(up) - last(lo)) / last(mid) * 100) if last(mid) else None,
        "atr_pct": (last(atr) / price * 100) if last(atr) else None,
        "volatility_30d": float(lr[-30:].std(ddof=1) * math.sqrt(ppy) * 100) if len(lr) > 30 else None,
        "beta": beta, "max_drawdown_1y": float(((year - peak) / peak).min() * 100),
        "sharpe_1y": float(r1y.mean() / r1y.std(ddof=1) * math.sqrt(ppy)) if len(r1y) > 2 and r1y.std(ddof=1) > 0 else None,
        "dist_52w_high": _pct(price, float(h[-252:].max())), "dist_52w_low": _pct(price, float(l[-252:].min())),
        "new_52w_high": bool(price >= h[-252:-1].max()) if len(h) > 2 else False,
        "new_52w_low": bool(price <= l[-252:-1].min()) if len(l) > 2 else False,
        "up_streak": up_streak, "down_streak": down_streak,
        "inside_day": bool(len(h) > 2 and h[-1] <= h[-2] and l[-1] >= l[-2]),
        "market_open": bool(q.get("market_open")), "source": q.get("source"),
        "sparkline": [round(float(x), 6) for x in c[-30:]],
    }
    return {k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in row.items()}


def all_rows() -> list[dict]:
    def build():
        try:
            spx = np.diff(np.log(np.array(market.closes("SPX", "1D", 300), dtype=float)))
        except HTTPException:
            spx = None
        with ThreadPoolExecutor(max_workers=6) as ex:
            rows = list(ex.map(lambda i: _row(i, spx), INSTRUMENTS))
        return [r for r in rows if r]

    return cached("screener:rows", 120, build)


def _match(row: dict, cond: dict) -> bool:
    v = row.get(cond["field"])
    target = cond["value"]
    op = cond["op"]
    if v is None:
        return False
    try:
        if op == "gt":
            return v > target
        if op == "gte":
            return v >= target
        if op == "lt":
            return v < target
        if op == "lte":
            return v <= target
        if op == "eq":
            return v == target
        if op == "neq":
            return v != target
        if op == "between":
            return target[0] <= v <= target[1]
        if op == "in":
            return v in target
    except TypeError:
        return False
    return False


def validate_conditions(conds: list[dict]) -> list[dict]:
    clean = []
    for c in conds:
        f, op = c.get("field"), c.get("op")
        if f not in FIELDS:
            raise HTTPException(422, f"Unknown field '{f}'")
        if op not in OPS:
            raise HTTPException(422, f"Unknown operator '{op}'")
        val = c.get("value")
        kind = FIELDS[f][2]
        if op == "between" and not (isinstance(val, list) and len(val) == 2):
            raise HTTPException(422, "between needs [min, max]")
        if op == "in" and not isinstance(val, list):
            raise HTTPException(422, "in needs a list")
        if kind == "num" and op not in ("between", "in") and not isinstance(val, (int, float)):
            raise HTTPException(422, f"{f} needs a number")
        if kind == "bool" and op in ("eq", "neq") and not isinstance(val, bool):
            raise HTTPException(422, f"{f} needs true/false")
        clean.append({"field": f, "op": op, "value": val})
    return clean


def run(conditions: list[dict], presets: list[str], sort: str = "change_pct", desc: bool = True, limit: int = 100) -> dict:
    conds = validate_conditions(conditions)
    for pid in presets:
        if pid not in PRESET_BY_ID:
            raise HTTPException(422, f"Unknown preset '{pid}'")
        conds += PRESET_BY_ID[pid]["conditions"]
    if sort not in FIELDS and sort != "symbol":
        raise HTTPException(422, "Invalid sort field")
    rows = all_rows()
    hits = [r for r in rows if all(_match(r, c) for c in conds)]

    def key(r: dict):
        v = r.get(sort)
        if v is None:
            return (1, 0, "")
        if isinstance(v, (int, float)):
            return (0, -v if desc else v, "")
        return (0, 0, str(v))

    hits.sort(key=key)
    return {"total": len(hits), "universe": len(rows), "conditions": conds, "results": hits[:limit]}
