"""Market data access used by every router (quotes, candles, market status).

Read order for quotes: local live feed -> shared cache (written by the feed
worker) -> on-demand provider fetch.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, time as dtime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from ..cache import cached, get_cache
from . import providers as P
from .universe import BY_SYMBOL, INSTRUMENTS, Instrument, resolve

log = logging.getLogger("rm.market")

HISTORY_TTL = {"1m": 20, "5m": 60, "15m": 120, "1h": 300, "4h": 600, "1D": 1800, "1W": 3600}
SPREAD_BPS = {"crypto": 1.0, "stock": 2.0, "forex": 0.6, "commodity": 2.5, "index": 1.5}

# set by MarketFeed when it runs in this process
LOCAL_QUOTES: dict[str, dict] = {}


def instrument_or_404(symbol: str) -> Instrument:
    inst = resolve(symbol)
    if not inst:
        raise HTTPException(404, f"Unknown symbol '{symbol}'")
    return inst


def build_quote(inst: Instrument, raw: dict, source: str) -> dict:
    price = float(raw["price"])
    prev = float(raw.get("prev_close") or price)
    half = price * SPREAD_BPS[inst.asset_class] / 20000
    bid = float(raw.get("bid") or price - half)
    ask = float(raw.get("ask") or price + half)
    if ask <= bid:
        bid, ask = price - half, price + half
    return {
        "symbol": inst.symbol, "display": inst.display, "name": inst.name, "asset_class": inst.asset_class,
        "price": price, "bid": bid, "ask": ask, "open": float(raw.get("open") or prev),
        "high": max(float(raw.get("high") or price), price), "low": min(float(raw.get("low") or price), price),
        "prev_close": prev, "change": price - prev, "change_pct": (price / prev - 1) * 100 if prev else 0.0,
        "volume": float(raw.get("volume") or 0), "ts": time.time(), "source": source,
        "market_open": market_status(inst)["open"],
    }


def fetch_quote_direct(inst: Instrument) -> dict:
    last_err = None
    for p in P.quote_chain(inst):
        try:
            raw = p.quote(inst)
            return build_quote(inst, raw, p.name)
        except Exception as e:  # try the next provider
            last_err = e
            log.debug("quote %s via %s failed: %s", inst.symbol, p.name, e)
    raise HTTPException(503, f"No market data for {inst.symbol}: {last_err}")


def get_quote(symbol: str) -> dict:
    inst = instrument_or_404(symbol)
    q = LOCAL_QUOTES.get(inst.symbol)
    if q:
        return q
    shared = get_cache().get("quotes") or {}
    if inst.symbol in shared:
        return shared[inst.symbol]
    return cached(f"quote:{inst.symbol}", 10, lambda: fetch_quote_direct(inst))


def get_quotes(symbols: list[str] | None = None) -> list[dict]:
    insts = [instrument_or_404(s) for s in symbols] if symbols else INSTRUMENTS
    allq = dict(get_cache().get("quotes") or {})
    allq.update(LOCAL_QUOTES)
    out = []
    for i in insts:
        q = allq.get(i.symbol)
        if not q:
            try:
                q = get_quote(i.symbol)
            except HTTPException:
                continue
        out.append(q)
    return out


def get_price(symbol: str) -> float:
    return float(get_quote(symbol)["price"])


def get_history(symbol: str, interval: str = "1D", limit: int = 300) -> dict:
    inst = instrument_or_404(symbol)
    try:
        iv = P.normalize_interval(interval)
    except ValueError as e:
        raise HTTPException(422, str(e))
    limit = max(10, min(int(limit), 1000))

    def load() -> dict:
        last_err = None
        for p in P.history_chain(inst):
            try:
                candles = p.history(inst, iv, limit)
                if len(candles) >= 5:
                    return {"symbol": inst.symbol, "interval": iv, "source": p.name, "candles": candles}
            except Exception as e:
                last_err = e
                log.info("history %s %s via %s failed: %s", inst.symbol, iv, p.name, e)
        raise HTTPException(503, f"No history for {inst.symbol}: {last_err}")

    data = cached(f"hist:{inst.symbol}:{iv}:{limit}", HISTORY_TTL[iv], load)
    # stitch the live price into the most recent candle so charts never look stale
    q = LOCAL_QUOTES.get(inst.symbol)
    if q and data["candles"]:
        last = dict(data["candles"][-1])
        last["c"] = q["price"]
        last["h"] = max(last["h"], q["price"])
        last["l"] = min(last["l"], q["price"])
        data = {**data, "candles": data["candles"][:-1] + [last]}
    return data


def closes(symbol: str, interval: str = "1D", limit: int = 300) -> list[float]:
    return [c["c"] for c in get_history(symbol, interval, limit)["candles"]]


# ---------------------------------------------------------------- market hours
_SESSIONS = {
    # tz, open, close
    "NASDAQ": ("America/New_York", dtime(9, 30), dtime(16, 0)),
    "NYSE": ("America/New_York", dtime(9, 30), dtime(16, 0)),
    "INDEX": ("America/New_York", dtime(9, 30), dtime(16, 0)),
    "NSE": ("Asia/Kolkata", dtime(9, 15), dtime(15, 30)),
    "JSE": ("Africa/Johannesburg", dtime(9, 0), dtime(17, 0)),
    "LSE": ("Europe/London", dtime(8, 0), dtime(16, 30)),
}


def market_status(inst: Instrument, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    if inst.asset_class == "crypto":
        return {"open": True, "session": "24/7"}
    if inst.asset_class in ("forex", "commodity"):
        ny = now.astimezone(ZoneInfo("America/New_York"))
        wd, t = ny.weekday(), ny.time()
        closed = wd == 5 or (wd == 4 and t >= dtime(17)) or (wd == 6 and t < dtime(17))
        return {"open": not closed, "session": "24/5"}
    tzname, o, c = _SESSIONS.get(inst.exchange, _SESSIONS["NYSE"])
    local = now.astimezone(ZoneInfo(tzname))
    is_open = local.weekday() < 5 and o <= local.time() < c
    return {"open": is_open, "session": f"{o:%H:%M}-{c:%H:%M} {tzname}"}


def instruments() -> list[dict]:
    return [{**i.to_dict(), **market_status(i)} for i in INSTRUMENTS]


def movers(limit: int = 5) -> dict:
    qs = [q for q in get_quotes() if q.get("prev_close")]
    qs.sort(key=lambda q: q["change_pct"], reverse=True)
    return {"gainers": qs[:limit], "losers": list(reversed(qs[-limit:])), "most_active": sorted(qs, key=lambda q: q["volume"] * q["price"], reverse=True)[:limit]}


def known(symbol: str) -> bool:
    return resolve(symbol) is not None


__all__ = ["get_quote", "get_quotes", "get_history", "get_price", "instrument_or_404", "BY_SYMBOL", "market_status"]
