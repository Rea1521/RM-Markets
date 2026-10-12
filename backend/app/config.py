"""Central configuration, read from environment variables.

Every value has a safe development default so `uvicorn app.main:app` works with
no setup (SQLite + in-memory cache). In production (Railway) set DATABASE_URL,
REDIS_URL and JWT_SECRET at minimum.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> list[str]:
    return [s.strip() for s in os.getenv(name, default).split(",") if s.strip()]


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./rm_markets.db")
    # Railway / Heroku style URLs
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


@dataclass(frozen=True)
class Settings:
    env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    database_url: str = field(default_factory=_db_url)
    redis_url: str | None = field(default_factory=lambda: os.getenv("REDIS_URL") or None)

    # --- auth ---
    jwt_secret: str = field(default_factory=lambda: os.getenv("JWT_SECRET", ""))
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = field(default_factory=lambda: int(os.getenv("ACCESS_TOKEN_MINUTES", "30")))
    refresh_token_days: int = field(default_factory=lambda: int(os.getenv("REFRESH_TOKEN_DAYS", "14")))
    google_client_id: str | None = field(default_factory=lambda: os.getenv("GOOGLE_CLIENT_ID") or None)
    allow_demo_login: bool = field(default_factory=lambda: _bool("ALLOW_DEMO_LOGIN", True))

    # --- service composition (microservices) ---
    # Which router groups this process serves: all | market | trading | analytics (comma separated)
    service_mode: list[str] = field(default_factory=lambda: _list("SERVICE_MODE", "all"))
    # Only ONE process should run the live feed + order matcher (the "market-data worker").
    run_market_feed: bool = field(default_factory=lambda: _bool("RUN_MARKET_FEED", True))

    # --- market data providers ---
    market_provider_mode: str = field(default_factory=lambda: os.getenv("MARKET_PROVIDER_MODE", "live"))  # live | sim
    alpha_vantage_key: str | None = field(default_factory=lambda: os.getenv("ALPHA_VANTAGE_API_KEY") or None)
    polygon_key: str | None = field(default_factory=lambda: os.getenv("POLYGON_API_KEY") or None)
    finnhub_key: str | None = field(default_factory=lambda: os.getenv("FINNHUB_API_KEY") or None)
    newsapi_key: str | None = field(default_factory=lambda: os.getenv("NEWSAPI_KEY") or None)
    stock_poll_seconds: float = field(default_factory=lambda: float(os.getenv("STOCK_POLL_SECONDS", "15")))

    # --- trading ---
    starting_balance: float = field(default_factory=lambda: float(os.getenv("STARTING_BALANCE", "100000")))
    risk_free_rate: float = field(default_factory=lambda: float(os.getenv("RISK_FREE_RATE", "0.05")))
    enforce_market_hours: bool = field(default_factory=lambda: _bool("ENFORCE_MARKET_HOURS", False))
    daily_loss_limit_pct: float = field(default_factory=lambda: float(os.getenv("DAILY_LOSS_LIMIT_PCT", "0.20")))
    max_position_pct: float = field(default_factory=lambda: float(os.getenv("MAX_POSITION_PCT", "1.0")))

    # --- http ---
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "*"))
    rate_limit_per_minute: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_PER_MINUTE", "240")))
    auth_rate_limit_per_minute: int = field(default_factory=lambda: int(os.getenv("AUTH_RATE_LIMIT_PER_MINUTE", "20")))
    order_rate_limit_per_minute: int = field(default_factory=lambda: int(os.getenv("ORDER_RATE_LIMIT_PER_MINUTE", "60")))
    cdn_base_url: str | None = field(default_factory=lambda: os.getenv("CDN_BASE_URL") or None)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def serves(self, group: str) -> bool:
        return "all" in self.service_mode or group in self.service_mode


_generated_secret = secrets.token_urlsafe(48)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.jwt_secret:
        if s.is_production:
            raise RuntimeError("JWT_SECRET must be set in production")
        object.__setattr__(s, "jwt_secret", os.getenv("DEV_JWT_SECRET", _generated_secret))
    return s
