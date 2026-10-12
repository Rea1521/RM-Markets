from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..events import record_event
from ..market.providers import http
from ..models import User
from ..schemas import GoogleIn, LoginIn, PasswordIn, ProfileIn, RefreshIn, RegisterIn
from ..security import create_tokens, get_current_user, get_main_account, hash_password, user_from_token, verify_password
from ..serializers import user_private

router = APIRouter(prefix="/api/auth", tags=["auth"])
_DUMMY_HASH = hash_password("timing-equaliser-not-a-password")


def _session(db: Session, user: User) -> dict:
    get_main_account(db, user)
    return {**create_tokens(user), "user": user_private(user)}


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    exists = db.query(User).filter(or_(func.lower(User.email) == body.email.lower(), User.username == body.username)).first()
    if exists:
        raise HTTPException(409, "Email or username already registered")
    u = User(email=body.email.lower(), username=body.username, display_name=body.display_name or body.username,
             password_hash=hash_password(body.password))
    db.add(u)
    db.commit()
    record_event(db, "user", u.id, "UserRegistered", {"username": u.username}, u.id)
    db.commit()
    return _session(db, u)


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    ident = body.identifier.lower()
    u = db.query(User).filter(or_(func.lower(User.email) == ident, User.username == ident)).first()
    # constant-ish time: always run bcrypt
    ok = verify_password(body.password, (u.password_hash if u and u.password_hash else _DUMMY_HASH))
    if not u or not ok:
        raise HTTPException(401, "Invalid credentials")
    return _session(db, u)


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    u = user_from_token(db, body.refresh_token, "refresh")
    return _session(db, u)


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revokes every token issued to this user (bumps token_version)."""
    user.token_version += 1
    db.commit()
    return {"ok": True}


@router.post("/demo")
def demo_login(db: Session = Depends(get_db)):
    """Mock / guest authentication: creates a throw-away demo user. Disable with ALLOW_DEMO_LOGIN=false."""
    if not get_settings().allow_demo_login:
        raise HTTPException(403, "Demo login disabled")
    tag = secrets.token_hex(3)
    u = User(email=f"demo-{tag}@rm-markets.local", username=f"guest_{tag}", display_name=f"Guest {tag.upper()}",
             is_demo=True, title="Demo Trader")
    db.add(u)
    db.commit()
    return _session(db, u)


@router.post("/oauth/google")
def google_login(body: GoogleIn, db: Session = Depends(get_db)):
    s = get_settings()
    if not s.google_client_id:
        raise HTTPException(501, "Google sign-in is not configured (set GOOGLE_CLIENT_ID)")
    r = http().get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": body.id_token})
    if r.status_code != 200:
        raise HTTPException(401, "Invalid Google token")
    info = r.json()
    if info.get("aud") != s.google_client_id or info.get("email_verified") not in ("true", True):
        raise HTTPException(401, "Google token not issued for this app")
    sub, email = info["sub"], info["email"].lower()
    u = db.query(User).filter(User.oauth_provider == "google", User.oauth_subject == sub).first()
    if not u:
        u = db.query(User).filter(func.lower(User.email) == email).first()
        if u:
            u.oauth_provider, u.oauth_subject = "google", sub
        else:
            base = "".join(ch for ch in email.split("@")[0].lower() if ch.isalnum() or ch in "_.")[:24] or "trader"
            name = base
            while db.query(User).filter(User.username == name).first():
                name = f"{base}{secrets.randbelow(9999)}"
            u = User(email=email, username=name, display_name=info.get("name") or name, oauth_provider="google", oauth_subject=sub)
            db.add(u)
        db.commit()
    return _session(db, u)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_private(user)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.commit()
    return user_private(user)


@router.post("/password")
def change_password(body: PasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.password_hash and not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    db.commit()
    return create_tokens(user)
