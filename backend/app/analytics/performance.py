"""Portfolio performance analytics: equity curve, returns, risk & trade statistics."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy.orm import Session

from ..models import Account, EquitySnapshot, Trade, aware


def equity_curve(db: Session, account: Account, days: int = 365) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    snaps = (
        db.query(EquitySnapshot)
        .filter(EquitySnapshot.account_id == account.id, EquitySnapshot.ts >= since)
        .order_by(EquitySnapshot.ts)
        .all()
    )
    pts = [{"t": int(aware(account.created_at).timestamp()), "equity": account.starting_balance}]
    pts += [{"t": int(aware(s.ts).timestamp()), "equity": round(s.equity, 2)} for s in snaps]
    return pts


def _daily(points: list[dict]) -> list[float]:
    by_day: dict[str, float] = {}
    for p in points:
        by_day[datetime.fromtimestamp(p["t"], timezone.utc).strftime("%Y-%m-%d")] = p["equity"]
    return [by_day[k] for k in sorted(by_day)]


def risk_metrics(equities: list[float], periods_per_year: int = 365, rf: float = 0.05) -> dict:
    if len(equities) < 2:
        return {"sharpe": None, "sortino": None, "volatility": None, "max_drawdown_pct": 0.0, "calmar": None, "var_95_pct": None}
    e = np.asarray(equities, dtype=float)
    r = np.diff(e) / e[:-1]
    peak = np.maximum.accumulate(e)
    dd = (e - peak) / peak
    mdd = float(dd.min())
    vol = float(r.std(ddof=1)) if len(r) > 1 else 0.0
    rf_p = rf / periods_per_year
    downside = r[r < 0]
    dvol = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    total = e[-1] / e[0] - 1
    years = max(len(r) / periods_per_year, 1 / periods_per_year)
    cagr = (1 + total) ** (1 / years) - 1 if total > -1 else -1.0
    return {
        "sharpe": round((r.mean() - rf_p) / vol * math.sqrt(periods_per_year), 3) if vol > 0 else None,
        "sortino": round((r.mean() - rf_p) / dvol * math.sqrt(periods_per_year), 3) if dvol > 0 else None,
        "volatility": round(vol * math.sqrt(periods_per_year) * 100, 3),
        "max_drawdown_pct": round(mdd * 100, 3),
        "calmar": round(cagr / abs(mdd), 3) if mdd < 0 else None,
        "cagr_pct": round(cagr * 100, 3),
        "var_95_pct": round(float(np.percentile(r, 5)) * 100, 3) if len(r) >= 5 else None,
        "drawdown_series": [round(float(x) * 100, 3) for x in dd],
    }


def trade_stats(trades: list[Trade]) -> dict:
    closed = [t for t in trades if t.closes_position or t.realized_pnl]
    nets = [t.realized_pnl - t.fee for t in closed]
    wins = [x for x in nets if x > 0]
    losses = [x for x in nets if x <= 0]
    gross_win, gross_loss = sum(wins), -sum(losses)
    # streaks
    best = worst = cw = cl = 0
    for x in nets:
        if x > 0:
            cw, cl = cw + 1, 0
        else:
            cw, cl = 0, cl + 1
        best, worst = max(best, cw), max(worst, cl)
    by_symbol: dict[str, dict] = defaultdict(lambda: {"trades": 0, "pnl": 0.0, "wins": 0})
    by_class: dict[str, float] = defaultdict(float)
    for t, n in zip(closed, nets):
        b = by_symbol[t.symbol]
        b["trades"] += 1
        b["pnl"] += n
        b["wins"] += n > 0
        by_class[t.asset_class] += n
    return {
        "total_trades": len(trades),
        "closed_trades": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(closed) * 100, 2) if closed else 0.0,
        "avg_win": round(gross_win / len(wins), 2) if wins else 0.0,
        "avg_loss": round(-gross_loss / len(losses), 2) if losses else 0.0,
        "largest_win": round(max(wins), 2) if wins else 0.0,
        "largest_loss": round(min(losses), 2) if losses else 0.0,
        "profit_factor": round(gross_win / gross_loss, 3) if gross_loss > 0 else (None if not wins else float("inf")),
        "expectancy": round(sum(nets) / len(nets), 2) if nets else 0.0,
        "realized_pnl": round(sum(nets), 2),
        "fees_paid": round(sum(t.fee for t in trades), 2),
        "best_streak": best,
        "worst_streak": abs(worst),
        "by_symbol": sorted(({"symbol": k, **{kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in v.items()}} for k, v in by_symbol.items()), key=lambda r: -r["pnl"]),
        "by_asset_class": {k: round(v, 2) for k, v in by_class.items()},
    }


def monthly_returns(points: list[dict]) -> list[dict]:
    by_month: dict[str, list[float]] = defaultdict(list)
    for p in points:
        by_month[datetime.fromtimestamp(p["t"], timezone.utc).strftime("%Y-%m")].append(p["equity"])
    out, prev_end = [], None
    for m in sorted(by_month):
        vals = by_month[m]
        start = prev_end if prev_end is not None else vals[0]
        out.append({"month": m, "return_pct": round((vals[-1] / start - 1) * 100, 3) if start else 0.0})
        prev_end = vals[-1]
    return out


def full_report(db: Session, account: Account, summary: dict) -> dict:
    curve = equity_curve(db, account)
    curve.append({"t": int(datetime.now(timezone.utc).timestamp()), "equity": round(summary["equity"], 2)})
    trades = db.query(Trade).filter(Trade.account_id == account.id).order_by(Trade.created_at).all()
    stats = trade_stats(trades)
    if stats["profit_factor"] == float("inf"):
        stats["profit_factor"] = None
    daily = _daily(curve)
    risk = risk_metrics(daily if len(daily) >= 3 else [p["equity"] for p in curve])
    return {
        "summary": {k: v for k, v in summary.items() if k not in ("positions", "option_positions")},
        "equity_curve": curve,
        "risk": risk,
        "trades": stats,
        "monthly_returns": monthly_returns(curve),
        "insights": insights(stats, risk, summary),
    }


def insights(stats: dict, risk: dict, summary: dict) -> list[str]:
    """Plain-language coaching notes derived from the numbers."""
    out = []
    if stats["closed_trades"] < 5:
        out.append("Close at least 5 trades to get statistically meaningful analytics.")
    if stats["closed_trades"] >= 5:
        if stats["avg_loss"] and stats["avg_win"] and abs(stats["avg_loss"]) > stats["avg_win"]:
            out.append("Your average loss is larger than your average win - consider tighter stop-losses or letting winners run.")
        if stats["win_rate"] < 40 and (stats["profit_factor"] or 0) < 1:
            out.append("Win rate under 40% with a profit factor below 1: review your entry criteria in the Trading Journal.")
        if (stats["profit_factor"] or 0) > 1.5:
            out.append("Profit factor above 1.5 - your edge looks positive. Keep position sizing consistent.")
    if risk.get("max_drawdown_pct") is not None and risk["max_drawdown_pct"] < -20:
        out.append("Drawdown exceeded 20%. Try the Stress Test tool to see which positions drive the risk.")
    alloc = {a["asset_class"]: a["pct"] for a in summary.get("allocation", [])}
    biggest = max(((k, v) for k, v in alloc.items() if k != "cash"), key=lambda kv: kv[1], default=None)
    if biggest and biggest[1] > 60:
        out.append(f"{biggest[1]:.0f}% of your portfolio is in {biggest[0]} - diversifying would reduce concentration risk.")
    if summary.get("margin_level_pct") and summary["margin_level_pct"] < 150:
        out.append("Margin level below 150% - you are close to a margin call.")
    return out
