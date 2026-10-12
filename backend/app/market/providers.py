"""Market data providers.

Candle format everywhere: {"t": epoch_seconds, "o":, "h":, "l":, "c":, "v":}

Live sources (no key needed):   Binance (crypto), Yahoo Finance (stocks/fx/indices/commodities)
Live sources (API key needed):  Polygon.io, Alpha Vantage, Finnhub
Fallback:                       Simulated (geometric Brownian motion) - clearly tagged source="sim"
"""
from __future__ import annotations

import hashlib
import logging
import math
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import numpy as np

from ..config import get_settings
from .universe import Instrument

log = logging.getLogger("rm.providers")

INTERVAL_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400, "1W": 604800}
INTERVALS = list(INTERVAL_SECONDS)
UA = {"User-Agent": "Mozilla/5.0 (RM Markets demo trading app)"}

_client: httpx.Client | None = None


def http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=httpx.Timeout(8.0, connect=4.0), headers=UA, follow_redirects=True)
    return _client


def normalize_interval(interval: str) -> str:
    m = {"1d": "1D", "d": "1D", "1w": "1W", "w": "1W", "60m": "1h", "1H": "1h", "4H": "4h"}
    iv = m.get(interval, interval)
    if iv not in INTERVAL_SECONDS:
        raise ValueError(f"Unsupported interval {interval}")
    return iv


def resample(candles: list[dict], factor: int) -> list[dict]:
    out: list[dict] = []
    for i in range(0, len(candles) - len(candles) % factor if len(candles) >= factor else 0, factor):
        chunk = candles[i : i + factor]
        out.append({
            "t": chunk[0]["t"], "o": chunk[0]["o"], "h": max(c["h"] for c in chunk),
            "l": min(c["l"] for c in chunk), "c": chunk[-1]["c"], "v": sum(c["v"] for c in chunk),
        })
    return out


class ProviderError(Exception):
    pass


