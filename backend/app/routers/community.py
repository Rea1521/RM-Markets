"""Social feed, trading journal, news & calendar, voice."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import news as news_svc
from .. import voice as voice_svc
from ..db import get_db
from ..market.universe import resolve
from ..models import Comment, Follow, JournalEntry, Post, PostLike, Trade, User, Account
from ..schemas import CommentIn, JournalIn, PostIn, VoiceIn
from ..security import get_current_user, get_main_account, get_optional_user
from ..serializers import iso, post_out, user_public

router = APIRouter(tags=["community"])
CASHTAG = re.compile(r"\$([A-Za-z][A-Za-z0-9/]{0,9})")


# ---------------------------------------------------------------- news & calendar
@router.get("/api/news")
def news(symbol: str | None = None, category: str | None = None, q: str | None = Query(default=None, max_length=60),
         limit: int = Query(default=50, ge=1, le=200)):
    return news_svc.get_news(symbol, category, q, limit)


@router.get("/api/calendar")
def calendar(impact: str | None = Query(default=None, pattern="^(high|medium|low|holiday)$"),
             country: str | None = Query(default=None, max_length=4), with_news: bool = True):
    return news_svc.get_calendar(impact, country, with_news)


# ---------------------------------------------------------------- voice
@router.post("/api/voice/parse")
def voice(body: VoiceIn):
    return voice_svc.parse(body.text)


# ---------------------------------------------------------------- social feed
def _posts_out(db: Session, posts: list[Post], viewer: User | None) -> list[dict]:
    ids = [p.id for p in posts]
    if not ids:
        return []
    likes = dict(db.query(PostLike.post_id, func.count()).filter(PostLike.post_id.in_(ids)).group_by(PostLike.post_id).all())
    comments = dict(db.query(Comment.post_id, func.count()).filter(Comment.post_id.in_(ids)).group_by(Comment.post_id).all())
    mine = set()
    if viewer:
        mine = {pid for (pid,) in db.query(PostLike.post_id).filter(PostLike.post_id.in_(ids), PostLike.user_id == viewer.id)}
    return [post_out(p, likes.get(p.id, 0), comments.get(p.id, 0), p.id in mine) for p in posts]


@router.get("/api/social/feed")
def feed(scope: str = Query(default="all", pattern="^(all|following|mine)$"), symbol: str | None = None,
         before: int | None = None, limit: int = Query(default=30, ge=1, le=100),
         viewer: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    q = db.query(Post)
    if scope == "following" and viewer:
        q = q.filter(Post.user_id.in_(db.query(Follow.followee_id).filter(Follow.follower_id == viewer.id)))
    elif scope == "mine" and viewer:
        q = q.filter(Post.user_id == viewer.id)
    if before:
        q = q.filter(Post.id < before)
    posts = q.order_by(Post.id.desc()).limit(limit * (4 if symbol else 1)).all()
    if symbol:
        inst = resolve(symbol)
        posts = [p for p in posts if inst and inst.symbol in (p.symbols or [])][:limit]
    return _posts_out(db, posts, viewer)


@router.post("/api/social/posts", status_code=201)
def create_post(body: PostIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recent = db.query(Post).filter(Post.user_id == user.id, Post.created_at > datetime.now(timezone.utc) - timedelta(minutes=1)).count()
    if recent >= 5:
        raise HTTPException(429, "Slow down: max 5 posts per minute")
    syms = []
    for tag in CASHTAG.findall(body.body):
        inst = resolve(tag)
        if inst and inst.symbol not in syms:
            syms.append(inst.symbol)
    p = Post(user_id=user.id, body=body.body, symbols=syms, sentiment=body.sentiment)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _posts_out(db, [p], user)[0]


@router.delete("/api/social/posts/{post_id}")
def delete_post(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p or (p.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "Post not found")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/api/social/posts/{post_id}/like")
def like(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.get(Post, post_id):
        raise HTTPException(404, "Post not found")
    existing = db.query(PostLike).filter(PostLike.post_id == post_id, PostLike.user_id == user.id).first()
    if existing:
        db.delete(existing)
        liked = False
    else:
        db.add(PostLike(post_id=post_id, user_id=user.id))
        liked = True
    db.commit()
    return {"liked": liked, "likes": db.query(PostLike).filter(PostLike.post_id == post_id).count()}


@router.get("/api/social/posts/{post_id}/comments")
def comments(post_id: int, db: Session = Depends(get_db)):
    rows = db.query(Comment).filter(Comment.post_id == post_id).order_by(Comment.id).limit(200)
    return [{"id": c.id, "author": user_public(c.author), "body": c.body, "created_at": iso(c.created_at)} for c in rows]


@router.post("/api/social/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: int, body: CommentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.get(Post, post_id):
        raise HTTPException(404, "Post not found")
    c = Comment(post_id=post_id, user_id=user.id, body=body.body)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "author": user_public(user), "body": c.body, "created_at": iso(c.created_at)}


@router.post("/api/social/users/{username}/follow")
def follow(username: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target or target.id == user.id:
        raise HTTPException(404, "User not found")
    existing = db.query(Follow).filter(Follow.follower_id == user.id, Follow.followee_id == target.id).first()
    if existing:
        db.delete(existing)
        following = False
    else:
        db.add(Follow(follower_id=user.id, followee_id=target.id))
        following = True
    db.commit()
    return {"following": following}


@router.get("/api/social/users/{username}")
def profile(username: str, viewer: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    from ..trading.engine import account_summary

    u = db.query(User).filter(User.username == username.lower()).first()
    if not u:
        raise HTTPException(404, "User not found")
    acct = get_main_account(db, u)
    s = account_summary(db, acct, include_positions=False)
    followers = db.query(Follow).filter(Follow.followee_id == u.id).count()
    following = db.query(Follow).filter(Follow.follower_id == u.id).count()
    is_following = bool(viewer and db.query(Follow).filter(Follow.follower_id == viewer.id, Follow.followee_id == u.id).first())
    posts = db.query(Post).filter(Post.user_id == u.id).order_by(Post.id.desc()).limit(20).all()
    return {**user_public(u), "followers": followers, "following": following, "is_following": is_following,
            "return_pct": round(s["total_pnl_pct"], 2), "posts": _posts_out(db, posts, viewer)}


@router.get("/api/social/trending")
def trending(hours: int = Query(default=24, ge=1, le=168), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    cnt: Counter = Counter()
    sent: dict[str, Counter] = defaultdict(Counter)
    for p in db.query(Post).filter(Post.created_at >= since):
        for s in p.symbols or []:
            cnt[s] += 1
            sent[s][p.sentiment] += 1
    return [{"symbol": s, "mentions": n, "bullish": sent[s]["bullish"], "bearish": sent[s]["bearish"]} for s, n in cnt.most_common(10)]


@router.get("/api/social/leaderboard")
def leaderboard(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    from ..trading.engine import account_summary

    rows = []
    for acct in db.query(Account).filter(Account.competition_id.is_(None)).limit(500):
        s = account_summary(db, acct, include_positions=False)
        rows.append({"user": user_public(acct.user), "return_pct": round(s["total_pnl_pct"], 3), "equity": round(s["equity"], 2)})
    rows.sort(key=lambda r: -r["return_pct"])
    return [{"rank": i + 1, **r} for i, r in enumerate(rows[:limit])]


# ---------------------------------------------------------------- trading journal
def _entry_out(e: JournalEntry) -> dict:
    return {"id": e.id, "trade_id": e.trade_id, "symbol": e.symbol, "title": e.title, "body": e.body, "setup": e.setup,
            "emotion": e.emotion, "tags": e.tags or [], "rating": e.rating, "pnl": e.pnl, "created_at": iso(e.created_at)}


@router.get("/api/journal")
def journal(tag: str | None = None, symbol: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(JournalEntry).filter(JournalEntry.user_id == user.id)
    if symbol:
        inst = resolve(symbol)
        q = q.filter(JournalEntry.symbol == (inst.symbol if inst else symbol))
    rows = [_entry_out(e) for e in q.order_by(JournalEntry.id.desc()).limit(500)]
    if tag:
        rows = [r for r in rows if tag.lower() in r["tags"]]
    return rows


def _owned_trade(db: Session, user: User, trade_id: int | None) -> Trade | None:
    if not trade_id:
        return None
    t = db.get(Trade, trade_id)
    if not t or db.get(Account, t.account_id).user_id != user.id:
        raise HTTPException(404, "Trade not found")
    return t


@router.post("/api/journal", status_code=201)
def add_entry(body: JournalIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _owned_trade(db, user, body.trade_id)
    inst = resolve(body.symbol) if body.symbol else (resolve(t.symbol) if t else None)
    pnl = body.pnl if body.pnl is not None else ((t.realized_pnl - t.fee) if t and t.closes_position else None)
    e = JournalEntry(user_id=user.id, trade_id=t.id if t else None, symbol=inst.symbol if inst else (t.symbol if t else None),
                     title=body.title, body=body.body, setup=body.setup, emotion=body.emotion, tags=body.tags, rating=body.rating, pnl=pnl)
    db.add(e)
    db.commit()
    db.refresh(e)
    return _entry_out(e)


@router.put("/api/journal/{entry_id}")
def edit_entry(entry_id: int, body: JournalIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    e = db.get(JournalEntry, entry_id)
    if not e or e.user_id != user.id:
        raise HTTPException(404, "Entry not found")
    _owned_trade(db, user, body.trade_id)
    for k, v in body.model_dump().items():
        if k == "symbol" and v:
            inst = resolve(v)
            v = inst.symbol if inst else None
        setattr(e, k, v)
    db.commit()
    return _entry_out(e)


@router.delete("/api/journal/{entry_id}")
def delete_entry(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.query(JournalEntry).filter(JournalEntry.id == entry_id, JournalEntry.user_id == user.id).delete()
    db.commit()
    if not n:
        raise HTTPException(404, "Entry not found")
    return {"ok": True}


@router.get("/api/journal/unjournaled")
def unjournaled(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Closed trades that don't have a journal entry yet (prompts the user to reflect)."""
    acct_ids = [a.id for a in db.query(Account).filter(Account.user_id == user.id)]
    done = {tid for (tid,) in db.query(JournalEntry.trade_id).filter(JournalEntry.user_id == user.id, JournalEntry.trade_id.isnot(None))}
    rows = db.query(Trade).filter(Trade.account_id.in_(acct_ids), Trade.closes_position.is_(True)).order_by(Trade.id.desc()).limit(50)
    from ..serializers import trade_out

    return [trade_out(t) for t in rows if t.id not in done]


