from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..analytics import backtest as bt
from ..analytics import ml
from ..analytics import options as opt
from ..analytics import performance, screener, stress
from ..cache import get_cache
from ..config import get_settings
from ..db import get_db
from ..market import service as market
from ..models import BacktestRun, MLModel, User, aware
from ..schemas import BacktestIn, BSIn, MLTrainIn, OptionOrderIn, PayoffIn, ScreenIn, StressIn
from ..security import get_current_user, resolve_account
from ..serializers import iso
from ..trading import engine

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ---------------------------------------------------------------- performance
@router.get("/performance")
def perf(account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    return ml.sanitize(performance.full_report(db, acct, engine.account_summary(db, acct)))


# ---------------------------------------------------------------- stress testing
@router.get("/stress/scenarios")
def scenarios():
    return [{"id": k, "name": v["name"], "shocks": v["shocks"], "overrides": v.get("overrides", {})} for k, v in stress.SCENARIOS.items()]


@router.post("/stress")
def run_stress(body: StressIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, body.account_id)
    summ = engine.account_summary(db, acct)
    r = get_settings().risk_free_rate
    if body.custom_shocks:
        classes = {"crypto", "stock", "forex", "commodity", "index"}
        sc = {"name": "Custom scenario", "shocks": {k: v for k, v in body.custom_shocks.items() if k in classes},
              "overrides": {k.upper(): v for k, v in body.custom_shocks.items() if k not in classes}}
        return {"results": [stress.apply_scenario(summ, sc, r)]}
    ids = [body.scenario] if body.scenario else list(stress.SCENARIOS)
    for i in ids:
        if i not in stress.SCENARIOS:
            raise HTTPException(404, f"Unknown scenario {i}")
    return {"equity": summ["equity"], "results": [stress.apply_scenario(summ, stress.SCENARIOS[i], r) | {"id": i} for i in ids]}


@router.get("/stress/monte-carlo")
def monte_carlo(horizon_days: int = Query(default=10, ge=1, le=250), paths: int = Query(default=5000, ge=500, le=20000),
                account_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, account_id)
    return stress.monte_carlo(engine.account_summary(db, acct), horizon_days, paths)


# ---------------------------------------------------------------- backtesting
@router.get("/backtest/strategies")
def strategies():
    return [{"id": k, "name": v["name"], "defaults": v["defaults"], "grid": v["grid"]} for k, v in bt.STRATEGIES.items()]


def _bt_data(body: BacktestIn):
    if body.strategy not in bt.STRATEGIES:
        raise HTTPException(422, f"Unknown strategy {body.strategy}")
    inst = market.instrument_or_404(body.symbol)
    candles = market.get_history(inst.symbol, body.interval, body.bars)["candles"]
    per_day = {"1h": 24 if inst.is_24_7 else 6.5, "4h": 6 if inst.is_24_7 else 2, "1D": 1, "1W": 1 / 7}[body.interval]
    ppy = int((365 if inst.is_24_7 else 252) * per_day) if body.interval != "1W" else 52
    return inst, candles, ppy


@router.post("/backtest")
def backtest(body: BacktestIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inst, candles, ppy = _bt_data(body)
    res = bt.simulate(candles, body.strategy, body.params, fee_bps=body.fee_bps, allow_short=body.allow_short,
                      initial=body.initial, periods_per_year=ppy, stop_loss_pct=body.stop_loss_pct)
    bench = bt.simulate(candles, "buy_hold", {}, fee_bps=body.fee_bps, initial=body.initial, periods_per_year=ppy)
    db.add(BacktestRun(user_id=user.id, symbol=inst.symbol, strategy=body.strategy, params=res["params"], summary=res["metrics"]))
    db.commit()
    return ml.sanitize({
        "symbol": inst.symbol, "strategy": body.strategy, "params": res["params"], "metrics": res["metrics"],
        "equity": bt.equity_points(candles, res["equity"]), "benchmark": bt.equity_points(candles, bench["equity"]),
        "trades": res["trades"][-200:], "candles": candles,
    })


@router.post("/backtest/optimize")
def optimize(body: BacktestIn, user: User = Depends(get_current_user)):
    inst, candles, ppy = _bt_data(body)
    return ml.sanitize(bt.optimize(candles, body.strategy, body.objective, fee_bps=body.fee_bps, allow_short=body.allow_short,
                                   periods_per_year=ppy, stop_loss_pct=body.stop_loss_pct))


@router.post("/backtest/walk-forward")
def walk_forward(body: BacktestIn, user: User = Depends(get_current_user)):
    inst, candles, ppy = _bt_data(body)
    try:
        res = bt.walk_forward(candles, body.strategy, windows=body.windows, train_ratio=body.train_ratio, objective=body.objective,
                              anchored=body.anchored, fee_bps=body.fee_bps, allow_short=body.allow_short, periods_per_year=ppy,
                              initial=body.initial, stop_loss_pct=body.stop_loss_pct)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return ml.sanitize({"symbol": inst.symbol, **res})


@router.get("/backtest/runs")
def runs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(BacktestRun).filter(BacktestRun.user_id == user.id).order_by(BacktestRun.id.desc()).limit(50)
    return [{"id": r.id, "symbol": r.symbol, "strategy": r.strategy, "params": r.params, "summary": r.summary, "created_at": iso(r.created_at)} for r in rows]


# ---------------------------------------------------------------- options
@router.get("/options/expiries")
def expiries():
    return [e.isoformat() for e in opt.upcoming_expiries()]


@router.get("/options/chain/{symbol}")
def chain(symbol: str, expiry: str | None = None, strikes: int = Query(default=9, ge=3, le=25)):
    inst = market.instrument_or_404(symbol)
    exps = opt.upcoming_expiries()
    try:
        exp = datetime.fromisoformat(expiry) if expiry else exps[2]
    except ValueError:
        raise HTTPException(422, "Invalid expiry")
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    S = market.get_price(inst.symbol)
    sigma = engine.implied_sigma(inst.symbol)
    rows = opt.chain(S, sigma, get_settings().risk_free_rate, exp, strikes)
    return {"underlying": inst.symbol, "display": inst.display, "spot": S, "hist_vol": sigma, "expiry": exp.isoformat(),
            "days_to_expiry": round(opt.years_to(exp) * 365, 2), "multiplier": inst.option_multiplier,
            "expiries": [e.isoformat() for e in exps], "rows": rows}


@router.post("/options/price")
def bs_price(body: BSIn):
    """Black-Scholes calculator."""
    return opt.black_scholes(body.spot, body.strike, body.days / 365, body.rate, body.volatility, body.option_type)


@router.post("/options/payoff")
def payoff(body: PayoffIn):
    inst = market.instrument_or_404(body.underlying)
    S = market.get_price(inst.symbol)
    sigma = engine.implied_sigma(inst.symbol)
    legs = []
    for leg in body.legs:
        d = leg.model_dump()
        if leg.type != "stock":
            if not (leg.strike and leg.expiry):
                raise HTTPException(422, "option legs need strike and expiry")
            exp = datetime.fromisoformat(leg.expiry)
            T = opt.years_to(exp)
            if d.get("premium") is None:
                d["premium"] = opt.black_scholes(S, leg.strike, T, get_settings().risk_free_rate, opt.smile(sigma, S, leg.strike, max(T, 1e-3)), leg.type)["price"]
        elif d.get("premium") is None:
            d["premium"] = S
        legs.append(d)
    res = opt.payoff(legs, S, get_settings().risk_free_rate, sigma)
    mult = inst.option_multiplier
    return {"spot": S, "multiplier": mult, "legs": legs, **res}


@router.post("/options/orders", status_code=201)
def option_order(body: OptionOrderIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = resolve_account(db, user, body.account_id)
    p = engine.trade_option(db, acct, body.underlying, body.option_type, body.strike, body.expiry, body.contracts)
    return {"id": p.id, "underlying": p.underlying, "option_type": p.option_type, "strike": p.strike,
            "expiry": aware(p.expiry).isoformat(), "contracts": p.contracts, "avg_premium": p.avg_premium, "status": p.status}


# ---------------------------------------------------------------- machine learning
def _train_and_store(db: Session, symbol: str, interval: str) -> MLModel:
    inst = market.instrument_or_404(symbol)
    candles = market.get_history(inst.symbol, interval, 1000)["candles"]
    try:
        res = ml.train(candles)
    except ValueError as e:
        raise HTTPException(422, str(e))
    m = MLModel(symbol=inst.symbol, interval=interval, algorithm=res["algorithm"], features=res["features"],
                weights=res["weights"], metrics=ml.sanitize(res["metrics"]))
    db.add(m)
    db.commit()
    return m


@router.post("/ml/train")
def ml_train(body: MLTrainIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _train_and_store(db, body.symbol, body.interval)
    return {"id": m.id, "symbol": m.symbol, "interval": m.interval, "metrics": m.metrics, "trained_at": iso(m.trained_at)}


@router.get("/ml/predict/{symbol}")
def ml_predict(symbol: str, interval: str = Query(default="1D", pattern="^(1h|4h|1D)$"),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    inst = market.instrument_or_404(symbol)
    m = db.query(MLModel).filter(MLModel.symbol == inst.symbol, MLModel.interval == interval).order_by(MLModel.id.desc()).first()
    stale = not m or (datetime.now(timezone.utc) - aware(m.trained_at)).total_seconds() > (6 * 3600 if interval == "1D" else 3600)
    if stale:
        lock = f"ml:training:{inst.symbol}:{interval}"
        if not get_cache().get(lock):
            get_cache().set(lock, 1, 120)
            try:
                m = _train_and_store(db, inst.symbol, interval)
            finally:
                get_cache().delete(lock)
    if not m:
        raise HTTPException(503, "Model is training, try again in a few seconds")
    candles = market.get_history(inst.symbol, interval, 300)["candles"]
    pred = ml.predict({"features": m.features, "weights": m.weights, "metrics": m.metrics}, candles)
    return {"symbol": inst.symbol, "interval": interval, "model_id": m.id, "trained_at": iso(m.trained_at), "metrics": m.metrics, **pred}


@router.get("/ml/models")
def ml_models(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(MLModel).order_by(MLModel.id.desc()).limit(50)
    return [{"id": m.id, "symbol": m.symbol, "interval": m.interval, "algorithm": m.algorithm,
             "accuracy": m.metrics.get("accuracy"), "baseline": m.metrics.get("baseline_accuracy"), "trained_at": iso(m.trained_at)} for m in rows]


# ---------------------------------------------------------------- screener
@router.get("/screener/fields")
def screener_fields():
    return [{"field": k, "label": v[0], "group": v[1], "type": v[2]} for k, v in screener.FIELDS.items()]


@router.get("/screener/presets")
def screener_presets():
    return {"count": len(screener.PRESETS), "presets": screener.PRESETS}


@router.post("/screener")
def screen(body: ScreenIn):
    return screener.run([c.model_dump() for c in body.conditions], body.presets, body.sort, body.desc, body.limit)
