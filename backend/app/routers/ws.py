"""Secure WebSocket endpoint for live prices and private account events.

Protocol (JSON):
  client -> {"op":"auth","token":"<access JWT>"}           (optional, enables private events)
  client -> {"op":"subscribe","symbols":["BTCUSDT","AAPL"]} ("*" = everything)
  client -> {"op":"unsubscribe","symbols":[...]}
  client -> {"op":"ping"}
  server -> welcome | snapshot | tick | order_filled | price_alert | ... | pong | heartbeat | error

Security: tokens are sent in the first message (not the URL, so they never land
in proxy logs), wss:// is enforced by the TLS-terminating proxy in production,
origin allow-list, message size + rate limits, bounded per-client queues.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..bus import get_bus
from ..config import get_settings
from ..db import SessionLocal
from ..market import service as market
from ..market.universe import resolve
from ..security import user_from_token

log = logging.getLogger("rm.ws")
router = APIRouter()

MAX_MSG_BYTES = 4096
MAX_SYMBOLS = 200
MAX_MSGS_PER_SEC = 20
HEARTBEAT_SECONDS = 25


class Client:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.user_id: int | None = None
        self.symbols: set[str] = set()
        self.all = False
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        self.msg_times: list[float] = []

    def offer(self, msg: dict) -> None:
        try:
            self.queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass  # slow client: drop ticks rather than blocking everyone


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()
        self.tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        bus = get_bus()
        self.tasks.append(asyncio.create_task(self._pump(bus.subscribe("ticks"), self._on_tick)))
        self.tasks.append(asyncio.create_task(self._pump(bus.subscribe("user:*"), self._on_user)))

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def _pump(self, it, handler):
        async for msg in it:
            try:
                handler(msg)
            except Exception:
                log.exception("ws hub handler failed")

    def _on_tick(self, msg: dict) -> None:
        sym = msg.get("symbol")
        for c in self.clients:
            if c.all or sym in c.symbols:
                c.offer(msg)

    def _on_user(self, msg: dict) -> None:
        ch = msg.pop("_channel", "")
        try:
            uid = int(ch.split(":", 1)[1])
        except (IndexError, ValueError):
            return
        for c in self.clients:
            if c.user_id == uid:
                c.offer(msg)


hub = Hub()


def _origin_ok(ws: WebSocket) -> bool:
    allowed = get_settings().cors_origins
    if "*" in allowed:
        return True
    origin = ws.headers.get("origin")
    return origin is None or origin in allowed  # native mobile apps send no Origin


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    if not _origin_ok(ws):
        await ws.close(code=4403)
        return
    await ws.accept()
    client = Client(ws)
    hub.clients.add(client)
    await ws.send_json({"type": "welcome", "server_time": time.time(), "heartbeat": HEARTBEAT_SECONDS})

    async def writer():
        while True:
            try:
                msg = await asyncio.wait_for(client.queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                msg = {"type": "heartbeat", "server_time": time.time()}
            await ws.send_text(json.dumps(msg, default=str))

    wtask = asyncio.create_task(writer())
    try:
        while True:
            raw = await ws.receive_text()
            now = time.time()
            client.msg_times = [t for t in client.msg_times if now - t < 1] + [now]
            if len(client.msg_times) > MAX_MSGS_PER_SEC:
                client.offer({"type": "error", "error": "rate_limited"})
                continue
            if len(raw) > MAX_MSG_BYTES:
                client.offer({"type": "error", "error": "message_too_large"})
                continue
            try:
                msg = json.loads(raw)
                op = msg.get("op")
            except (json.JSONDecodeError, AttributeError):
                client.offer({"type": "error", "error": "invalid_json"})
                continue
            if op == "ping":
                client.offer({"type": "pong", "server_time": now, "echo": msg.get("t")})
            elif op == "auth":
                token = msg.get("token")
                db = SessionLocal()
                try:
                    user = user_from_token(db, str(token)) if isinstance(token, str) else None
                    client.user_id = user.id if user else None
                    client.offer({"type": "auth", "ok": bool(user), "user_id": client.user_id})
                except Exception:
                    client.offer({"type": "auth", "ok": False, "error": "invalid_token"})
                finally:
                    db.close()
            elif op in ("subscribe", "unsubscribe"):
                syms = msg.get("symbols") or []
                if not isinstance(syms, list):
                    client.offer({"type": "error", "error": "symbols must be a list"})
                    continue
                if "*" in syms:
                    client.all = op == "subscribe"
                    syms = [s for s in syms if s != "*"]
                resolved = [resolve(str(s)) for s in syms[:MAX_SYMBOLS]]
                ids = {i.symbol for i in resolved if i}
                if op == "subscribe":
                    client.symbols |= ids
                    client.symbols = set(list(client.symbols)[:MAX_SYMBOLS])
                    snap = await asyncio.to_thread(market.get_quotes, sorted(ids) if ids else None) if (ids or client.all) else []
                    client.offer({"type": "snapshot", "quotes": snap})
                else:
                    client.symbols -= ids
                client.offer({"type": "subscribed", "symbols": sorted(client.symbols), "all": client.all})
            else:
                client.offer({"type": "error", "error": f"unknown op {op!r}"})
    except WebSocketDisconnect:
        pass
    except Exception as e:  # pragma: no cover
        log.info("ws closed with error: %s", e)
    finally:
        hub.clients.discard(client)
        wtask.cancel()
