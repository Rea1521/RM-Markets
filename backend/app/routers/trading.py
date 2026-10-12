from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..events import record_event, replay_account
from ..market import service as market
from ..market.universe import resolve
from ..models import (
    Account,
    EquitySnapshot,
    Event,
    Notification,
    OptionPosition,
    Order,
    Position,
    PriceAlert,
    Trade,
    User,
    WatchlistItem,
)
from ..schemas import AlertIn, ClosePositionIn, FundsIn, OrderIn, ResetIn, WatchIn
from ..security import get_current_user, get_main_account, resolve_account
from ..serializers import iso, order_out, trade_out
from ..trading import engine

router = APIRouter(prefix="/api/trading", tags=["trading"])

DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "AAPL", "TSLA", "XAUUSD", "NIFTY50", "EURUSD"]


# ---------------------------------------------------------------- account
@router.get("/accounts")
def accounts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_main_account(db, user)
    rows = db.query(Account).filter(Account.user_id == user.id).order_by(Account.id).all()
    return [{"id": a.id, "name": a.name, "competition_id": a.competition_id, "cash": a.cash, "starting_balance": a.starting_balance} for a in rows]


@router.get("/account")
def account(account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    summ = engine.account_summary(db, acct)
    trades = db.query(Trade).filter(Trade.account_id == acct.id).all()
    from ..analytics.performance import trade_stats

    st = trade_stats(trades)
    summ["win_rate"] = st["win_rate"]
    summ["closed_trades"] = st["closed_trades"]
    return summ


@router.post("/account/deposit")
def deposit(body: FundsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, body.account_id)
    if acct.competition_id:
        raise HTTPException(403, "Deposits are not allowed in competition accounts")
    if acct.net_deposits + body.amount > 10_000_000:
        raise HTTPException(422, "Virtual deposits are capped at $10,000,000")
    acct.cash += body.amount
    acct.net_deposits += body.amount
    record_event(db, "account", acct.id, "FundsDeposited", {"amount": body.amount}, user.id)
    engine.snapshot(db, acct)
    db.commit()
    return engine.account_summary(db, acct, include_positions=False)


@router.post("/account/withdraw")
def withdraw(body: FundsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, body.account_id)
    if acct.competition_id:
        raise HTTPException(403, "Withdrawals are not allowed in competition accounts")
    summ = engine.account_summary(db, acct, include_positions=False)
    if body.amount > min(acct.cash, summ["available_margin"]):
        raise HTTPException(422, "Amount exceeds withdrawable cash")
    acct.cash -= body.amount
    acct.net_deposits -= body.amount
    record_event(db, "account", acct.id, "FundsWithdrawn", {"amount": -body.amount}, user.id)
    engine.snapshot(db, acct)
    db.commit()
    return engine.account_summary(db, acct, include_positions=False)


@router.post("/account/reset")
def reset(body: ResetIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = get_main_account(db, user)
    db.query(Position).filter(Position.account_id == acct.id).delete()
    db.query(OptionPosition).filter(OptionPosition.account_id == acct.id).delete()
    db.query(Order).filter(Order.account_id == acct.id, Order.status == "pending").update({"status": "cancelled", "reason": "Account reset"})
    db.query(EquitySnapshot).filter(EquitySnapshot.account_id == acct.id).delete()
    acct.cash = acct.starting_balance = body.starting_balance
    acct.net_deposits = 0.0
    from ..models import utcnow

    acct.created_at = utcnow()
    record_event(db, "account", acct.id, "AccountReset", {"cash": body.starting_balance}, user.id)
    db.commit()
    return engine.account_summary(db, acct)


# ---------------------------------------------------------------- orders
@router.post("/orders", status_code=201)
def place(body: OrderIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, body.account_id)
    req = engine.OrderRequest(**body.model_dump(exclude={"account_id"}))
    order = engine.place_order(db, acct, req)
    return order_out(order)


@router.get("/orders")
def orders(status: str | None = Query(default=None, pattern="^(pending|filled|cancelled|rejected|expired)$"),
           symbol: str | None = None, limit: int = Query(default=100, ge=1, le=500), account_id: int | None = None,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    q = db.query(Order).filter(Order.account_id == acct.id)
    if status:
        q = q.filter(Order.status == status)
    if symbol:
        inst = resolve(symbol)
        q = q.filter(Order.symbol == (inst.symbol if inst else symbol.upper()))
    return [order_out(o) for o in q.order_by(Order.id.desc()).limit(limit)]


@router.delete("/orders/{order_id}")
def cancel(order_id: int, account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    return order_out(engine.cancel_order(db, acct, order_id))


@router.delete("/orders")
def cancel_all(symbol: str | None = None, account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    q = db.query(Order).filter(Order.account_id == acct.id, Order.status == "pending")
    if symbol:
        inst = resolve(symbol)
        q = q.filter(Order.symbol == (inst.symbol if inst else symbol))
    n = 0
    for o in q:
        o.status, o.reason = "cancelled", "Cancelled by user"
        record_event(db, "account", acct.id, "OrderCancelled", {"order_id": o.id}, user.id)
        n += 1
    db.commit()
    return {"cancelled": n}


# ---------------------------------------------------------------- positions / trades
@router.get("/positions")
def positions(account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    s = engine.account_summary(db, acct)
    return {"positions": s["positions"], "option_positions": s["option_positions"]}


@router.post("/positions/{symbol}/close")
def close(symbol: str, body: ClosePositionIn | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    body = body or ClosePositionIn()
    acct = resolve_account(db, user, body.account_id)
    return order_out(engine.close_position(db, acct, symbol, body.qty))


@router.post("/positions/close-all")
def close_all(account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    out = []
    for p in db.query(Position).filter(Position.account_id == acct.id, Position.qty != 0).all():
        try:
            out.append(order_out(engine.close_position(db, acct, p.symbol)))
        except HTTPException as e:
            out.append({"symbol": p.symbol, "error": e.detail})
    return out


@router.get("/trades")
def trades(limit: int = Query(default=200, ge=1, le=1000), account_id: int | None = None,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    rows = db.query(Trade).filter(Trade.account_id == acct.id).order_by(Trade.id.desc()).limit(limit)
    return [trade_out(t) for t in rows]


@router.get("/history")
def history(limit: int = Query(default=100, ge=1, le=500), account_id: int | None = None,
            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Account activity (event-sourced audit trail)."""
    acct = resolve_account(db, user, account_id)
    evs = db.query(Event).filter(Event.aggregate_type == "account", Event.aggregate_id == acct.id).order_by(Event.id.desc()).limit(limit)
    return [{"id": e.id, "type": e.type, "payload": e.payload, "created_at": iso(e.created_at)} for e in evs]


@router.get("/audit/replay")
def audit(account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Rebuild the account from its event log and compare with the live tables."""
    acct = resolve_account(db, user, account_id)
    rebuilt = replay_account(db, acct.id)
    live_pos = {p.symbol: {"qty": round(p.qty, 10), "avg_price": round(p.avg_price, 8)} for p in
                db.query(Position).filter(Position.account_id == acct.id, Position.qty != 0)}
    cash_ok = abs(rebuilt["cash"] - acct.cash) < 1e-4
    pos_ok = set(rebuilt["positions"]) == set(live_pos) and all(
        abs(rebuilt["positions"][k]["qty"] - live_pos[k]["qty"]) < 1e-8 for k in live_pos)
    return {"consistent": cash_ok and pos_ok, "live": {"cash": acct.cash, "positions": live_pos}, "rebuilt": rebuilt}


# ---------------------------------------------------------------- watchlist
@router.get("/watchlist")
def watchlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).order_by(WatchlistItem.sort, WatchlistItem.id).all()
    if not items and not db.query(Event).filter(Event.user_id == user.id, Event.type == "WatchlistCleared").first():
        for i, s in enumerate(DEFAULT_WATCHLIST):
            db.add(WatchlistItem(user_id=user.id, symbol=s, sort=i))
        db.commit()
        items = db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).order_by(WatchlistItem.sort).all()
    syms = [i.symbol for i in items]
    return market.get_quotes(syms) if syms else []


@router.post("/watchlist", status_code=201)
def add_watch(body: WatchIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inst = market.instrument_or_404(body.symbol)
    if not db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id, WatchlistItem.symbol == inst.symbol).first():
        n = db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).count()
        if n >= 50:
            raise HTTPException(422, "Watchlist is limited to 50 symbols")
        db.add(WatchlistItem(user_id=user.id, symbol=inst.symbol, sort=n))
        db.commit()
    return {"ok": True, "symbol": inst.symbol}


@router.delete("/watchlist/{symbol}")
def remove_watch(symbol: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inst = market.instrument_or_404(symbol)
    db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id, WatchlistItem.symbol == inst.symbol).delete()
    if not db.query(WatchlistItem).filter(WatchlistItem.user_id == user.id).count():
        record_event(db, "user", user.id, "WatchlistCleared", {}, user.id)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- alerts & notifications
@router.get("/alerts")
def alerts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(PriceAlert).filter(PriceAlert.user_id == user.id).order_by(PriceAlert.id.desc()).limit(200)
    return [{"id": a.id, "symbol": a.symbol, "condition": a.condition, "price": a.price, "note": a.note, "active": a.active,
             "triggered_at": iso(a.triggered_at), "created_at": iso(a.created_at)} for a in rows]


@router.post("/alerts", status_code=201)
def create_alert(body: AlertIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inst = market.instrument_or_404(body.symbol)
    if db.query(PriceAlert).filter(PriceAlert.user_id == user.id, PriceAlert.active.is_(True)).count() >= 100:
        raise HTTPException(422, "Maximum of 100 active alerts")
    a = PriceAlert(user_id=user.id, symbol=inst.symbol, condition=body.condition, price=body.price, note=body.note)
    db.add(a)
    db.commit()
    return {"id": a.id, "symbol": a.symbol, "condition": a.condition, "price": a.price, "active": True}


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.query(PriceAlert).filter(PriceAlert.id == alert_id, PriceAlert.user_id == user.id).delete()
    db.commit()
    if not n:
        raise HTTPException(404, "Alert not found")
    return {"ok": True}


@router.get("/notifications")
def notifications(unread_only: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.read.is_(False))
    rows = q.order_by(Notification.id.desc()).limit(50).all()
    unread = db.query(Notification).filter(Notification.user_id == user.id, Notification.read.is_(False)).count()
    return {"unread": unread, "items": [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "read": n.read,
                                          "created_at": iso(n.created_at)} for n in rows]}


@router.post("/notifications/read")
def mark_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read.is_(False)).update({"read": True})
    db.commit()
    return {"ok": True}


@router.get("/rules")
def rules():
    s = get_settings()
    return {
        "leverage": engine.LEVERAGE, "fees": {**engine.FEE_RATE, "stock_per_share": engine.STOCK_FEE_PER_SHARE, "stock_min": engine.STOCK_MIN_FEE},
        "shortable": sorted(engine.SHORTABLE), "min_notional": engine.MIN_NOTIONAL, "max_notional": engine.MAX_NOTIONAL,
        "max_open_orders": engine.MAX_OPEN_ORDERS, "maintenance_ratio": engine.MAINTENANCE_RATIO,
        "daily_loss_limit_pct": s.daily_loss_limit_pct, "max_position_pct": s.max_position_pct,
        "enforce_market_hours": s.enforce_market_hours, "order_types": sorted(engine.ORDER_TYPES),
    }
