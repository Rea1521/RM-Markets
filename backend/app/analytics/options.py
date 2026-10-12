"""Black-Scholes(-Merton) pricing, Greeks, implied volatility and option chains."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np


def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def black_scholes(S: float, K: float, T: float, r: float, sigma: float, kind: str, q: float = 0.0) -> dict:
    """Price + Greeks. T in years. Theta is per calendar day, vega/rho per 1 percentage point."""
    kind = kind.lower()
    if T <= 0 or sigma <= 0:
        intrinsic = max(0.0, S - K) if kind == "call" else max(0.0, K - S)
        delta = (1.0 if S > K else 0.0) if kind == "call" else (-1.0 if S < K else 0.0)
        return {"price": intrinsic, "delta": delta, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
    sq = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / sq
    d2 = d1 - sq
    disc_r, disc_q = math.exp(-r * T), math.exp(-q * T)
    if kind == "call":
        price = S * disc_q * _ncdf(d1) - K * disc_r * _ncdf(d2)
        delta = disc_q * _ncdf(d1)
        theta = (-S * disc_q * _npdf(d1) * sigma / (2 * math.sqrt(T)) - r * K * disc_r * _ncdf(d2) + q * S * disc_q * _ncdf(d1))
        rho = K * T * disc_r * _ncdf(d2)
    else:
        price = K * disc_r * _ncdf(-d2) - S * disc_q * _ncdf(-d1)
        delta = disc_q * (_ncdf(d1) - 1)
        theta = (-S * disc_q * _npdf(d1) * sigma / (2 * math.sqrt(T)) + r * K * disc_r * _ncdf(-d2) - q * S * disc_q * _ncdf(-d1))
        rho = -K * T * disc_r * _ncdf(-d2)
    gamma = disc_q * _npdf(d1) / (S * sq)
    vega = S * disc_q * _npdf(d1) * math.sqrt(T)
    return {"price": price, "delta": delta, "gamma": gamma, "theta": theta / 365, "vega": vega / 100, "rho": rho / 100}


def implied_vol(price: float, S: float, K: float, T: float, r: float, kind: str) -> float | None:
    lo, hi = 1e-4, 5.0
    for _ in range(100):
        mid = (lo + hi) / 2
        p = black_scholes(S, K, T, r, mid, kind)["price"]
        if abs(p - price) < 1e-6:
            return mid
        if p > price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def realized_vol(closes: list[float], periods_per_year: int) -> float:
    if len(closes) < 3:
        return 0.3
    r = np.diff(np.log(np.asarray(closes[-60:], dtype=float)))
    v = float(r.std(ddof=1) * math.sqrt(periods_per_year))
    return min(max(v, 0.05), 3.0)


def smile(sigma: float, S: float, K: float, T: float) -> float:
    """Simple volatility smile/skew so OTM puts are richer (equity-like skew)."""
    m = math.log(K / S) / max(math.sqrt(T), 0.05)
    return max(0.03, sigma * (1 + 0.10 * m * m - 0.08 * m))


def upcoming_expiries(now: datetime | None = None, n: int = 6) -> list[datetime]:
    now = now or datetime.now(timezone.utc)
    d = now.date()
    out = []
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() == 4:  # Fridays
            out.append(datetime(d.year, d.month, d.day, 20, 0, tzinfo=timezone.utc))
    # plus two monthly (third Friday) expiries further out
    m = now.month
    y = now.year
    added = 0
    while added < 2:
        m += 1
        if m > 12:
            m, y = 1, y + 1
        first = datetime(y, m, 1, 20, 0, tzinfo=timezone.utc)
        third_fri = first + timedelta(days=(4 - first.weekday()) % 7 + 14)
        if third_fri > out[-1]:
            out.append(third_fri)
            added += 1
    return out


def strike_step(S: float) -> float:
    raw = S * 0.025
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


def chain(S: float, sigma: float, r: float, expiry: datetime, n_strikes: int = 9, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    T = max((expiry - now).total_seconds() / (365 * 86400), 1 / (365 * 24))
    step = strike_step(S)
    atm = round(S / step) * step
    rows = []
    for i in range(-n_strikes, n_strikes + 1):
        K = round(atm + i * step, 8)
        if K <= 0:
            continue
        iv = smile(sigma, S, K, T)
        c = black_scholes(S, K, T, r, iv, "call")
        p = black_scholes(S, K, T, r, iv, "put")
        rows.append({"strike": K, "iv": iv, "call": _r(c), "put": _r(p), "itm_call": S > K, "itm_put": S < K})
    return rows


def _r(d: dict) -> dict:
    return {k: round(v, 6) for k, v in d.items()}


def years_to(expiry: datetime, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return max((expiry - now).total_seconds() / (365 * 86400), 0.0)


def payoff(legs: list[dict], S: float, r: float, sigma: float, points: int = 81) -> dict:
    """Strategy payoff at expiry and today for multi-leg positions.
    leg = {type: call|put|stock, strike, expiry(iso), qty (+long/-short), premium}"""
    lo, hi = S * 0.6, S * 1.4
    xs = np.linspace(lo, hi, points)
    at_exp, today = np.zeros(points), np.zeros(points)
    net_greeks = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    for leg in legs:
        q = float(leg["qty"])
        if leg["type"] == "stock":
            at_exp += q * (xs - leg.get("premium", S))
            today += q * (xs - leg.get("premium", S))
            net_greeks["delta"] += q
            continue
        K, prem = float(leg["strike"]), float(leg["premium"])
        T = years_to(datetime.fromisoformat(leg["expiry"]))
        iv = smile(sigma, S, K, max(T, 1e-3))
        intrinsic = np.maximum(xs - K, 0) if leg["type"] == "call" else np.maximum(K - xs, 0)
        at_exp += q * (intrinsic - prem)
        today += q * (np.array([black_scholes(x, K, T, r, iv, leg["type"])["price"] for x in xs]) - prem)
        g = black_scholes(S, K, T, r, iv, leg["type"])
        for k in net_greeks:
            net_greeks[k] += q * g[k]
    # breakevens where expiry P&L crosses zero
    be = []
    for i in range(1, points):
        if (at_exp[i - 1] < 0) != (at_exp[i] < 0):
            x0, x1, y0, y1 = xs[i - 1], xs[i], at_exp[i - 1], at_exp[i]
            be.append(round(float(x0 - y0 * (x1 - x0) / (y1 - y0)), 4))
    return {
        "prices": [round(float(x), 4) for x in xs], "expiry_pnl": [round(float(y), 4) for y in at_exp],
        "today_pnl": [round(float(y), 4) for y in today], "max_profit": round(float(at_exp.max()), 4),
        "max_loss": round(float(at_exp.min()), 4), "breakevens": be, "greeks": {k: round(v, 6) for k, v in net_greeks.items()},
    }
