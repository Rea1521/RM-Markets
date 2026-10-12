"""Cache layer: Redis when REDIS_URL is set, otherwise an in-process TTL cache.

Used for frequently accessed market data (quotes, candles, screener metrics,
news) so that multiple API instances share one view and upstream providers are
not hammered.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Callable

from .config import get_settings

log = logging.getLogger("rm.cache")


class MemoryCache:
    backend = "memory"

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            exp, raw = item
            if exp and exp < time.time():
                self._data.pop(key, None)
                return None
        return json.loads(raw)

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        raw = json.dumps(value, default=str)
        with self._lock:
            self._data[key] = (time.time() + ttl if ttl else 0, raw)

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)

    def incr_window(self, key: str, window: int) -> int:
        """Fixed-window counter used by the rate limiter."""
        with self._lock:
            now = time.time()
            exp, raw = self._data.get(key, (0, "0"))
            if exp and exp < now:
                raw = "0"
                exp = 0
            n = int(raw) + 1
            self._data[key] = (exp or now + window, str(n))
            return n

    def ping(self) -> bool:
        return True


class RedisCache:
    backend = "redis"

    def __init__(self, url: str) -> None:
        import redis

        self.r = redis.Redis.from_url(url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)

    def get(self, key: str) -> Any | None:
        try:
            raw = self.r.get(key)
        except Exception as e:  # degrade gracefully
            log.warning("redis get failed: %s", e)
            return None
        return json.loads(raw) if raw else None

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        try:
            raw = json.dumps(value, default=str)
            if ttl:
                self.r.set(key, raw, ex=max(1, int(ttl)))
            else:
                self.r.set(key, raw)
        except Exception as e:
            log.warning("redis set failed: %s", e)

    def delete(self, key: str) -> None:
        try:
            self.r.delete(key)
        except Exception:
            pass

    def incr_window(self, key: str, window: int) -> int:
        try:
            pipe = self.r.pipeline()
            pipe.incr(key)
            pipe.expire(key, window, nx=True)
            n, _ = pipe.execute()
            return int(n)
        except Exception:
            return 0  # fail open

    def ping(self) -> bool:
        try:
            return bool(self.r.ping())
        except Exception:
            return False


_cache: MemoryCache | RedisCache | None = None


def get_cache() -> MemoryCache | RedisCache:
    global _cache
    if _cache is None:
        url = get_settings().redis_url
        if url:
            c = RedisCache(url)
            if c.ping():
                _cache = c
                log.info("Using Redis cache")
            else:
                log.warning("Redis unreachable, falling back to memory cache")
                _cache = MemoryCache()
        else:
            _cache = MemoryCache()
    return _cache


def cached(key: str, ttl: float, fn: Callable[[], Any]) -> Any:
    c = get_cache()
    hit = c.get(key)
    if hit is not None:
        return hit
    val = fn()
    if val is not None:
        c.set(key, val, ttl)
    return val
