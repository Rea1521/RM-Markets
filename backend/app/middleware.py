"""Rate limiting, security headers, request ids and uniform error responses."""
from __future__ import annotations

import logging
import time
import uuid

import jwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware

from .cache import get_cache
from .config import get_settings
from .security import client_ip

log = logging.getLogger("rm.http")


def _identity(request: Request) -> str:
    """Rate-limit per user when authenticated (decoded without DB hit), else per IP."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            data = jwt.decode(auth[7:], get_settings().jwt_secret, algorithms=["HS256"], options={"verify_exp": False})
            return f"u:{data.get('sub')}"
        except jwt.PyJWTError:
            pass
    return f"ip:{client_ip(request)}"


class RateLimitMiddleware(BaseHTTPMiddleware):
    WINDOW = 60

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api") and not path.startswith("/graphql"):
            return await call_next(request)
        s = get_settings()
        bucket, limit = "default", s.rate_limit_per_minute
        if path.startswith("/api/auth/login") or path.startswith("/api/auth/register") or path.startswith("/api/auth/demo"):
            bucket, limit = "auth", s.auth_rate_limit_per_minute
        elif path.startswith("/api/trading/orders") and request.method == "POST":
            bucket, limit = "orders", s.order_rate_limit_per_minute
        elif path.startswith("/api/analytics/backtest") or path.startswith("/api/analytics/ml/train"):
            bucket, limit = "heavy", 30
        ident = _identity(request) if bucket != "auth" else f"ip:{client_ip(request)}"
        window = int(time.time() // self.WINDOW)
        key = f"rl:{bucket}:{ident}:{window}"
        n = get_cache().incr_window(key, self.WINDOW + 5)
        reset = (window + 1) * self.WINDOW - int(time.time())
        if n > limit:
            return JSONResponse(
                {"error": "rate_limited", "detail": f"Too many requests. Limit is {limit}/minute.", "retry_after": reset},
                status_code=429,
                headers={"Retry-After": str(reset), "X-RateLimit-Limit": str(limit), "X-RateLimit-Remaining": "0"},
            )
        resp = await call_next(request)
        resp.headers["X-RateLimit-Limit"] = str(limit)
        resp.headers["X-RateLimit-Remaining"] = str(max(0, limit - n))
        return resp


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        resp = await call_next(request)
        resp.headers["X-Request-ID"] = rid
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        resp.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)"
        if get_settings().is_production:
            resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        resp.headers.setdefault("Cache-Control", "no-store")
        dur = (time.perf_counter() - start) * 1000
        resp.headers["Server-Timing"] = f"app;dur={dur:.1f}"
        if dur > 2000:
            log.warning("slow request %s %s %.0fms rid=%s", request.method, request.url.path, dur, rid)
        return resp


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exc(request: Request, exc: HTTPException):
        return JSONResponse({"error": _code(exc.status_code), "detail": exc.detail}, status_code=exc.status_code,
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_exc(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
        first = errors[0] if errors else {"field": "", "message": "Invalid input"}
        return JSONResponse({"error": "validation_error", "detail": f"{first['field']}: {first['message']}".strip(": "), "errors": errors},
                            status_code=422)

    @app.exception_handler(IntegrityError)
    async def integrity_exc(request: Request, exc: IntegrityError):
        log.info("integrity error: %s", exc.orig)
        return JSONResponse({"error": "conflict", "detail": "That record already exists or conflicts with another."}, status_code=409)

    @app.exception_handler(SQLAlchemyError)
    async def db_exc(request: Request, exc: SQLAlchemyError):
        log.exception("database error")
        return JSONResponse({"error": "database_error", "detail": "A database error occurred. Please retry."}, status_code=503)

    @app.exception_handler(PermissionError)
    async def perm_exc(request: Request, exc: PermissionError):
        return JSONResponse({"error": "unauthorized", "detail": str(exc)}, status_code=401)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"error": "internal_error", "detail": "Something went wrong on our side."}, status_code=500)


def _code(status: int) -> str:
    return {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 422: "rejected",
            429: "rate_limited", 501: "not_implemented", 503: "unavailable"}.get(status, "error")