# ---------------------------------------------------------------- Binance
class BinanceProvider:
    name = "binance"
    REST = "https://data-api.binance.vision"  # public market-data mirror, not geo-blocked
    WS = "wss://data-stream.binance.vision/stream"
    _iv = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1D": "1d", "1W": "1w"}

    def supports(self, inst: Instrument) -> bool:
        return bool(inst.binance)

    def history(self, inst: Instrument, interval: str, limit: int) -> list[dict]:
        r = http().get(f"{self.REST}/api/v3/klines", params={"symbol": inst.binance, "interval": self._iv[interval], "limit": min(limit, 1000)})
        r.raise_for_status()
        return [
            {"t": int(k[0]) // 1000, "o": float(k[1]), "h": float(k[2]), "l": float(k[3]), "c": float(k[4]), "v": float(k[5])}
            for k in r.json()
        ]

    def quote(self, inst: Instrument) -> dict:
        return self.quotes([inst])[inst.symbol]

    def quotes(self, insts: list[Instrument]) -> dict[str, dict]:
        syms = [i.binance for i in insts if i.binance]
        if not syms:
            return {}
        r = http().get(f"{self.REST}/api/v3/ticker/24hr", params={"symbols": "[" + ",".join(f'"{s}"' for s in syms) + "]"})
        r.raise_for_status()
        by = {i.binance: i for i in insts}
        out = {}
        for t in r.json():
            inst = by.get(t["symbol"])
            if inst:
                out[inst.symbol] = {
                    "price": float(t["lastPrice"]), "open": float(t["openPrice"]), "high": float(t["highPrice"]),
                    "low": float(t["lowPrice"]), "prev_close": float(t["openPrice"]), "volume": float(t["volume"]),
                    "bid": float(t.get("bidPrice") or t["lastPrice"]), "ask": float(t.get("askPrice") or t["lastPrice"]),
                }
        return out


# ---------------------------------------------------------------- Yahoo Finance
class YahooProvider:
    name = "yahoo"
    BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"
    _map = {"1m": ("1m", "5d"), "5m": ("5m", "1mo"), "15m": ("15m", "1mo"), "1h": ("60m", "6mo"),
            "4h": ("60m", "2y"), "1D": ("1d", "5y"), "1W": ("1wk", "10y")}

    def supports(self, inst: Instrument) -> bool:
        return bool(inst.yahoo)

    def _chart(self, ticker: str, interval: str, rng: str) -> dict:
        r = http().get(self.BASE + ticker, params={"interval": interval, "range": rng, "includePrePost": "false"})
        r.raise_for_status()
        res = r.json().get("chart", {}).get("result")
        if not res:
            raise ProviderError("yahoo: empty result")
        return res[0]

    def history(self, inst: Instrument, interval: str, limit: int) -> list[dict]:
        yiv, rng = self._map[interval]
        res = self._chart(inst.yahoo, yiv, rng)
        ts = res.get("timestamp") or []
        q = res["indicators"]["quote"][0]
        out = []
        for i, t in enumerate(ts):
            o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
            if None in (o, h, l, c):
                continue
            out.append({"t": int(t), "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": float(q["volume"][i] or 0)})
        if interval == "4h":
            out = resample(out, 4)
        return out[-limit:]

    def quote(self, inst: Instrument) -> dict:
        res = self._chart(inst.yahoo, "1m", "1d")
        m = res["meta"]
        price = float(m["regularMarketPrice"])
        prev = float(m.get("chartPreviousClose") or m.get("previousClose") or price)
        q = res["indicators"]["quote"][0]
        opens = [x for x in (q.get("open") or []) if x is not None]
        return {
            "price": price, "prev_close": prev, "open": float(opens[0]) if opens else prev,
            "high": float(m.get("regularMarketDayHigh") or price), "low": float(m.get("regularMarketDayLow") or price),
            "volume": float(m.get("regularMarketVolume") or 0),
        }


# ---------------------------------------------------------------- Polygon.io (API key)
class PolygonProvider:
    name = "polygon"
    BASE = "https://api.polygon.io"
    _iv = {"1m": (1, "minute"), "5m": (5, "minute"), "15m": (15, "minute"), "1h": (1, "hour"), "4h": (4, "hour"),
           "1D": (1, "day"), "1W": (1, "week")}

    def __init__(self, key: str):
        self.key = key

    def supports(self, inst: Instrument) -> bool:
        return bool(inst.polygon)

    def history(self, inst: Instrument, interval: str, limit: int) -> list[dict]:
        mult, span = self._iv[interval]
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=INTERVAL_SECONDS[interval] * limit * 2.2)
        r = http().get(
            f"{self.BASE}/v2/aggs/ticker/{inst.polygon}/range/{mult}/{span}/{start:%Y-%m-%d}/{end:%Y-%m-%d}",
            params={"adjusted": "true", "sort": "asc", "limit": 50000, "apiKey": self.key},
        )
        r.raise_for_status()
        rows = r.json().get("results") or []
        if not rows:
            raise ProviderError("polygon: no results")
        return [{"t": int(x["t"]) // 1000, "o": x["o"], "h": x["h"], "l": x["l"], "c": x["c"], "v": x.get("v", 0)} for x in rows][-limit:]


# ---------------------------------------------------------------- Alpha Vantage (API key)
class AlphaVantageProvider:
    name = "alphavantage"
    BASE = "https://www.alphavantage.co/query"

    def __init__(self, key: str):
        self.key = key

    def supports(self, inst: Instrument) -> bool:
        return bool(inst.alpha)

    def history(self, inst: Instrument, interval: str, limit: int) -> list[dict]:
        if inst.asset_class == "forex":
            fn = {"1D": "FX_DAILY", "1W": "FX_WEEKLY"}.get(interval, "FX_INTRADAY")
            params = {"function": fn, "from_symbol": inst.alpha[:3], "to_symbol": inst.alpha[3:]}
        else:
            fn = {"1D": "TIME_SERIES_DAILY", "1W": "TIME_SERIES_WEEKLY"}.get(interval, "TIME_SERIES_INTRADAY")
            params = {"function": fn, "symbol": inst.alpha}
        if fn.endswith("INTRADAY"):
            params["interval"] = {"1m": "1min", "5m": "5min", "15m": "15min", "1h": "60min", "4h": "60min"}[interval]
        params.update({"outputsize": "full" if limit > 100 else "compact", "apikey": self.key})
        r = http().get(self.BASE, params=params)
        r.raise_for_status()
        data = r.json()
        key = next((k for k in data if "Time Series" in k), None)
        if not key:
            raise ProviderError(f"alphavantage: {data.get('Note') or data.get('Information') or 'no data'}")
        out = []
        for ts, row in data[key].items():
            fmt = "%Y-%m-%d %H:%M:%S" if " " in ts else "%Y-%m-%d"
            t = int(datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc).timestamp())
            out.append({"t": t, "o": float(row["1. open"]), "h": float(row["2. high"]), "l": float(row["3. low"]),
                        "c": float(row["4. close"]), "v": float(row.get("5. volume", 0))})
        out.sort(key=lambda c: c["t"])
        if interval == "4h":
            out = resample(out, 4)
        return out[-limit:]


# ---------------------------------------------------------------- Finnhub (API key)
class FinnhubProvider:
    name = "finnhub"
    BASE = "https://finnhub.io/api/v1"

    def __init__(self, key: str):
        self.key = key

    def supports(self, inst: Instrument) -> bool:
        return inst.asset_class == "stock" and bool(inst.finnhub)

    def quote(self, inst: Instrument) -> dict:
        r = http().get(f"{self.BASE}/quote", params={"symbol": inst.finnhub, "token": self.key})
        r.raise_for_status()
        q = r.json()
        if not q.get("c"):
            raise ProviderError("finnhub: empty quote")
        return {"price": q["c"], "open": q["o"], "high": q["h"], "low": q["l"], "prev_close": q["pc"], "volume": 0.0}


# ---------------------------------------------------------------- Simulated fallback
class SimulatedProvider:
    """Deterministic GBM so charts are stable between requests. Used only when
    live providers are unreachable or MARKET_PROVIDER_MODE=sim (tests/offline)."""

    name = "sim"

    def __init__(self) -> None:
        self.live: dict[str, float] = {}

    def supports(self, inst: Instrument) -> bool:
        return True

    def _seed(self, *parts: Any) -> int:
        return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)

    def anchor(self, inst: Instrument) -> float:
        return self.live.get(inst.symbol, inst.ref_price)

    def history(self, inst: Instrument, interval: str, limit: int) -> list[dict]:
        step = INTERVAL_SECONDS[interval]
        now = int(time.time())
        last_t = now - now % step
        rng = np.random.default_rng(self._seed(inst.symbol, interval, last_t // (step * 50)))
        years = step / (365 * 86400 if inst.is_24_7 else 252 * 6.5 * 3600 if step < 86400 else 252 * 86400)
        sigma = inst.vol * math.sqrt(max(years, 1e-9))
        rets = rng.normal(0.0002 * sigma, sigma, limit)
        # mild regime / trend so indicators have something to find
        rets += np.sin(np.linspace(0, 6 * math.pi, limit)) * sigma * 0.15
        closes = np.exp(np.cumsum(rets))
        closes *= self.anchor(inst) / closes[-1]
        out = []
        prev = closes[0] * math.exp(-rets[0])
        for i, c in enumerate(closes):
            o = prev
            wig = abs(rng.normal(0, sigma * 0.6))
            h = max(o, c) * (1 + wig)
            l = min(o, c) * (1 - wig)
            v = float(abs(rng.normal(1, 0.35)) * 1_000 * (1 + abs(c / o - 1) * 80))
            out.append({"t": last_t - (limit - 1 - i) * step, "o": float(o), "h": float(h), "l": float(l), "c": float(c), "v": v})
            prev = c
        return out

    def quote(self, inst: Instrument) -> dict:
        day = self.history(inst, "1D", 2)
        price = self.anchor(inst)
        return {"price": price, "open": day[-1]["o"], "high": max(day[-1]["h"], price), "low": min(day[-1]["l"], price),
                "prev_close": day[-2]["c"], "volume": day[-1]["v"]}

    def step(self, inst: Instrument, dt_seconds: float) -> float:
        p = self.anchor(inst)
        sigma = inst.vol * math.sqrt(dt_seconds / (365 * 86400))
        p *= math.exp(random.gauss(0, sigma))
        self.live[inst.symbol] = p
        return p


# ---------------------------------------------------------------- registry
_sim = SimulatedProvider()


def sim() -> SimulatedProvider:
    return _sim


def history_chain(inst: Instrument) -> list:
    s = get_settings()
    if s.market_provider_mode == "sim":
        return [_sim]
    chain: list = []
    if inst.asset_class == "crypto":
        chain.append(BinanceProvider())
    if s.polygon_key:
        chain.append(PolygonProvider(s.polygon_key))
    chain.append(YahooProvider())
    if s.alpha_vantage_key:
        chain.append(AlphaVantageProvider(s.alpha_vantage_key))
    chain.append(_sim)
    return [p for p in chain if p.supports(inst)]


def quote_chain(inst: Instrument) -> list:
    s = get_settings()
    if s.market_provider_mode == "sim":
        return [_sim]
    chain: list = []
    if inst.asset_class == "crypto":
        chain.append(BinanceProvider())
    if s.finnhub_key:
        chain.append(FinnhubProvider(s.finnhub_key))
    chain.append(YahooProvider())
    chain.append(_sim)
    return [p for p in chain if p.supports(inst)]


def configured_providers() -> list[dict]:
    s = get_settings()
    return [
        {"name": "binance", "assets": ["crypto"], "enabled": s.market_provider_mode != "sim", "realtime": True},
        {"name": "yahoo", "assets": ["stock", "forex", "index", "commodity"], "enabled": s.market_provider_mode != "sim", "realtime": False},
        {"name": "polygon", "assets": ["stock", "forex", "crypto", "index"], "enabled": bool(s.polygon_key), "realtime": False},
        {"name": "alphavantage", "assets": ["stock", "forex"], "enabled": bool(s.alpha_vantage_key), "realtime": False},
        {"name": "finnhub", "assets": ["stock"], "enabled": bool(s.finnhub_key), "realtime": True},
        {"name": "sim", "assets": ["all"], "enabled": True, "realtime": True, "note": "fallback only"},
    ]
