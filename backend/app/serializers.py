from __future__ import annotations

from .market.universe import resolve
from .models import Order, Post, Trade, User, aware


def iso(dt):
    dt = aware(dt)
    return dt.isoformat() if dt else None


def user_public(u: User) -> dict:
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "title": u.title, "bio": u.bio,
            "created_at": iso(u.created_at)}


def user_private(u: User) -> dict:
    return {**user_public(u), "email": u.email, "role": u.role, "is_demo": u.is_demo, "oauth_provider": u.oauth_provider}


def order_out(o: Order) -> dict:
    inst = resolve(o.symbol)
    return {
        "id": o.id, "account_id": o.account_id, "symbol": o.symbol, "display": inst.display if inst else o.symbol,
        "side": o.side, "type": o.type, "qty": o.qty, "limit_price": o.limit_price, "stop_price": o.stop_price,
        "trail_percent": o.trail_percent, "time_in_force": o.time_in_force, "status": o.status,
        "take_profit": o.take_profit, "stop_loss": o.stop_loss, "parent_id": o.parent_id, "oco_group": o.oco_group,
        "filled_price": o.filled_price, "filled_at": iso(o.filled_at), "fee": o.fee, "reason": o.reason,
        "source": o.source, "created_at": iso(o.created_at),
    }


def trade_out(t: Trade) -> dict:
    inst = resolve(t.symbol)
    return {
        "id": t.id, "order_id": t.order_id, "account_id": t.account_id, "symbol": t.symbol,
        "display": inst.display if inst else t.symbol, "asset_class": t.asset_class, "side": t.side, "qty": t.qty,
        "price": t.price, "fee": t.fee, "realized_pnl": t.realized_pnl, "net_pnl": t.realized_pnl - t.fee if t.closes_position else None,
        "closes_position": t.closes_position, "created_at": iso(t.created_at),
    }


def post_out(p: Post, likes: int, comments: int, liked: bool) -> dict:
    return {"id": p.id, "author": user_public(p.author), "body": p.body, "symbols": p.symbols, "sentiment": p.sentiment,
            "likes": likes, "comments": comments, "liked": liked, "created_at": iso(p.created_at)}
