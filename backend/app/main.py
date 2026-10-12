"""RM Markets API - application factory.

One codebase, deployable either as a single service (Railway default:
SERVICE_MODE=all) or as separate microservices:

  SERVICE_MODE=market     RUN_MARKET_FEED=true    -> market data + websocket + feed worker
  SERVICE_MODE=trading    RUN_MARKET_FEED=false   -> auth, trading, social, journal, competitions
  SERVICE_MODE=analytics  RUN_MARKET_FEED=false   -> analytics, backtests, options, ML, screener

Services talk through Redis (pub/sub for ticks & user events, shared cache for quotes).
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text

from .bus import get_bus
from .cache import get_cache
from .config import get_settings
from .db import SessionLocal, engine, init_db
from .middleware import RateLimitMiddleware, SecurityHeadersMiddleware, install_error_handlers

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("rm")
VERSION = "2.0.0"


def seed(db) -> None:
    """Idempotent seed: a house competition so the feature works out of the box."""
    from .models import Competition, User

    if db.query(Competition).count():
        return
    house = db.query(User).filter(User.username == "rm_markets").first()
    if not house:
        house = User(email="house@rm-markets.local", username="rm_markets", display_name="RM Markets", role="admin", title="Official")
        db.add(house)
        db.flush()
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=32)).replace(day=1)
    db.add(Competition(name=f"{start:%B} Open Championship", description="Monthly multi-asset paper trading championship. Everyone starts with $100,000. Highest % return wins.",
                       starting_balance=100_000, start_at=start, end_at=end, prize="Top 3 featured on the leaderboard + certificate",
                       sponsor="RM Markets", allowed_asset_classes=[], created_by=house.id, status="active"))
    db.add(Competition(name="Crypto Sprint", description="One-week crypto-only sprint. Spot only, no leverage.", starting_balance=10_000,
                       start_at=now, end_at=now + timedelta(days=7), prize="Crypto Sprint champion badge", sponsor="RM Markets",
                       allowed_asset_classes=["crypto"], created_by=house.id, status="active"))
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    init_db()
    with SessionLocal() as db:
        seed(db)
    get_bus().bind_loop(asyncio.get_running_loop())
    from .routers.ws import hub

    await hub.start()
    feed = None
    if s.run_market_feed and s.serves("market"):
        from .market.feed import MarketFeed

        feed = MarketFeed()
        await feed.start()
    log.info("RM Markets API %s up (services=%s, feed=%s, cache=%s, db=%s)", VERSION, s.service_mode, bool(feed),
             get_cache().backend, "sqlite" if s.is_sqlite else "postgres")
    yield
    if feed:
        await feed.stop()
    await hub.stop()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="RM Markets API", version=VERSION, lifespan=lifespan,
                  description="Demo trading platform: live market data, paper trading, analytics, backtesting, options, ML.")
    install_error_handlers(app)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials="*" not in s.cors_origins,
                       allow_methods=["*"], allow_headers=["*"], expose_headers=["X-RateLimit-Remaining", "X-Request-ID"])

    from .routers import analytics, auth, community, competitions, market, trading, ws

    if s.serves("market"):
        app.include_router(market.router)
        app.include_router(ws.router)
    if s.serves("trading"):
        app.include_router(auth.router)
        app.include_router(trading.router)
        app.include_router(community.router)
        app.include_router(competitions.router)
    if s.serves("analytics"):
        app.include_router(analytics.router)
    if s.serves("trading"):
        from .graphql_schema import graphql_router

        app.include_router(graphql_router())

    @app.get("/health", tags=["ops"])
    def health():
        db_ok = True
        try:
            with engine.connect() as c:
                c.execute(text("SELECT 1"))
        except Exception:
            db_ok = False
        cache = get_cache()
        return {"status": "ok" if db_ok else "degraded", "version": VERSION, "services": s.service_mode,
                "db": db_ok, "cache": cache.backend, "cache_ok": cache.ping(), "instance": os.getenv("HOSTNAME", "local")}

    @app.get("/", tags=["ops"])
    def root():
        return {"name": "RM Markets API", "version": VERSION, "docs": "/docs", "graphql": "/graphql", "websocket": "/ws"}

    return app


app = create_app()
