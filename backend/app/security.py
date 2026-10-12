"""JWT authentication (access + refresh tokens), password hashing, FastAPI deps."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Account, User

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def _encode(payload: dict[str, Any], minutes: float) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    body = {**payload, "iat": now, "exp": now + timedelta(minutes=minutes), "iss": "rm-markets"}
    return jwt.encode(body, s.jwt_secret, algorithm=s.jwt_algorithm)


def create_tokens(user: User) -> dict[str, Any]:
    s = get_settings()
    base = {"sub": str(user.id), "ver": user.token_version, "role": user.role}
    return {
        "access_token": _encode({**base, "typ": "access"}, s.access_token_minutes),
        "refresh_token": _encode({**base, "typ": "refresh"}, s.refresh_token_days * 24 * 60),
        "token_type": "bearer",
        "expires_in": s.access_token_minutes * 60,
    }


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    s = get_settings()
    try:
        data = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm], issuer="rm-markets")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if data.get("typ") != expected_type:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return data


def user_from_token(db: Session, token: str, expected_type: str = "access") -> User:
    data = decode_token(token, expected_type)
    user = db.get(User, int(data["sub"]))
    if not user or user.token_version != data.get("ver"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session revoked")
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return user_from_token(db, creds.credentials)


def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    if not creds:
        return None
    try:
        return user_from_token(db, creds.credentials)
    except HTTPException:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


def get_main_account(db: Session, user: User) -> Account:
    acct = (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.competition_id.is_(None))
        .order_by(Account.id)
        .first()
    )
    if not acct:
        from .events import record_event

        s = get_settings()
        acct = Account(user_id=user.id, name="Main", cash=s.starting_balance, starting_balance=s.starting_balance)
        db.add(acct)
        db.flush()
        record_event(db, "account", acct.id, "AccountOpened", {"cash": s.starting_balance}, user.id)
        db.commit()
    return acct


def resolve_account(db: Session, user: User, account_id: int | None) -> Account:
    """Main account by default; competition accounts when an id is passed."""
    if account_id is None:
        return get_main_account(db, user)
    acct = db.get(Account, account_id)
    if not acct or acct.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return acct


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
