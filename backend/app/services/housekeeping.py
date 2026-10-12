"""Periodic jobs run by the market-data worker."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Account, Competition, EquitySnapshot, Notification, Position, aware

log = logging.getLogger("rm.housekeeping")
SNAPSHOT_EVERY = timedelta(minutes=15)


def snapshot_all(db: Session) -> int:
    from ..trading.engine import equity_of, snapshot

    cutoff = datetime.now(timezone.utc) - SNAPSHOT_EVERY
    latest = dict(db.query(EquitySnapshot.account_id, func.max(EquitySnapshot.ts)).group_by(EquitySnapshot.account_id).all())
    active = {a for (a,) in db.query(Position.account_id).filter(Position.qty != 0).distinct()}
    n = 0
    for acct in db.query(Account).all():
        last = aware(latest.get(acct.id))
        if last and last > cutoff:
            continue
        if acct.id not in active and last:  # flat accounts: one snapshot a day is plenty
            if last > datetime.now(timezone.utc) - timedelta(days=1):
                continue
        try:
            snapshot(db, acct, equity_of(db, acct))
            n += 1
        except Exception:
            log.exception("snapshot failed for account %s", acct.id)
    db.commit()
    return n


def update_competitions(db: Session) -> None:
    from ..routers.competitions import leaderboard_rows

    now = datetime.now(timezone.utc)
    for c in db.query(Competition).filter(Competition.status != "finished"):
        if c.status == "scheduled" and aware(c.start_at) <= now:
            c.status = "active"
        if aware(c.end_at) <= now:
            rows = leaderboard_rows(db, c)
            c.status = "finished"
            c.winners = [{"rank": r["rank"], "user_id": r["user_id"], "username": r["username"], "return_pct": r["return_pct"]} for r in rows[:3]]
            for r in rows[:3]:
                db.add(Notification(user_id=r["user_id"], kind="competition",
                                    title=f"You placed #{r['rank']} in {c.name}!",
                                    body=f"Return {r['return_pct']:+.2f}%. Prize: {c.prize or 'bragging rights'}"))
    db.commit()
