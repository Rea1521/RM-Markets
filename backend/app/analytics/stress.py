"""Portfolio stress testing: historical scenarios, custom shocks and Monte Carlo VaR."""
from __future__ import annotations

import numpy as np

from ..market import service as market
from ..market.universe import resolve
from . import options as opt

# Approximate peak-to-trough moves per asset class during famous episodes.
SCENARIOS: dict[str, dict] = {
    "gfc_2008": {"name": "Global Financial Crisis (2008)", "shocks": {"stock": -0.45, "index": -0.45, "crypto": -0.70, "commodity": -0.30, "forex": 0.05},
                 "overrides": {"XAUUSD": 0.05, "USDJPY": -0.20, "USDZAR": 0.45, "JPM": -0.60}},
    "covid_2020": {"name": "COVID crash (Feb-Mar 2020)", "shocks": {"stock": -0.34, "index": -0.34, "crypto": -0.50, "commodity": -0.25, "forex": 0.03},
                   "overrides": {"WTI": -0.65, "XAUUSD": -0.03, "BA": -0.70, "USDZAR": 0.27}},
    "dotcom_2000": {"name": "Dot-com bust (2000-02)", "shocks": {"stock": -0.50, "index": -0.45, "crypto": -0.80, "commodity": 0.0, "forex": 0.0},
                    "overrides": {"NDX": -0.78, "AMZN": -0.90, "INTC": -0.80}},
    "crypto_winter_2022": {"name": "Crypto winter (2022)", "shocks": {"stock": -0.20, "index": -0.20, "crypto": -0.75, "commodity": 0.05, "forex": 0.02},
                           "overrides": {"BTCUSDT": -0.65, "SOLUSDT": -0.94, "NDX": -0.33}},
    "rate_shock": {"name": "Rate shock (+300bp)", "shocks": {"stock": -0.20, "index": -0.18, "crypto": -0.35, "commodity": -0.05, "forex": 0.04},
                   "overrides": {"XAUUSD": -0.10, "USDJPY": 0.10}},
    "black_monday_1987": {"name": "Black Monday (1987, one day)", "shocks": {"stock": -0.22, "index": -0.22, "crypto": -0.30, "commodity": -0.05, "forex": 0.0}, "overrides": {}},
    "usd_rally": {"name": "Strong-dollar rally", "shocks": {"stock": -0.05, "index": -0.08, "crypto": -0.15, "commodity": -0.12, "forex": 0.0},
                  "overrides": {"EURUSD": -0.12, "GBPUSD": -0.12, "AUDUSD": -0.15, "USDJPY": 0.12, "USDZAR": 0.20, "USDCHF": 0.10}},
    "bull_melt_up": {"name": "Bull melt-up", "shocks": {"stock": 0.25, "index": 0.20, "crypto": 0.80, "commodity": 0.10, "forex": 0.0}, "overrides": {}},
}


def _shock_for(symbol: str, asset_class: str, scenario: dict) -> float:
    return scenario.get("overrides", {}).get(symbol, scenario["shocks"].get(asset_class, 0.0))


def apply_scenario(summary: dict, scenario: dict, r: float = 0.05) -> dict:
    rows, total = [], 0.0
    for p in summary.get("positions", []):
        shock = _shock_for(p["symbol"], p["asset_class"], scenario)
        pnl = p["market_value"] * shock
        total += pnl
        rows.append({"symbol": p["symbol"], "display": p["display"], "shock_pct": shock * 100, "pnl": pnl,
                     "value_before": p["market_value"], "value_after": p["market_value"] + pnl})
    for op in summary.get("option_positions", []):
        inst = resolve(op["underlying"])
        shock = _shock_for(inst.symbol, inst.asset_class, scenario)
        S = market.get_price(inst.symbol)
        from datetime import datetime

        T = opt.years_to(datetime.fromisoformat(op["expiry"]))
        sig = opt.smile(0.4 * (1.5 if shock < 0 else 1.0), S * (1 + shock), op["strike"], max(T, 1e-3))
        new_mark = opt.black_scholes(S * (1 + shock), op["strike"], T, r, sig, op["option_type"])["price"]
        mult = inst.option_multiplier
        pnl = (new_mark - op["mark"]) * op["contracts"] * mult
        total += pnl
        rows.append({"symbol": f"{inst.symbol} {op['option_type']} {op['strike']:g}", "display": f"{inst.display} {op['option_type']} {op['strike']:g}",
                     "shock_pct": shock * 100, "pnl": pnl, "value_before": op["market_value"], "value_after": op["market_value"] + pnl})
    eq = summary["equity"]
    rows.sort(key=lambda x: x["pnl"])
    return {"name": scenario.get("name", "Custom"), "pnl": total, "pnl_pct": total / eq * 100 if eq else 0.0,
            "equity_before": eq, "equity_after": eq + total, "positions": rows,
            "margin_call": (eq + total) < summary.get("margin_used", 0) * 0.5}


def monte_carlo(summary: dict, horizon_days: int = 10, paths: int = 5000, seed: int | None = 7) -> dict:
    pos = summary.get("positions", [])
    eq = summary["equity"]
    if not pos:
        return {"horizon_days": horizon_days, "var_95": 0.0, "var_99": 0.0, "cvar_95": 0.0, "histogram": [], "paths": paths,
                "note": "No open positions"}
    rets, weights = [], []
    for p in pos:
        c = np.asarray(market.closes(p["symbol"], "1D", 260), dtype=float)
        r = np.diff(np.log(c))
        rets.append(r[-250:])
        weights.append(p["market_value"])
    n = min(len(r) for r in rets)
    R = np.vstack([r[-n:] for r in rets]).T  # days x assets
    w = np.asarray(weights)
    rng = np.random.default_rng(seed)
    # bootstrap whole days to preserve cross-asset correlation
    idx = rng.integers(0, n, size=(paths, horizon_days))
    cum = np.exp(R[idx].sum(axis=1)) - 1  # paths x assets
    pnl = cum @ w
    var95, var99 = -np.percentile(pnl, 5), -np.percentile(pnl, 1)
    cvar95 = -pnl[pnl <= np.percentile(pnl, 5)].mean()
    hist, edges = np.histogram(pnl, bins=40)
    corr = np.corrcoef(R.T) if R.shape[1] > 1 else np.ones((1, 1))
    return {
        "horizon_days": horizon_days, "paths": paths,
        "var_95": float(var95), "var_99": float(var99), "cvar_95": float(cvar95),
        "var_95_pct": float(var95 / eq * 100), "expected_pnl": float(pnl.mean()),
        "prob_loss_pct": float((pnl < 0).mean() * 100),
        "worst": float(pnl.min()), "best": float(pnl.max()),
        "histogram": [{"from": float(edges[i]), "to": float(edges[i + 1]), "count": int(hist[i])} for i in range(len(hist))],
        "correlation": {"symbols": [p["symbol"] for p in pos], "matrix": [[round(float(x), 3) for x in row] for row in np.atleast_2d(corr)]},
    }