@router.get("/api/journal/analytics")
def journal_analytics(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entries = db.query(JournalEntry).filter(JournalEntry.user_id == user.id).all()

    def group(key):
        g: dict[str, dict] = defaultdict(lambda: {"entries": 0, "pnl": 0.0, "wins": 0, "with_pnl": 0})
        for e in entries:
            keys = (e.tags or []) if key == "tags" else [getattr(e, key) or "(none)"]
            for k in keys:
                b = g[str(k)]
                b["entries"] += 1
                if e.pnl is not None:
                    b["pnl"] += e.pnl
                    b["with_pnl"] += 1
                    b["wins"] += e.pnl > 0
        return sorted(({"key": k, "entries": v["entries"], "pnl": round(v["pnl"], 2),
                        "win_rate": round(v["wins"] / v["with_pnl"] * 100, 1) if v["with_pnl"] else None} for k, v in g.items()),
                      key=lambda r: -r["pnl"])

    by_emotion = group("emotion")
    by_setup = group("setup")
    tips = []
    worst_emotion = min((r for r in by_emotion if r["win_rate"] is not None), key=lambda r: r["pnl"], default=None)
    if worst_emotion and worst_emotion["pnl"] < 0:
        tips.append(f"Trades taken while feeling '{worst_emotion['key']}' lost {abs(worst_emotion['pnl']):,.2f} in total. Consider a cooling-off rule.")
    best_setup = max((r for r in by_setup if r["win_rate"] is not None and r["key"] != "(none)"), key=lambda r: r["pnl"], default=None)
    if best_setup and best_setup["pnl"] > 0:
        tips.append(f"Your best setup is '{best_setup['key']}' ({best_setup['win_rate']}% win rate). Focus on it.")
    return {
        "entries": len(entries), "avg_rating": round(sum(e.rating for e in entries) / len(entries), 2) if entries else None,
        "by_emotion": by_emotion, "by_setup": by_setup, "by_tag": group("tags"), "by_rating": group("rating"), "tips": tips,
    }
