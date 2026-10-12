"""Live market feed (runs in the market-data worker process).

* Binance websocket for crypto (true streaming, reconnects with backoff)
* Polls Finnhub / Yahoo for stocks, FX, commodities and indices
* Simulated ticks only for instruments with no reachable live source
* Publishes throttled ticks on the bus, writes a quote snapshot to the shared
  cache every second, and drives the order matcher / alert checker / risk checks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time

from ..bus import get_bus
from ..cache import get_cache
from ..config import get_settings
from ..db import SessionLocal
from . import providers as P
from .service import LOCAL_QUOTES, build_quote, market_status
from .universe import INSTRUMENTS, Instrument

log = logging.getLogger("rm.feed")


class MarketFeed:
    def __init__(self) -> None:
        self.s = get_settings()
        self.tasks: list[asyncio.Task] = []
        self.dirty: set[str] = set()
        self.last_pub: dict[str, float] = {}
        self.status: dict[str, dict] = {}
        self.sim_symbols: set[str] = set()

    # ------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        await self._bootstrap()
        live = self.s.market_provider_mode != "sim"
        crypto = [i for i in INSTRUMENTS if i.asset_class == "crypto"]
        others = [i for i in INSTRUMENTS if i.asset_class != "crypto"]
        if live:
            self.tasks.append(asyncio.create_task(self._binance_ws(crypto), name="binance-ws"))
            self.tasks.append(asyncio.create_task(self._poll_loop(others), name="poller"))
        self.tasks.append(asyncio.create_task(self._sim_loop(), name="sim"))
        self.tasks.append(asyncio.create_task(self._flush_loop(), name="flush"))
        self.tasks.append(asyncio.create_task(self._engine_loop(), name="engine"))
        self.tasks.append(asyncio.create_task(self._housekeeping_loop(), name="housekeeping"))
        log.info("market feed started (mode=%s)", self.s.market_provider_mode)

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()

    # ------------------------------------------------------------ helpers
    async def _update(self, inst: Instrument, raw: dict, source: str) -> None:
        prev = LOCAL_QUOTES.get(inst.symbol)
        q = build_quote(inst, raw, source)
        if prev and prev.get("source") != "sim" and source == "sim":
            return  # never let a sim tick overwrite a live price
        LOCAL_QUOTES[inst.symbol] = q
        self.dirty.add(inst.symbol)
        now = time.time()
        if now - self.last_pub.get(inst.symbol, 0) >= 0.5:  # max 2 ticks/sec/symbol
            self.last_pub[inst.symbol] = now
            await get_bus().publish("ticks", {"type": "tick", **q})

    async def _bootstrap(self) -> None:
        live = self.s.market_provider_mode != "sim"
        crypto = [i for i in INSTRUMENTS if i.asset_class == "crypto"]
        if live:
            try:
                qs = await asyncio.to_thread(P.BinanceProvider().quotes, crypto)
                for i in crypto:
                    if i.symbol in qs:
                        await self._update(i, qs[i.symbol], "binance")
                self.status["binance"] = {"ok": True, "ts": time.time()}
            except Exception as e:
                log.warning("binance bootstrap failed: %s", e)
                self.status["binance"] = {"ok": False, "error": str(e)}
        for i in INSTRUMENTS:
            if i.symbol not in LOCAL_QUOTES and (not live or i.asset_class == "crypto"):
                await self._sim_seed(i)

    async def _sim_seed(self, inst: Instrument) -> None:
        self.sim_symbols.add(inst.symbol)
        await self._update(inst, P.sim().quote(inst), "sim")

    # ------------------------------------------------------------ binance websocket
    async def _binance_ws(self, insts: list[Instrument]) -> None:
        import websockets

        by = {i.binance.lower(): i for i in insts}
        url = P.BinanceProvider.WS + "?streams=" + "/".join(f"{s}@ticker" for s in by)
        backoff = 1.0
        while True:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20, max_size=2**22) as ws:
                    log.info("binance ws connected")
                    self.status["binance_ws"] = {"ok": True, "since": time.time()}
                    backoff = 1.0
                    async for msg in ws:
                        d = json.loads(msg).get("data", {})
                        inst = by.get(str(d.get("s", "")).lower())
                        if not inst:
                            continue
                        self.sim_symbols.discard(inst.symbol)
                        await self._update(inst, {
                            "price": float(d["c"]), "open": float(d["o"]), "high": float(d["h"]), "low": float(d["l"]),
                            "prev_close": float(d["o"]), "volume": float(d["v"]),
                            "bid": float(d.get("b") or d["c"]), "ask": float(d.get("a") or d["c"]),
                        }, "binance")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.status["binance_ws"] = {"ok": False, "error": str(e)}
                log.warning("binance ws error: %s (reconnect in %.0fs)", e, backoff)
                for i in insts:  # keep prices moving while disconnected
                    if i.symbol not in LOCAL_QUOTES:
                        await self._sim_seed(i)
                await asyncio.sleep(backoff + random.random())
                backoff = min(backoff * 2, 60)

    # ------------------------------------------------------------ polling (stocks, fx, indices, commodities)
    async def _poll_loop(self, insts: list[Instrument]) -> None:
        sem = asyncio.Semaphore(4)
        failures: dict[str, int] = {}

        async def one(inst: Instrument):
            async with sem:
                for p in P.quote_chain(inst):
                    if p.name == "sim":
                        break
                    try:
                        raw = await asyncio.to_thread(p.quote, inst)
                        failures[inst.symbol] = 0
                        self.sim_symbols.discard(inst.symbol)
                        await self._update(inst, raw, p.name)
                        self.status[p.name] = {"ok": True, "ts": time.time()}
                        return
                    except Exception as e:
                        self.status[p.name] = {"ok": False, "error": str(e)[:200]}
                failures[inst.symbol] = failures.get(inst.symbol, 0) + 1
                if inst.symbol not in LOCAL_QUOTES:
                    await self._sim_seed(inst)

        while True:
            # closed markets are polled less often
            due = [i for i in insts if market_status(i)["open"] or random.random() < 0.15 or i.symbol not in LOCAL_QUOTES]
            await asyncio.gather(*(one(i) for i in due))
            await asyncio.sleep(self.s.stock_poll_seconds)

    # ------------------------------------------------------------ sim fallback
    async def _sim_loop(self) -> None:
        sim = P.sim()
        from .universe import BY_SYMBOL

        while True:
            await asyncio.sleep(1.0)
            for sym in list(self.sim_symbols):
                inst = BY_SYMBOL[sym]
                if inst.asset_class != "crypto" and not market_status(inst)["open"]:
                    continue
                prev = LOCAL_QUOTES.get(sym)
                sim.live.setdefault(sym, prev["price"] if prev else inst.ref_price)
                price = sim.step(inst, 1.0 * 60)  # accelerated so the demo visibly moves
                base = prev or build_quote(inst, sim.quote(inst), "sim")
                await self._update(inst, {**base, "price": price, "bid": None, "ask": None}, "sim")

    # ------------------------------------------------------------ shared snapshot
    async def _flush_loop(self) -> None:
        cache = get_cache()
        while True:
            await asyncio.sleep(1.0)
            if self.dirty:
                self.dirty.clear()
                await asyncio.to_thread(cache.set, "quotes", dict(LOCAL_QUOTES), 3600)
                await asyncio.to_thread(cache.set, "feed:status", {"providers": self.status, "sim": sorted(self.sim_symbols), "ts": time.time()}, 3600)

    # ------------------------------------------------------------ trading engine hooks
    async def _engine_loop(self) -> None:
        from ..trading import engine

        def run():
            db = SessionLocal()
            try:
                quotes = dict(LOCAL_QUOTES)
                engine.match_pending(db, quotes)
                engine.check_alerts(db, quotes)
            finally:
                db.close()

        while True:
            await asyncio.sleep(1.0)
            try:
                await asyncio.to_thread(run)
            except Exception:
                log.exception("engine loop failed")

    async def _housekeeping_loop(self) -> None:
        from ..trading import engine
        from ..services.housekeeping import snapshot_all, update_competitions

        def run():
            db = SessionLocal()
            try:
                engine.maintenance_check(db)
                engine.settle_expired_options(db)
                update_competitions(db)
                snapshot_all(db)
            finally:
                db.close()

        while True:
            await asyncio.sleep(60 if self.s.env != "test" else 5)
            try:
                await asyncio.to_thread(run)
            except Exception:
                log.exception("housekeeping failed")


feed: MarketFeed | None = None
