"""Paper-trading competitions. Each participant gets an isolated competition
account with the same starting balance; ranking is by % return. Prize fulfilment
(paying real money) is intentionally outside the app: organisers record the
prize and sponsor, winners are notified and listed when the competition ends."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import record_event
from ..models import Account, Competition, CompetitionEntry, User, aware
from ..schemas import CompetitionIn
from ..security import get_current_user, get_optional_user
from ..serializers import iso

router = APIRouter(prefix="/api/competitions", tags=["competitions"])


def _status(c: Competition) -> str:
    now = datetime.now(timezone.utc)
    if aware(c.end_at) <= now:
        return "finished"
    if aware(c.start_at) <= now:
        return "active"
    return "scheduled"


def comp_out(db: Session, c: Competition, viewer: User | None = None) -> dict:
    n = db.query(CompetitionEntry).filter(CompetitionEntry.competition_id == c.id).count()
    entry = None
    if viewer:
        entry = db.query(CompetitionEntry).filter(CompetitionEntry.competition_id == c.id, CompetitionEntry.user_id == viewer.id).first()
    return {
        "id": c.id, "name": c.name, "description": c.description, "starting_balance": c.starting_balance,
        "start_at": iso(c.start_at), "end_at": iso(c.end_at), "prize": c.prize, "prize_pool": c.prize_pool, "sponsor": c.sponsor,
        "allowed_asset_classes": c.allowed_asset_classes or [], "max_participants": c.max_participants, "participants": n,
        "status": _status(c), "winners": c.winners or [], "joined": bool(entry), "account_id": entry.account_id if entry else None,
    }


def leaderboard_rows(db: Session, c: Competition) -> list[dict]:
    from ..trading.engine import account_summary

    rows = []
    for e in db.query(CompetitionEntry).filter(CompetitionEntry.competition_id == c.id):
        acct = db.get(Account, e.account_id)
        user = db.get(User, e.user_id)
        s = account_summary(db, acct, include_positions=False)
        from ..models import Trade

        n_trades = db.query(Trade).filter(Trade.account_id == acct.id).count()
        rows.append({"user_id": user.id, "username": user.username, "display_name": user.display_name,
                     "equity": round(s["equity"], 2), "return_pct": round(s["total_pnl_pct"], 3), "trades": n_trades})
    rows.sort(key=lambda r: (-r["return_pct"], -r["trades"]))
    return [{"rank": i + 1, **r} for i, r in enumerate(rows)]


@router.get("")
def list_competitions(status: str | None = Query(default=None, pattern="^(scheduled|active|finished)$"),
                      viewer: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    rows = [comp_out(db, c, viewer) for c in db.query(Competition).order_by(Competition.start_at.desc()).limit(100)]
    return [r for r in rows if not status or r["status"] == status]


@router.post("", status_code=201)
def create(body: CompetitionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    start = body.start_at if body.start_at.tzinfo else body.start_at.replace(tzinfo=timezone.utc)
    end = body.end_at if body.end_at.tzinfo else body.end_at.replace(tzinfo=timezone.utc)
    if end <= start:
        raise HTTPException(422, "end_at must be after start_at")
    if (end - start).days > 366:
        raise HTTPException(422, "Competitions can last at most one year")
    if user.is_demo:
        raise HTTPException(403, "Guest accounts cannot create competitions. Register to host one.")
    c = Competition(**{**body.model_dump(), "start_at": start, "end_at": end}, created_by=user.id)
    c.status = _status(c)
    db.add(c)
    db.commit()
    return comp_out(db, c, user)


@router.get("/{comp_id}")
def detail(comp_id: int, viewer: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "Competition not found")
    return {**comp_out(db, c, viewer), "leaderboard": leaderboard_rows(db, c)[:100]}


@router.post("/{comp_id}/join")
def join(comp_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "Competition not found")
    if _status(c) == "finished":
        raise HTTPException(409, "Competition has finished")
    existing = db.query(CompetitionEntry).filter(CompetitionEntry.competition_id == c.id, CompetitionEntry.user_id == user.id).first()
    if existing:
        return comp_out(db, c, user)
    if db.query(CompetitionEntry).filter(CompetitionEntry.competition_id == c.id).count() >= c.max_participants:
        raise HTTPException(409, "Competition is full")
    acct = Account(user_id=user.id, competition_id=c.id, name=c.name[:60], cash=c.starting_balance, starting_balance=c.starting_balance)
    db.add(acct)
    db.flush()
    record_event(db, "account", acct.id, "AccountOpened", {"cash": c.starting_balance, "competition_id": c.id}, user.id)
    db.add(CompetitionEntry(competition_id=c.id, user_id=user.id, account_id=acct.id))
    db.commit()
    return comp_out(db, c, user)


@router.get("/{comp_id}/leaderboard")
def leaderboard(comp_id: int, db: Session = Depends(get_db)):
    c = db.get(Competition, comp_id)
    if not c:
        raise HTTPException(404, "Competition not found")
    return leaderboard_rows(db, c)
