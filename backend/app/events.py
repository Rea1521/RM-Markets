"""Event sourcing helpers.

Every state change to an account is appended to the `events` table. `replay_account`
rebuilds cash and positions purely from that log so we can audit (and repair)
the materialized tables.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import Event


def record_event(
    db: Session, aggregate_type: str, aggregate_id: int, type_: str, payload: dict[str, Any], user_id: int | None
) -> Event:
    ev = Event(aggregate_type=aggregate_type, aggregate_id=aggregate_id, type=type_, payload=payload, user_id=user_id)
    db.add(ev)
    return ev


def apply_fill(positions: dict[str, dict], symbol: str, side: str, qty: float, price: float) -> float:
    """Pure position math shared by the engine and the replayer. Returns realized P&L."""
    signed = qty if side == "buy" else -qty
    pos = positions.setdefault(symbol, {"qty": 0.0, "avg_price": 0.0})
    cur = pos["qty"]
    realized = 0.0
    if cur == 0 or (cur > 0) == (signed > 0):
        new_qty = cur + signed
        pos["avg_price"] = (abs(cur) * pos["avg_price"] + abs(signed) * price) / abs(new_qty)
        pos["qty"] = new_qty
    else:
        closing = min(abs(cur), abs(signed))
        direction = 1 if cur > 0 else -1
        realized = closing * (price - pos["avg_price"]) * direction
        new_qty = cur + signed
        if abs(new_qty) < 1e-12:
            pos["qty"], pos["avg_price"] = 0.0, 0.0
        elif (new_qty > 0) == (cur > 0):
            pos["qty"] = new_qty  # partial close keeps avg price
        else:
            pos["qty"], pos["avg_price"] = new_qty, price  # flipped
    return realized


def replay_account(db: Session, account_id: int) -> dict[str, Any]:
    events = (
        db.query(Event)
        .filter(Event.aggregate_type == "account", Event.aggregate_id == account_id)
        .order_by(Event.id)
        .all()
    )
    cash = 0.0
    positions: dict[str, dict] = {}
    options: dict[str, float] = {}
    realized = 0.0
    for ev in events:
        p = ev.payload
        if ev.type == "AccountOpened":
            cash = p["cash"]
        elif ev.type in ("FundsDeposited", "FundsWithdrawn"):
            cash += p["amount"]
        elif ev.type == "AccountReset":
            cash, positions, options = p["cash"], {}, {}
        elif ev.type == "OrderFilled":
            signed_notional = p["qty"] * p["price"] * (1 if p["side"] == "buy" else -1)
            cash -= signed_notional + p.get("fee", 0.0)
            realized += apply_fill(positions, p["symbol"], p["side"], p["qty"], p["price"])
        elif ev.type == "OptionTraded":
            cash -= p["contracts"] * p["premium"] * p["multiplier"] + p.get("fee", 0.0)
            options[p["contract"]] = options.get(p["contract"], 0.0) + p["contracts"]
        elif ev.type == "OptionSettled":
            cash += p["cash"]
            options[p["contract"]] = 0.0
    return {
        "events": len(events),
        "cash": round(cash, 6),
        "positions": {k: {"qty": round(v["qty"], 10), "avg_price": round(v["avg_price"], 8)} for k, v in positions.items() if abs(v["qty"]) > 1e-12},
        "options": {k: v for k, v in options.items() if abs(v) > 1e-12},
        "realized_pnl": round(realized, 6),
    }
