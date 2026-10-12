from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from .. import indicators as ind
from ..cache import get_cache
from ..market import providers as P
from ..market import service as market
from ..market.universe import INSTRUMENTS

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/instruments")
def instruments(asset_class: str | None = None, response: Response = None):
    response.headers["Cache-Control"] = "public, max-age=60"
    items = market.instruments()
    if asset_class:
        items = [i for i in items if i["asset_class"] == asset_class]
    return items


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=30)):
    ql = q.lower()
    out = [i.to_dict() for i in INSTRUMENTS if ql in i.symbol.lower() or ql in i.name.lower() or ql in i.display.lower()
           or any(ql in k for k in i.keywords)]
    return out[:20]


@router.get("/quotes")
def quotes(symbols: str | None = Query(default=None, max_length=1000), asset_class: str | None = None):
    syms = [s for s in (symbols or "").split(",") if s.strip()] or None
    qs = market.get_quotes(syms)
    if asset_class:
        qs = [q for q in qs if q["asset_class"] == asset_class]
    return qs


@router.get("/quote/{symbol}")
def quote(symbol: str):
    return market.get_quote(symbol)


@router.get("/history/{symbol}")
def history(symbol: str, response: Response, interval: str = "1D", limit: int = Query(default=300, ge=10, le=1000)):
    data = market.get_history(symbol, interval, limit)
    # CDN-cacheable: historical bars change slowly; short TTL for intraday
    ttl = market.HISTORY_TTL.get(data["interval"], 60)
    response.headers["Cache-Control"] = f"public, max-age={min(ttl, 60)}, s-maxage={ttl}, stale-while-revalidate={ttl * 2}"
    return data


@router.get("/indicators/{symbol}")
def indicators(
    symbol: str,
    interval: str = "1D",
    limit: int = Query(default=300, ge=30, le=1000),
    names: str = Query(default="sma20,sma50,rsi,macd,bollinger", max_length=200),
    rsi_period: int = Query(default=14, ge=2, le=100),
    bb_period: int = Query(default=20, ge=5, le=200),
    bb_k: float = Query(default=2.0, ge=0.5, le=5),
    macd_fast: int = Query(default=12, ge=2, le=100),
    macd_slow: int = Query(default=26, ge=3, le=200),
    macd_signal: int = Query(default=9, ge=2, le=100),
):
    data = market.get_history(symbol, interval, limit)
    try:
        out = ind.compute(data["candles"], [n.strip() for n in names.split(",") if n.strip()],
                          {"rsi": rsi_period, "bb": bb_period, "bb_k": bb_k, "fast": macd_fast, "slow": macd_slow, "signal": macd_signal})
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"symbol": data["symbol"], "interval": data["interval"], "source": data["source"], **out}


@router.get("/signals/{symbol}")
def signals(symbol: str, interval: str = "1D"):
    """Plain-English technical summary used by the dashboard."""
    c = market.get_history(symbol, interval, 300)["candles"]
    closes = [x["c"] for x in c]
    rsi = ind.rsi(closes)[-1]
    m, s, h = ind.macd(closes)
    up, mid, lo = ind.bollinger(closes)
    sma50, sma200 = ind.sma(closes, 50)[-1], ind.sma(closes, 200)[-1]
    price = closes[-1]
    votes, notes = 0, []
    if rsi == rsi:
        if rsi < 30:
            votes += 1; notes.append(f"RSI {rsi:.1f} is oversold")  # noqa: E702
        elif rsi > 70:
            votes -= 1; notes.append(f"RSI {rsi:.1f} is overbought")  # noqa: E702
        else:
            notes.append(f"RSI {rsi:.1f} is neutral")
    if m[-1] == m[-1] and s[-1] == s[-1]:
        votes += 1 if m[-1] > s[-1] else -1
        notes.append("MACD above signal (bullish momentum)" if m[-1] > s[-1] else "MACD below signal (bearish momentum)")
    if up[-1] == up[-1]:
        if price > up[-1]:
            notes.append("Price above upper Bollinger band (stretched)")
            votes -= 1
        elif price < lo[-1]:
            notes.append("Price below lower Bollinger band (stretched)")
            votes += 1
    if sma50 == sma50 and sma200 == sma200:
        votes += 1 if sma50 > sma200 else -1
        notes.append("SMA50 above SMA200 (long-term uptrend)" if sma50 > sma200 else "SMA50 below SMA200 (long-term downtrend)")
    verdict = "strong buy" if votes >= 3 else "buy" if votes >= 1 else "strong sell" if votes <= -3 else "sell" if votes <= -1 else "neutral"
    return {"symbol": symbol.upper(), "interval": interval, "score": votes, "verdict": verdict, "notes": notes}


@router.get("/movers")
def movers(limit: int = Query(default=5, ge=1, le=20)):
    return market.movers(limit)


@router.get("/status")
def status():
    return {"providers": P.configured_providers(), "feed": get_cache().get("feed:status"),
            "intervals": P.INTERVALS, "indicators": ind.SUPPORTED}
