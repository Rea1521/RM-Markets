"""GraphQL API (Strawberry) at /graphql - lets clients fetch exactly the fields
they need in one round trip (e.g. dashboard = account + watchlist quotes + news)."""
from __future__ import annotations

from typing import Optional

import strawberry
from fastapi import Request
from strawberry.extensions import SchemaExtension
from strawberry.fastapi import GraphQLRouter
from strawberry.scalars import JSON

from .db import SessionLocal
from .market import service as market
from .models import Order as OrderModel
from .models import User as UserModel
from .news import get_news
from .security import get_main_account, user_from_token
from .trading import engine


@strawberry.type
class Quote:
    symbol: str
    display: str
    name: str
    asset_class: str
    price: float
    change: float
    change_pct: float
    high: float
    low: float
    volume: float
    bid: float
    ask: float
    source: str


@strawberry.type
class Candle:
    t: int
    o: float
    h: float
    l: float  # noqa: E741
    c: float
    v: float


@strawberry.type
class Position:
    symbol: str
    display: str
    qty: float
    avg_price: float
    price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float


@strawberry.type
class Account:
    account_id: int
    cash: float
    equity: float
    total_pnl: float
    total_pnl_pct: float
    day_pnl: float
    buying_power: float
    margin_used: float
    positions: list[Position]


@strawberry.type
class Order:
    id: int
    symbol: str
    side: str
    type: str
    qty: float
    status: str
    filled_price: Optional[float]
    reason: Optional[str]


@strawberry.type
class NewsItem:
    title: str
    url: str
    source: str
    published_at: float
    sentiment: str
    symbols: list[str]


def _quote(q: dict) -> Quote:
    return Quote(**{k: q[k] for k in Quote.__annotations__})


class Ctx:
    def __init__(self, request: Request):
        self.request = request
        self.db = SessionLocal()
        self._user: UserModel | None = None

    def user(self) -> UserModel:
        if self._user:
            return self._user
        auth = self.request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            raise PermissionError("Authentication required")
        self._user = user_from_token(self.db, auth[7:])
        return self._user


@strawberry.type
class Query:
    @strawberry.field
    def quotes(self, symbols: Optional[list[str]] = None) -> list[Quote]:
        return [_quote(q) for q in market.get_quotes(symbols)]

    @strawberry.field
    def candles(self, symbol: str, interval: str = "1D", limit: int = 200) -> list[Candle]:
        return [Candle(**c) for c in market.get_history(symbol, interval, min(limit, 1000))["candles"]]

    @strawberry.field
    def indicators(self, symbol: str, interval: str = "1D", names: list[str] = ["rsi", "macd", "bollinger"]) -> JSON:  # noqa: B006
        from .indicators import compute

        return compute(market.get_history(symbol, interval, 300)["candles"], names)

    @strawberry.field
    def account(self, info: strawberry.Info) -> Account:
        ctx: Ctx = info.context["ctx"]
        acct = get_main_account(ctx.db, ctx.user())
        s = engine.account_summary(ctx.db, acct)
        return Account(
            account_id=s["account_id"], cash=s["cash"], equity=s["equity"], total_pnl=s["total_pnl"], total_pnl_pct=s["total_pnl_pct"],
            day_pnl=s["day_pnl"], buying_power=s["buying_power"], margin_used=s["margin_used"],
            positions=[Position(**{k: p[k] for k in Position.__annotations__}) for p in s["positions"]],
        )

    @strawberry.field
    def orders(self, info: strawberry.Info, status: Optional[str] = None, limit: int = 50) -> list[Order]:
        ctx: Ctx = info.context["ctx"]
        acct = get_main_account(ctx.db, ctx.user())
        q = ctx.db.query(OrderModel).filter(OrderModel.account_id == acct.id)
        if status:
            q = q.filter(OrderModel.status == status)
        return [Order(id=o.id, symbol=o.symbol, side=o.side, type=o.type, qty=o.qty, status=o.status,
                      filled_price=o.filled_price, reason=o.reason) for o in q.order_by(OrderModel.id.desc()).limit(min(limit, 200))]

    @strawberry.field
    def news(self, symbol: Optional[str] = None, limit: int = 20) -> list[NewsItem]:
        return [NewsItem(**{k: n[k] for k in NewsItem.__annotations__}) for n in get_news(symbol, limit=min(limit, 100))["items"]]


@strawberry.type
class Mutation:
    @strawberry.mutation
    def place_order(self, info: strawberry.Info, symbol: str, side: str, qty: float, type: str = "market",
                    limit_price: Optional[float] = None, stop_price: Optional[float] = None) -> Order:
        ctx: Ctx = info.context["ctx"]
        acct = get_main_account(ctx.db, ctx.user())
        o = engine.place_order(ctx.db, acct, engine.OrderRequest(symbol=symbol, side=side, qty=qty, type=type,
                                                                 limit_price=limit_price, stop_price=stop_price, source="api"))
        return Order(id=o.id, symbol=o.symbol, side=o.side, type=o.type, qty=o.qty, status=o.status, filled_price=o.filled_price, reason=o.reason)


class CloseSession(SchemaExtension):
    def on_operation(self):
        yield
        ctx = (self.execution_context.context or {}).get("ctx")
        if ctx:
            ctx.db.close()


schema = strawberry.Schema(query=Query, mutation=Mutation, extensions=[CloseSession])


async def get_context(request: Request):
    return {"ctx": Ctx(request), "request": request}


def graphql_router() -> GraphQLRouter:
    return GraphQLRouter(schema, context_getter=get_context, path="/graphql")
