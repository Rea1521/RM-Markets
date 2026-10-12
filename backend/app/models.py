"""ORM models. Works on SQLite (dev) and PostgreSQL (prod)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def ts_col(**kw):
    return mapped_column(DateTime(timezone=True), default=utcnow, **kw)


# ---------------------------------------------------------------- users / auth
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    oauth_subject: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="trader")
    title: Mapped[str] = mapped_column(String(40), default="Pro Trader")
    bio: Mapped[str] = mapped_column(String(280), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = ts_col()

    accounts: Mapped[list["Account"]] = relationship(back_populates="user")


# ---------------------------------------------------------------- accounts / trading
class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    competition_id: Mapped[int | None] = mapped_column(ForeignKey("competitions.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(60), default="Main")
    cash: Mapped[float] = mapped_column(Float)
    starting_balance: Mapped[float] = mapped_column(Float)
    net_deposits: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    created_at: Mapped[datetime] = ts_col()

    user: Mapped[User] = relationship(back_populates="accounts")
    positions: Mapped[list["Position"]] = relationship(back_populates="account", cascade="all, delete-orphan")


class Position(Base):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("account_id", "symbol", name="uq_position_account_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    asset_class: Mapped[str] = mapped_column(String(20))
    qty: Mapped[float] = mapped_column(Float, default=0.0)  # negative = short
    avg_price: Mapped[float] = mapped_column(Float, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    opened_at: Mapped[datetime] = ts_col()
    updated_at: Mapped[datetime] = ts_col(onupdate=utcnow)

    account: Mapped[Account] = relationship(back_populates="positions")


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_status_symbol", "status", "symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20))
    side: Mapped[str] = mapped_column(String(4))  # buy | sell
    type: Mapped[str] = mapped_column(String(16))  # market | limit | stop | stop_limit | trailing_stop
    qty: Mapped[float] = mapped_column(Float)
    limit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    trail_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    trail_anchor: Mapped[float | None] = mapped_column(Float, nullable=True)
    time_in_force: Mapped[str] = mapped_column(String(4), default="gtc")  # gtc | day
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending|filled|cancelled|rejected|expired
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    oco_group: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    filled_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(12), default="web")  # web|mobile|voice|api
    created_at: Mapped[datetime] = ts_col()


class Trade(Base):
    """An execution (fill)."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(40))
    asset_class: Mapped[str] = mapped_column(String(20))
    side: Mapped[str] = mapped_column(String(4))
    qty: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    closes_position: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = ts_col(index=True)


class OptionPosition(Base):
    __tablename__ = "option_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    underlying: Mapped[str] = mapped_column(String(20))
    option_type: Mapped[str] = mapped_column(String(4))  # call | put
    strike: Mapped[float] = mapped_column(Float)
    expiry: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    contracts: Mapped[float] = mapped_column(Float)  # negative = written
    multiplier: Mapped[float] = mapped_column(Float, default=100)
    avg_premium: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | closed | expired
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = ts_col()


class EquitySnapshot(Base):
    __tablename__ = "equity_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    ts: Mapped[datetime] = ts_col(index=True)
    equity: Mapped[float] = mapped_column(Float)
    cash: Mapped[float] = mapped_column(Float)


# ---------------------------------------------------------------- event sourcing
class Event(Base):
    """Append-only audit log. Account state can be rebuilt from these events."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    aggregate_type: Mapped[str] = mapped_column(String(30))
    aggregate_id: Mapped[int] = mapped_column(Integer, index=True)
    type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = ts_col()


# ---------------------------------------------------------------- watchlists / alerts
class WatchlistItem(Base):
    __tablename__ = "watchlist"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_watch_user_symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    condition: Mapped[str] = mapped_column(String(6))  # above | below
    price: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(140), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = ts_col()


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(140))
    body: Mapped[str] = mapped_column(String(500), default="")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = ts_col()


# ---------------------------------------------------------------- journal
class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trade_id: Mapped[int | None] = mapped_column(ForeignKey("trades.id", ondelete="SET NULL"), nullable=True)
    symbol: Mapped[str | None] = mapped_column(String(20), nullable=True)
    title: Mapped[str] = mapped_column(String(140))
    body: Mapped[str] = mapped_column(Text, default="")
    setup: Mapped[str] = mapped_column(String(60), default="")
    emotion: Mapped[str] = mapped_column(String(30), default="neutral")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    rating: Mapped[int] = mapped_column(Integer, default=3)  # 1-5 execution quality
    pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = ts_col()


# ---------------------------------------------------------------- social
class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(String(1000))
    symbols: Mapped[list] = mapped_column(JSON, default=list)
    sentiment: Mapped[str] = mapped_column(String(8), default="neutral")  # bullish|bearish|neutral
    created_at: Mapped[datetime] = ts_col(index=True)

    author: Mapped[User] = relationship()


class PostLike(Base):
    __tablename__ = "post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_like"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = ts_col()

    author: Mapped[User] = relationship()


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "followee_id", name="uq_follow"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    followee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


# ---------------------------------------------------------------- competitions
class Competition(Base):
    __tablename__ = "competitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(1000), default="")
    starting_balance: Mapped[float] = mapped_column(Float, default=100000)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    prize: Mapped[str] = mapped_column(String(200), default="")
    prize_pool: Mapped[float] = mapped_column(Float, default=0.0)
    sponsor: Mapped[str] = mapped_column(String(80), default="")
    allowed_asset_classes: Mapped[list] = mapped_column(JSON, default=list)
    max_participants: Mapped[int] = mapped_column(Integer, default=1000)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(10), default="scheduled")  # scheduled|active|finished
    winners: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = ts_col()


class CompetitionEntry(Base):
    __tablename__ = "competition_entries"
    __table_args__ = (UniqueConstraint("competition_id", "user_id", name="uq_comp_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(ForeignKey("competitions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    joined_at: Mapped[datetime] = ts_col()


# ---------------------------------------------------------------- ML
class MLModel(Base):
    __tablename__ = "ml_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    interval: Mapped[str] = mapped_column(String(6))
    algorithm: Mapped[str] = mapped_column(String(40))
    features: Mapped[list] = mapped_column(JSON)
    weights: Mapped[dict] = mapped_column(JSON)
    metrics: Mapped[dict] = mapped_column(JSON)
    trained_at: Mapped[datetime] = ts_col()


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20))
    strategy: Mapped[str] = mapped_column(String(40))
    params: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = ts_col()
