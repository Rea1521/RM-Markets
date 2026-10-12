"""Demo trading engine.

Rules implemented
-----------------
* Market / limit / stop / stop-limit / trailing-stop orders, GTC or DAY.
* Bracket orders: take-profit + stop-loss children linked as an OCO group.
* Fills at bid/ask (never mid) plus size-based slippage; per-asset-class fees.
* Margin: per-asset-class leverage (crypto 1x spot, stocks 2x Reg-T, indices 5x,
  commodities 10x, FX 30x); orders that would exceed available margin are rejected.
* No shorting of spot crypto.
* Optional market-hours enforcement (queues market orders while closed).
* Daily loss limit: new exposure blocked after losing X% of start-of-day equity.
* Position concentration cap.
* Maintenance margin: positions are liquidated when equity < 50% of margin used.
Every fill is appended to the event log (event sourcing).
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..bus import get_bus
from ..config import get_settings
from ..events import apply_fill, record_event
from ..market import service as market
from ..market.universe import Instrument, resolve
from ..models import (
    Account,
    EquitySnapshot,
    Notification,
    OptionPosition,
    Order,
    Position,
    Trade,
    aware,
    utcnow,
)
from ..analytics import options as opt

log = logging.getLogger("rm.engine")

LEVERAGE = {"crypto": 1.0, "stock": 2.0, "index": 5.0, "commodity": 10.0, "forex": 30.0}
FEE_RATE = {"crypto": 0.001, "stock": 0.0, "index": 0.0001, "commodity": 0.0001, "forex": 0.00002}
STOCK_FEE_PER_SHARE, STOCK_MIN_FEE = 0.005, 1.0
SHORTABLE = {"stock", "index", "commodity", "forex"}
MIN_NOTIONAL = 1.0
MAX_NOTIONAL = 5_000_000.0
MAX_OPEN_ORDERS = 100
MAINTENANCE_RATIO = 0.5
ORDER_TYPES = {"market", "limit", "stop", "stop_limit", "trailing_stop"}


class OrderRejected(HTTPException):
    def __init__(self, reason: str):
        super().__init__(status_code=422, detail=reason)
        self.reason = reason


@dataclass
class OrderRequest:
    symbol: str
    side: str
    qty: float
    type: str = "market"
    limit_price: float | None = None
    stop_price: float | None = None
    trail_percent: float | None = None
    time_in_force: str = "gtc"
    take_profit: float | None = None
    stop_loss: float | None = None
    source: str = "web"


# ---------------------------------------------------------------- pricing helpers
def fee_for(inst: Instrument, qty: float, price: float) -> float:
    if inst.asset_class == "stock":
        return round(max(STOCK_MIN_FEE, qty * STOCK_FEE_PER_SHARE), 4) if qty > 0 else 0.0
    return round(qty * price * FEE_RATE[inst.asset_class], 6)


def fill_price(quote: dict, side: str, notional: float) -> float:
    base = quote["ask"] if side == "buy" else quote["bid"]
    impact_bps = min(25.0, notional / 1_000_000 * 5)  # bigger orders move the market
    return base * (1 + impact_bps / 10000) if side == "buy" else base * (1 - impact_bps / 10000)


def _positions(db: Session, account: Account) -> list[Position]:
    return db.query(Position).filter(Position.account_id == account.id, Position.qty != 0).all()


def _open_options(db: Session, account: Account) -> list[OptionPosition]:
    return db.query(OptionPosition).filter(OptionPosition.account_id == account.id, OptionPosition.status == "open").all()


def option_mark(op: OptionPosition, spot: float | None = None) -> float:
    inst = resolve(op.underlying)
    S = spot if spot is not None else market.get_price(op.underlying)
    sigma = implied_sigma(op.underlying)
    T = opt.years_to(aware(op.expiry))
    return opt.black_scholes(S, op.strike, T, get_settings().risk_free_rate, opt.smile(sigma, S, op.strike, max(T, 1e-3)), op.option_type)["price"] if inst else 0.0


def implied_sigma(symbol: str) -> float:
    from ..cache import cached

    inst = resolve(symbol)

    def calc():
        closes = market.closes(inst.symbol, "1D", 90)
        return opt.realized_vol(closes, 365 if inst.is_24_7 else 252)

    return float(cached(f"sigma:{inst.symbol}", 900, calc))


# ---------------------------------------------------------------- valuation
def account_summary(db: Session, account: Account, include_positions: bool = True) -> dict:
    positions = _positions(db, account)
    rows, mv_total, margin_used, unreal = [], 0.0, 0.0, 0.0
    alloc: dict[str, float] = {}
    for p in positions:
        try:
            q = market.get_quote(p.symbol)
        except HTTPException:
            continue
        mark = q["bid"] if p.qty > 0 else q["ask"]
        mv = p.qty * mark
        upnl = (mark - p.avg_price) * p.qty
        mv_total += mv
        unreal += upnl
        margin_used += abs(mv) / LEVERAGE[p.asset_class]
        alloc[p.asset_class] = alloc.get(p.asset_class, 0.0) + abs(mv)
        rows.append({
            "id": p.id, "symbol": p.symbol, "display": q["display"], "asset_class": p.asset_class,
            "qty": p.qty, "side": "long" if p.qty > 0 else "short", "avg_price": p.avg_price, "price": q["price"],
            "market_value": mv, "unrealized_pnl": upnl,
            "unrealized_pnl_pct": (mark / p.avg_price - 1) * 100 * (1 if p.qty > 0 else -1) if p.avg_price else 0.0,
            "realized_pnl": p.realized_pnl, "day_change_pct": q["change_pct"],
        })
    opt_rows, opt_value = [], 0.0
    for op in _open_options(db, account):
        try:
            mark = option_mark(op)
        except HTTPException:
            continue
        val = op.contracts * mark * op.multiplier
        opt_value += val
        if op.contracts < 0:  # short options need margin (simplified: 20% of underlying notional)
            margin_used += abs(op.contracts) * op.multiplier * market.get_price(op.underlying) * 0.2
        opt_rows.append({
            "id": op.id, "underlying": op.underlying, "option_type": op.option_type, "strike": op.strike,
            "expiry": aware(op.expiry).isoformat(), "contracts": op.contracts, "avg_premium": op.avg_premium,
            "mark": mark, "market_value": val, "unrealized_pnl": (mark - op.avg_premium) * op.contracts * op.multiplier,
        })
    if opt_value:
        alloc["options"] = abs(opt_value)
    equity = account.cash + mv_total + opt_value
    alloc["cash"] = max(account.cash, 0.0)
    invested_base = account.starting_balance + account.net_deposits
    day_start = day_start_equity(db, account)
    available = equity - margin_used
    total_alloc = sum(alloc.values()) or 1.0
    out = {
        "account_id": account.id, "name": account.name, "competition_id": account.competition_id,
        "currency": account.currency, "cash": account.cash, "equity": equity,
        "starting_balance": account.starting_balance, "net_deposits": account.net_deposits,
        "market_value": mv_total, "options_value": opt_value, "unrealized_pnl": unreal,
        "total_pnl": equity - invested_base, "total_pnl_pct": (equity / invested_base - 1) * 100 if invested_base else 0.0,
        "day_pnl": equity - day_start, "day_pnl_pct": (equity / day_start - 1) * 100 if day_start else 0.0,
        "margin_used": margin_used, "available_margin": available,
        "buying_power": max(0.0, available) * LEVERAGE["stock"],
        "buying_power_by_class": {k: max(0.0, available) * v for k, v in LEVERAGE.items()},
        "margin_level_pct": (equity / margin_used * 100) if margin_used else None,
        "allocation": [{"asset_class": k, "value": v, "pct": v / total_alloc * 100} for k, v in sorted(alloc.items(), key=lambda kv: -kv[1])],
    }
    if include_positions:
        out["positions"] = rows
        out["option_positions"] = opt_rows
    return out


def equity_of(db: Session, account: Account) -> float:
    return account_summary(db, account, include_positions=False)["equity"]


def day_start_equity(db: Session, account: Account) -> float:
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    snap = (
        db.query(EquitySnapshot)
        .filter(EquitySnapshot.account_id == account.id, EquitySnapshot.ts < midnight)
        .order_by(EquitySnapshot.ts.desc())
        .first()
    )
    return snap.equity if snap else account.starting_balance + account.net_deposits


def snapshot(db: Session, account: Account, equity: float | None = None) -> None:
    db.add(EquitySnapshot(account_id=account.id, equity=equity if equity is not None else equity_of(db, account), cash=account.cash))


# ---------------------------------------------------------------- validation
def validate_request(req: OrderRequest) -> Instrument:
    inst = resolve(req.symbol)
    if not inst:
        raise OrderRejected(f"Unknown symbol {req.symbol}")
    if req.side not in ("buy", "sell"):
        raise OrderRejected("side must be buy or sell")
    if req.type not in ORDER_TYPES:
        raise OrderRejected(f"type must be one of {sorted(ORDER_TYPES)}")
    if not (req.qty and req.qty > 0):
        raise OrderRejected("qty must be positive")
    if req.time_in_force not in ("gtc", "day"):
        raise OrderRejected("time_in_force must be gtc or day")
    if req.type in ("limit", "stop_limit") and not (req.limit_price and req.limit_price > 0):
        raise OrderRejected("limit_price required")
    if req.type in ("stop", "stop_limit") and not (req.stop_price and req.stop_price > 0):
        raise OrderRejected("stop_price required")
    if req.type == "trailing_stop" and not (req.trail_percent and 0.1 <= req.trail_percent <= 50):
        raise OrderRejected("trail_percent must be between 0.1 and 50")
    return inst


def check_risk(db: Session, account: Account, inst: Instrument, side: str, qty: float, price: float, *, summary: dict | None = None) -> None:
    s = get_settings()
    notional = qty * price
    if notional < MIN_NOTIONAL:
        raise OrderRejected(f"Order value must be at least ${MIN_NOTIONAL:.0f}")
    if notional > MAX_NOTIONAL:
        raise OrderRejected("Order value exceeds the $5,000,000 per-order limit")
    pos = db.query(Position).filter(Position.account_id == account.id, Position.symbol == inst.symbol).first()
    cur = pos.qty if pos else 0.0
    new = cur + (qty if side == "buy" else -qty)
    if new < -1e-12 and inst.asset_class not in SHORTABLE:
        raise OrderRejected(f"Short selling is not allowed for {inst.asset_class} (spot market). You hold {cur:g}.")
    increases = abs(new) > abs(cur) + 1e-12
    if not increases:
        return  # reducing / closing is always allowed
    summ = summary or account_summary(db, account, include_positions=False)
    equity = summ["equity"]
    if equity <= 0:
        raise OrderRejected("Account equity is depleted. Reset the account to continue trading.")
    added = (abs(new) - abs(cur)) * price
    required = added / LEVERAGE[inst.asset_class] + fee_for(inst, qty, price)
    if required > summ["available_margin"] + 1e-9:
        raise OrderRejected(
            f"Insufficient buying power: requires ${required:,.2f} margin, ${max(0, summ['available_margin']):,.2f} available"
        )
    if abs(new) * price > s.max_position_pct * equity * LEVERAGE[inst.asset_class] + 1e-9:
        raise OrderRejected(f"Position would exceed the {s.max_position_pct:.0%} concentration limit")
    start = day_start_equity(db, account)
    if start > 0 and equity < start * (1 - s.daily_loss_limit_pct):
        raise OrderRejected(
            f"Daily loss limit reached ({s.daily_loss_limit_pct:.0%} of start-of-day equity). You can only reduce positions today."
        )


# ---------------------------------------------------------------- execution
def _notify(db: Session, account: Account, kind: str, title: str, body: str, payload: dict) -> None:
    db.add(Notification(user_id=account.user_id, kind=kind, title=title, body=body))
    get_bus().publish_threadsafe(f"user:{account.user_id}", {"type": kind, "title": title, "body": body, **payload})


def execute_fill(db: Session, account: Account, order: Order, inst: Instrument, price: float) -> Trade:
    pos = db.query(Position).filter(Position.account_id == account.id, Position.symbol == inst.symbol).first()
    if not pos:
        pos = Position(account_id=account.id, symbol=inst.symbol, asset_class=inst.asset_class, qty=0.0, avg_price=0.0, realized_pnl=0.0)
        db.add(pos)
    state = {inst.symbol: {"qty": pos.qty, "avg_price": pos.avg_price}}
    was_flat = abs(pos.qty) < 1e-12
    realized = apply_fill(state, inst.symbol, order.side, order.qty, price)
    pos.qty, pos.avg_price = state[inst.symbol]["qty"], state[inst.symbol]["avg_price"]
    pos.realized_pnl += realized
    if was_flat:
        pos.opened_at = utcnow()
    fee = fee_for(inst, order.qty, price)
    account.cash -= order.qty * price * (1 if order.side == "buy" else -1) + fee
    order.status, order.filled_price, order.filled_at, order.fee = "filled", price, utcnow(), fee
    trade = Trade(
        order_id=order.id, account_id=account.id, symbol=inst.symbol, asset_class=inst.asset_class, side=order.side,
        qty=order.qty, price=price, fee=fee, realized_pnl=realized, closes_position=realized != 0 or (not was_flat and abs(pos.qty) < 1e-12),
    )
    db.add(trade)
    record_event(db, "account", account.id, "OrderFilled",
                 {"order_id": order.id, "symbol": inst.symbol, "side": order.side, "qty": order.qty, "price": price, "fee": fee},
                 account.user_id)
    db.flush()
    # cancel the other leg of an OCO pair
    if order.oco_group:
        for sib in db.query(Order).filter(Order.oco_group == order.oco_group, Order.id != order.id, Order.status == "pending"):
            sib.status, sib.reason = "cancelled", "OCO sibling filled"
    # bracket children
    if order.take_profit or order.stop_loss:
        _spawn_bracket(db, account, order, inst)
    _notify(db, account, "order_filled", f"{order.side.upper()} {order.qty:g} {inst.display} filled",
            f"@ {price:,.4f}" + (f" · realized P&L {realized:+,.2f}" if realized else ""),
            {"order_id": order.id, "symbol": inst.symbol, "price": price, "account_id": account.id})
    snapshot(db, account)
    return trade


def _spawn_bracket(db: Session, account: Account, parent: Order, inst: Instrument) -> None:
    group = f"oco-{uuid.uuid4().hex[:12]}"
    exit_side = "sell" if parent.side == "buy" else "buy"
    if parent.take_profit:
        db.add(Order(account_id=account.id, symbol=inst.symbol, side=exit_side, type="limit", qty=parent.qty,
                     limit_price=parent.take_profit, parent_id=parent.id, oco_group=group, source=parent.source))
    if parent.stop_loss:
        db.add(Order(account_id=account.id, symbol=inst.symbol, side=exit_side, type="stop", qty=parent.qty,
                     stop_price=parent.stop_loss, parent_id=parent.id, oco_group=group, source=parent.source))


def place_order(db: Session, account: Account, req: OrderRequest) -> Order:
    inst = validate_request(req)
    if req.take_profit or req.stop_loss:
        ref = req.limit_price or market.get_price(inst.symbol)
        if req.side == "buy":
            if req.take_profit and req.take_profit <= ref:
                raise OrderRejected("take_profit must be above the entry price for a buy")
            if req.stop_loss and req.stop_loss >= ref:
                raise OrderRejected("stop_loss must be below the entry price for a buy")
        else:
            if req.take_profit and req.take_profit >= ref:
                raise OrderRejected("take_profit must be below the entry price for a sell")
            if req.stop_loss and req.stop_loss <= ref:
                raise OrderRejected("stop_loss must be above the entry price for a sell")
    if req.type != "market":
        n_open = db.query(Order).filter(Order.account_id == account.id, Order.status == "pending").count()
        if n_open >= MAX_OPEN_ORDERS:
            raise OrderRejected(f"Maximum of {MAX_OPEN_ORDERS} open orders")
    if account.competition_id:
        _check_competition(db, account, inst)

    quote = market.get_quote(inst.symbol)
    order = Order(
        account_id=account.id, symbol=inst.symbol, side=req.side, type=req.type, qty=req.qty,
        limit_price=req.limit_price, stop_price=req.stop_price, trail_percent=req.trail_percent,
        time_in_force=req.time_in_force, take_profit=req.take_profit, stop_loss=req.stop_loss, source=req.source,
    )
    if req.type == "trailing_stop":
        order.trail_anchor = quote["bid"] if req.side == "sell" else quote["ask"]
        order.stop_price = order.trail_anchor * (1 - req.trail_percent / 100 if req.side == "sell" else 1 + req.trail_percent / 100)
    ref_price = req.limit_price or req.stop_price or quote["price"]
    try:
        check_risk(db, account, inst, req.side, req.qty, ref_price)
    except OrderRejected as e:
        order.status, order.reason = "rejected", e.reason
        db.add(order)
        db.flush()
        record_event(db, "account", account.id, "OrderRejected", {"symbol": inst.symbol, "reason": e.reason}, account.user_id)
        db.commit()
        raise
    db.add(order)
    db.flush()
    record_event(db, "account", account.id, "OrderPlaced",
                 {"order_id": order.id, "symbol": inst.symbol, "side": req.side, "type": req.type, "qty": req.qty,
                  "limit_price": req.limit_price, "stop_price": order.stop_price}, account.user_id)

    s = get_settings()
    hours_ok = not s.enforce_market_hours or quote.get("market_open", True)
    if req.type == "market":
        if hours_ok:
            execute_fill(db, account, order, inst, fill_price(quote, req.side, req.qty * quote["price"]))
        else:
            order.reason = "Market closed: queued until the next session open"
    else:
        _try_trigger(db, account, order, inst, quote)  # marketable limit orders fill immediately
    db.commit()
    db.refresh(order)
    return order


def cancel_order(db: Session, account: Account, order_id: int) -> Order:
    o = db.get(Order, order_id)
    if not o or o.account_id != account.id:
        raise HTTPException(404, "Order not found")
    if o.status != "pending":
        raise HTTPException(409, f"Order is already {o.status}")
    o.status, o.reason = "cancelled", "Cancelled by user"
    record_event(db, "account", account.id, "OrderCancelled", {"order_id": o.id}, account.user_id)
    db.commit()
    return o


def close_position(db: Session, account: Account, symbol: str, qty: float | None = None, source: str = "web") -> Order:
    inst = resolve(symbol)
    pos = db.query(Position).filter(Position.account_id == account.id, Position.symbol == (inst.symbol if inst else symbol)).first()
    if not pos or abs(pos.qty) < 1e-12:
        raise HTTPException(404, "No open position")
    q = abs(pos.qty) if qty is None else min(abs(qty), abs(pos.qty))
    return place_order(db, account, OrderRequest(symbol=pos.symbol, side="sell" if pos.qty > 0 else "buy", qty=q, source=source))


def _check_competition(db: Session, account: Account, inst: Instrument) -> None:
    from ..models import Competition

    comp = db.get(Competition, account.competition_id)
    now = datetime.now(timezone.utc)
    if not comp or not (aware(comp.start_at) <= now <= aware(comp.end_at)):
        raise OrderRejected("This competition is not running")
    if comp.allowed_asset_classes and inst.asset_class not in comp.allowed_asset_classes:
        raise OrderRejected(f"{inst.asset_class} is not allowed in this competition")


# ---------------------------------------------------------------- matching (worker)
def _try_trigger(db: Session, account: Account, o: Order, inst: Instrument, q: dict) -> bool:
    bid, ask = q["bid"], q["ask"]
    price = None
    if o.type == "trailing_stop":
        if o.side == "sell":
            o.trail_anchor = max(o.trail_anchor or bid, bid)
            o.stop_price = o.trail_anchor * (1 - o.trail_percent / 100)
            if bid <= o.stop_price:
                price = bid
        else:
            o.trail_anchor = min(o.trail_anchor or ask, ask)
            o.stop_price = o.trail_anchor * (1 + o.trail_percent / 100)
            if ask >= o.stop_price:
                price = ask
    elif o.type == "stop":
        if (o.side == "buy" and ask >= o.stop_price) or (o.side == "sell" and bid <= o.stop_price):
            price = fill_price(q, o.side, o.qty * q["price"])
    elif o.type == "stop_limit":
        if (o.side == "buy" and ask >= o.stop_price) or (o.side == "sell" and bid <= o.stop_price):
            o.type = "limit"  # stop triggered -> becomes a resting limit order
            record_event(db, "account", account.id, "StopTriggered", {"order_id": o.id}, account.user_id)
    if o.type == "limit":
        if o.side == "buy" and ask <= o.limit_price:
            price = min(ask, o.limit_price)
        elif o.side == "sell" and bid >= o.limit_price:
            price = max(bid, o.limit_price)
    elif o.type == "market":
        price = fill_price(q, o.side, o.qty * q["price"])
    if price is None:
        return False
    try:
        check_risk(db, account, inst, o.side, o.qty, price)
    except OrderRejected as e:
        o.status, o.reason = "rejected", e.reason
        record_event(db, "account", account.id, "OrderRejected", {"order_id": o.id, "reason": e.reason}, account.user_id)
        _notify(db, account, "order_rejected", f"Order #{o.id} rejected", e.reason, {"order_id": o.id})
        return False
    execute_fill(db, account, o, inst, price)
    return True


def match_pending(db: Session, quotes: dict[str, dict]) -> int:
    """Match resting orders against the latest quotes. Returns number of fills."""
    if not quotes:
        return 0
    s = get_settings()
    fills = 0
    today = datetime.now(timezone.utc).date()
    pending = db.query(Order).filter(Order.status == "pending", Order.symbol.in_(list(quotes))).order_by(Order.id).all()
    for o in pending:
        q = quotes[o.symbol]
        if o.time_in_force == "day" and aware(o.created_at).date() < today:
            o.status, o.reason = "expired", "DAY order expired"
            continue
        if s.enforce_market_hours and not q.get("market_open", True):
            continue
        inst = resolve(o.symbol)
        account = db.get(Account, o.account_id)
        if o.status != "pending":  # may have been cancelled by an OCO sibling in this loop
            continue
        try:
            if _try_trigger(db, account, o, inst, q):
                fills += 1
        except Exception:  # never let one bad order stop the matcher
            log.exception("matching order %s failed", o.id)
    db.commit()
    return fills


def check_alerts(db: Session, quotes: dict[str, dict]) -> int:
    from ..models import PriceAlert

    n = 0
    for a in db.query(PriceAlert).filter(PriceAlert.active.is_(True), PriceAlert.symbol.in_(list(quotes))):
        p = quotes[a.symbol]["price"]
        if (a.condition == "above" and p >= a.price) or (a.condition == "below" and p <= a.price):
            a.active, a.triggered_at = False, utcnow()
            db.add(Notification(user_id=a.user_id, kind="price_alert", title=f"{quotes[a.symbol]['display']} {a.condition} {a.price:,.4f}",
                                body=f"Now {p:,.4f}. {a.note}".strip()))
            get_bus().publish_threadsafe(f"user:{a.user_id}", {"type": "price_alert", "symbol": a.symbol, "price": p,
                                                               "title": f"{quotes[a.symbol]['display']} crossed {a.price:,.4f}"})
            n += 1
    db.commit()
    return n


def maintenance_check(db: Session) -> int:
    """Liquidate the largest position of any account below maintenance margin."""
    liquidated = 0
    acct_ids = {p.account_id for p in db.query(Position).filter(Position.qty != 0)}
    for aid in acct_ids:
        acct = db.get(Account, aid)
        summ = account_summary(db, acct)
        if summ["margin_used"] and summ["equity"] < summ["margin_used"] * MAINTENANCE_RATIO and summ["positions"]:
            worst = max(summ["positions"], key=lambda r: abs(r["market_value"]))
            o = close_position(db, acct, worst["symbol"], source="api")
            o.reason = "Margin call: auto-liquidated"
            _notify(db, acct, "margin_call", "Margin call", f"{worst['display']} was liquidated to restore margin", {})
            db.commit()
            liquidated += 1
    return liquidated


def settle_expired_options(db: Session) -> int:
    now = datetime.now(timezone.utc)
    n = 0
    for op in db.query(OptionPosition).filter(OptionPosition.status == "open"):
        if aware(op.expiry) > now:
            continue
        try:
            S = market.get_price(op.underlying)
        except HTTPException:
            continue
        intrinsic = max(0.0, S - op.strike) if op.option_type == "call" else max(0.0, op.strike - S)
        cash = op.contracts * intrinsic * op.multiplier
        acct = db.get(Account, op.account_id)
        acct.cash += cash
        op.realized_pnl += (intrinsic - op.avg_premium) * op.contracts * op.multiplier
        op.status = "expired"
        contract = f"{op.underlying}-{aware(op.expiry):%Y%m%d}-{op.option_type[0].upper()}{op.strike:g}"
        record_event(db, "account", acct.id, "OptionSettled", {"contract": contract, "cash": cash, "spot": S}, acct.user_id)
        n += 1
    db.commit()
    return n


# ---------------------------------------------------------------- options trading
def trade_option(db: Session, account: Account, underlying: str, option_type: str, strike: float,
                 expiry: datetime, contracts: float) -> OptionPosition:
    inst = resolve(underlying)
    if not inst:
        raise OrderRejected("Unknown underlying")
    if option_type not in ("call", "put"):
        raise OrderRejected("option_type must be call or put")
    if contracts == 0 or abs(contracts) > 1000:
        raise OrderRejected("contracts must be non-zero and at most 1000")
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= datetime.now(timezone.utc) + timedelta(minutes=5):
        raise OrderRejected("Option has expired or is about to expire")
    q = market.get_quote(inst.symbol)
    S = q["price"]
    sigma = implied_sigma(inst.symbol)
    T = opt.years_to(expiry)
    iv = opt.smile(sigma, S, strike, T)
    theo = opt.black_scholes(S, strike, T, get_settings().risk_free_rate, iv, option_type)["price"]
    spread = max(theo * 0.02, 0.01 if inst.option_multiplier > 1 else S * 1e-5)
    premium = theo + spread / 2 if contracts > 0 else max(theo - spread / 2, 0.0)
    mult = inst.option_multiplier
    fee = 0.65 * abs(contracts) if mult > 1 else abs(contracts) * premium * 0.0003
    cost = contracts * premium * mult + fee

    existing = (
        db.query(OptionPosition)
        .filter(OptionPosition.account_id == account.id, OptionPosition.underlying == inst.symbol,
                OptionPosition.option_type == option_type, OptionPosition.strike == strike,
                OptionPosition.expiry == expiry, OptionPosition.status == "open")
        .first()
    )
    opening = existing is None or (existing.contracts > 0) == (contracts > 0)
    if opening:
        summ = account_summary(db, account, include_positions=False)
        margin = cost if contracts > 0 else abs(contracts) * mult * S * 0.2
        if margin > summ["available_margin"]:
            raise OrderRejected(f"Insufficient buying power for this option trade (needs ${margin:,.2f})")
    account.cash -= cost
    if existing:
        st = {"x": {"qty": existing.contracts, "avg_price": existing.avg_premium}}
        realized = apply_fill(st, "x", "buy" if contracts > 0 else "sell", abs(contracts), premium)
        existing.contracts, existing.avg_premium = st["x"]["qty"], st["x"]["avg_price"]
        existing.realized_pnl += realized * mult
        if abs(existing.contracts) < 1e-12:
            existing.status = "closed"
        pos = existing
    else:
        pos = OptionPosition(account_id=account.id, underlying=inst.symbol, option_type=option_type, strike=strike,
                             expiry=expiry, contracts=contracts, multiplier=mult, avg_premium=premium,
                             realized_pnl=0.0, status="open")
        db.add(pos)
    contract = f"{inst.symbol}-{expiry:%Y%m%d}-{option_type[0].upper()}{strike:g}"
    db.add(Trade(account_id=account.id, symbol=contract, asset_class="option", side="buy" if contracts > 0 else "sell",
                 qty=abs(contracts), price=premium, fee=fee))
    record_event(db, "account", account.id, "OptionTraded",
                 {"contract": contract, "contracts": contracts, "premium": premium, "multiplier": mult, "fee": fee}, account.user_id)
    snapshot(db, account)
    db.commit()
    db.refresh(pos)
    return pos
