"""Pub/sub event bus that connects the microservices.

* In-process (single instance / dev): asyncio fan-out.
* Redis (multi-instance / prod): Redis pub/sub so every API replica receives
  ticks from the single market-data worker and can push them to its own
  WebSocket clients.

Channels:
  ticks          -> price updates  {"type":"tick", "symbol":..., ...}
  user:<id>      -> private events (fills, alerts, notifications)
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator

from .config import get_settings

log = logging.getLogger("rm.bus")


class InMemoryBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        for q in list(self._subs.get(channel, ())):
            if q.qsize() > 1000:
                continue  # slow consumer: drop
            q.put_nowait(message)
        # pattern subscribers ("user:*")
        if ":" in channel:
            prefix = channel.split(":", 1)[0] + ":*"
            for q in list(self._subs.get(prefix, ())):
                if q.qsize() <= 1000:
                    q.put_nowait({**message, "_channel": channel})

    def publish_threadsafe(self, channel: str, message: dict[str, Any]) -> None:
        """Called from sync code (DB worker threads)."""
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.publish(channel, message), self._loop)

    async def subscribe(self, channel: str) -> AsyncIterator[dict[str, Any]]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(channel, set()).add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subs[channel].discard(q)

    async def close(self) -> None:
        pass


class RedisBus:
    def __init__(self, url: str) -> None:
        import redis
        import redis.asyncio as aioredis

        self._url = url
        self.r = aioredis.Redis.from_url(url, decode_responses=True)
        self._sync = redis.Redis.from_url(url, decode_responses=True)

    def bind_loop(self, loop) -> None:  # noqa: D401 - parity with InMemoryBus
        pass

    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        try:
            await self.r.publish(channel, json.dumps(message, default=str))
        except Exception as e:
            log.warning("redis publish failed: %s", e)

    def publish_threadsafe(self, channel: str, message: dict[str, Any]) -> None:
        try:
            self._sync.publish(channel, json.dumps(message, default=str))
        except Exception as e:
            log.warning("redis publish failed: %s", e)

    async def subscribe(self, channel: str) -> AsyncIterator[dict[str, Any]]:
        backoff = 1.0
        while True:
            pubsub = self.r.pubsub()
            try:
                if channel.endswith("*"):
                    await pubsub.psubscribe(channel)
                else:
                    await pubsub.subscribe(channel)
                backoff = 1.0
                async for msg in pubsub.listen():
                    if msg.get("type") not in ("message", "pmessage"):
                        continue
                    data = json.loads(msg["data"])
                    if msg.get("type") == "pmessage":
                        data["_channel"] = msg["channel"]
                    yield data
            except asyncio.CancelledError:
                raise
            except Exception as e:  # reconnect with backoff
                log.warning("redis subscribe error on %s: %s (retry in %.0fs)", channel, e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            finally:
                try:
                    await pubsub.aclose()
                except Exception:
                    pass

    async def close(self) -> None:
        await self.r.aclose()


_bus: InMemoryBus | RedisBus | None = None


def get_bus() -> InMemoryBus | RedisBus:
    global _bus
    if _bus is None:
        url = get_settings().redis_url
        _bus = RedisBus(url) if url else InMemoryBus()
    return _bus


def reset_bus() -> None:
    global _bus
    _bus = None
