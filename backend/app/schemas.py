"""Request validation (Pydantic). Every write endpoint takes one of these models,
so malformed input is rejected with 422 before touching business logic."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.]{3,30}$")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9/&\-\. ]{1,20}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _symbol(v: str) -> str:
    if not SYMBOL_RE.match(v):
        raise ValueError("invalid symbol")
    return v.upper()


# ---------------------------------------------------------------- auth
class RegisterIn(Strict):
    email: EmailStr
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=80)

    @field_validator("username")
    @classmethod
    def _u(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError("username may contain letters, numbers, _ and . only")
        return v.lower()

    @field_validator("password")
    @classmethod
    def _p(cls, v: str) -> str:
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("password must contain letters and numbers")
        return v


class LoginIn(Strict):
    identifier: str = Field(min_length=3, max_length=255, description="email or username")
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(Strict):
    refresh_token: str = Field(min_length=10, max_length=4096)


class GoogleIn(Strict):
    id_token: str = Field(min_length=10, max_length=8192)


class ProfileIn(Strict):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    title: str | None = Field(default=None, max_length=40)
    bio: str | None = Field(default=None, max_length=280)


class PasswordIn(Strict):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------- trading
class OrderIn(Strict):
    symbol: str
    side: Literal["buy", "sell"]
    qty: float = Field(gt=0, le=1e9)
    type: Literal["market", "limit", "stop", "stop_limit", "trailing_stop"] = "market"
    limit_price: float | None = Field(default=None, gt=0)
    stop_price: float | None = Field(default=None, gt=0)
    trail_percent: float | None = Field(default=None, ge=0.1, le=50)
    time_in_force: Literal["gtc", "day"] = "gtc"
    take_profit: float | None = Field(default=None, gt=0)
    stop_loss: float | None = Field(default=None, gt=0)
    account_id: int | None = None
    source: Literal["web", "mobile", "voice", "api", "widget"] = "web"

    v_symbol = field_validator("symbol")(lambda cls, v: _symbol(v))


class ClosePositionIn(Strict):
    qty: float | None = Field(default=None, gt=0)
    account_id: int | None = None


class FundsIn(Strict):
    amount: float = Field(gt=0, le=10_000_000)
    account_id: int | None = None


class ResetIn(Strict):
    starting_balance: float = Field(default=100_000, ge=1_000, le=10_000_000)


class WatchIn(Strict):
    symbol: str
    v_symbol = field_validator("symbol")(lambda cls, v: _symbol(v))


class AlertIn(Strict):
    symbol: str
    condition: Literal["above", "below"]
    price: float = Field(gt=0)
    note: str = Field(default="", max_length=140)
    v_symbol = field_validator("symbol")(lambda cls, v: _symbol(v))


class OptionOrderIn(Strict):
    underlying: str
    option_type: Literal["call", "put"]
    strike: float = Field(gt=0)
    expiry: datetime
    contracts: float = Field(description="positive = buy, negative = sell/write")
    account_id: int | None = None
    v_symbol = field_validator("underlying")(lambda cls, v: _symbol(v))


class PayoffLeg(Strict):
    type: Literal["call", "put", "stock"]
    strike: float | None = Field(default=None, gt=0)
    expiry: str | None = None
    qty: float
    premium: float | None = Field(default=None, ge=0)


class PayoffIn(Strict):
    underlying: str
    legs: list[PayoffLeg] = Field(min_length=1, max_length=8)


class BSIn(Strict):
    spot: float = Field(gt=0)
    strike: float = Field(gt=0)
    days: float = Field(ge=0, le=3650)
    volatility: float = Field(gt=0, le=5, description="annualised, 0.25 = 25%")
    rate: float = Field(default=0.05, ge=-0.05, le=0.5)
    option_type: Literal["call", "put"] = "call"


# ---------------------------------------------------------------- analytics
class StressIn(Strict):
    scenario: str | None = None
    custom_shocks: dict[str, float] | None = None  # asset_class or symbol -> fraction (e.g. -0.2)
    account_id: int | None = None

    @field_validator("custom_shocks")
    @classmethod
    def _s(cls, v):
        if v:
            if len(v) > 60:
                raise ValueError("too many shocks")
            for k, x in v.items():
                if not -1 <= x <= 5:
                    raise ValueError(f"shock for {k} must be between -1 and 5")
        return v


class BacktestIn(Strict):
    symbol: str
    strategy: str
    interval: Literal["1h", "4h", "1D", "1W"] = "1D"
    bars: int = Field(default=500, ge=100, le=1000)
    params: dict[str, float] = Field(default_factory=dict)
    fee_bps: float = Field(default=10, ge=0, le=200)
    allow_short: bool = False
    stop_loss_pct: float | None = Field(default=None, gt=0, le=90)
    initial: float = Field(default=10_000, gt=0, le=1e9)
    objective: Literal["sharpe", "total_return_pct", "sortino", "cagr_pct"] = "sharpe"
    windows: int = Field(default=5, ge=2, le=12)
    train_ratio: float = Field(default=0.7, ge=0.4, le=0.9)
    anchored: bool = False
    v_symbol = field_validator("symbol")(lambda cls, v: _symbol(v))


class ScreenCondition(Strict):
    field: str = Field(max_length=40)
    op: Literal["gt", "gte", "lt", "lte", "eq", "neq", "between", "in"]
    value: float | bool | str | list[float | str]


class ScreenIn(Strict):
    conditions: list[ScreenCondition] = Field(default_factory=list, max_length=30)
    presets: list[str] = Field(default_factory=list, max_length=30)
    sort: str = Field(default="change_pct", max_length=40)
    desc: bool = True
    limit: int = Field(default=100, ge=1, le=200)


class MLTrainIn(Strict):
    symbol: str
    interval: Literal["1h", "4h", "1D"] = "1D"
    v_symbol = field_validator("symbol")(lambda cls, v: _symbol(v))


# ---------------------------------------------------------------- social / journal / competitions
class PostIn(Strict):
    body: str = Field(min_length=1, max_length=1000)
    sentiment: Literal["bullish", "bearish", "neutral"] = "neutral"


class CommentIn(Strict):
    body: str = Field(min_length=1, max_length=500)


class JournalIn(Strict):
    title: str = Field(min_length=1, max_length=140)
    body: str = Field(default="", max_length=10000)
    symbol: str | None = None
    trade_id: int | None = None
    setup: str = Field(default="", max_length=60)
    emotion: Literal["confident", "neutral", "fearful", "greedy", "fomo", "revenge", "disciplined", "anxious"] = "neutral"
    tags: list[str] = Field(default_factory=list, max_length=10)
    rating: int = Field(default=3, ge=1, le=5)
    pnl: float | None = None

    @field_validator("tags")
    @classmethod
    def _t(cls, v):
        return [t.strip().lower()[:24] for t in v if t.strip()]


class CompetitionIn(Strict):
    name: str = Field(min_length=3, max_length=80)
    description: str = Field(default="", max_length=1000)
    starting_balance: float = Field(default=100_000, ge=1_000, le=10_000_000)
    start_at: datetime
    end_at: datetime
    prize: str = Field(default="", max_length=200)
    prize_pool: float = Field(default=0, ge=0, le=1_000_000)
    sponsor: str = Field(default="", max_length=80)
    allowed_asset_classes: list[Literal["crypto", "stock", "forex", "commodity", "index"]] = Field(default_factory=list)
    max_participants: int = Field(default=1000, ge=2, le=100000)


class VoiceIn(Strict):
    text: str = Field(min_length=1, max_length=300)
