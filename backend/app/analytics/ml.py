"""Machine-learning prediction pipeline (numpy only, no heavy deps).

Pipeline: candles -> feature engineering -> chronological train/validation split
-> L2-regularised logistic regression (direction) + ridge regression (magnitude)
-> walk-forward validation metrics -> persisted model (MLModel table) -> predict.

Educational only: next-bar direction is close to a coin flip for liquid markets;
we always report the baseline so users can judge whether the model adds value.
"""
from __future__ import annotations

import math

import numpy as np

from .. import indicators as ind

FEATURES = [
    "ret_1", "ret_2", "ret_3", "ret_5", "ret_10", "rsi_14", "macd_hist_norm", "bb_pctb", "sma20_dist",
    "sma50_dist", "vol_10", "vol_ratio", "atr_norm", "stoch_k", "range_pos",
]


def build_features(candles: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[int]]:
    c = np.array([x["c"] for x in candles], dtype=float)
    h = np.array([x["h"] for x in candles], dtype=float)
    l = np.array([x["l"] for x in candles], dtype=float)
    v = np.array([x["v"] for x in candles], dtype=float)
    lr = np.diff(np.log(c), prepend=np.nan)

    def ret(k):
        out = np.full(len(c), np.nan)
        out[k:] = c[k:] / c[:-k] - 1
        return out

    rsi = ind.rsi(c, 14) / 100 - 0.5
    _, _, hist = ind.macd(c)
    up, mid, lo = ind.bollinger(c, 20, 2)
    with np.errstate(invalid="ignore", divide="ignore"):
        pctb = (c - lo) / (up - lo) - 0.5
        sma20 = c / ind.sma(c, 20) - 1
        sma50 = c / ind.sma(c, 50) - 1
        vol10 = np.array([np.nanstd(lr[max(0, i - 9) : i + 1]) if i >= 10 else np.nan for i in range(len(c))])
        vma = ind.sma(v, 20)
        vratio = np.log((v + 1) / (vma + 1))
        atrn = ind.atr(h, l, c, 14) / c
        k, _ = ind.stochastic(h, l, c)
        rng_pos = (c - l) / (h - l) - 0.5
        macd_n = hist / c
    X = np.column_stack([ret(1), ret(2), ret(3), ret(5), ret(10), rsi, macd_n, pctb, sma20, sma50, vol10, vratio, atrn, k / 100 - 0.5, rng_pos])
    fwd = np.full(len(c), np.nan)
    fwd[:-1] = c[1:] / c[:-1] - 1
    valid = np.all(np.isfinite(X), axis=1)
    idx = np.where(valid)[0]
    return X[idx], fwd[idx], np.isfinite(fwd[idx]), [candles[i]["t"] for i in idx]


def _standardize(X: np.ndarray, mu=None, sd=None):
    mu = X.mean(axis=0) if mu is None else mu
    sd = X.std(axis=0) if sd is None else sd
    sd = np.where(sd < 1e-12, 1.0, sd)
    return (X - mu) / sd, mu, sd


def _logreg(X, y, l2=1.0, iters=600, lr=0.1):
    n, d = X.shape
    w, b = np.zeros(d), 0.0
    for _ in range(iters):
        z = X @ w + b
        p = 1 / (1 + np.exp(-np.clip(z, -30, 30)))
        g = p - y
        w -= lr * (X.T @ g / n + l2 * w / n)
        b -= lr * g.mean()
    return w, b


def _ridge(X, y, alpha=10.0):
    d = X.shape[1]
    A = X.T @ X + alpha * np.eye(d)
    w = np.linalg.solve(A, X.T @ (y - y.mean()))
    return w, float(y.mean())


def _sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -30, 30)))


def train(candles: list[dict], folds: int = 4) -> dict:
    X, fwd, has_target, ts = build_features(candles)
    X, fwd = X[has_target], fwd[has_target]
    if len(X) < 120:
        raise ValueError("Need at least ~170 candles of history to train")
    y = (fwd > 0).astype(float)
    # walk-forward validation (expanding window)
    n = len(X)
    fold_size = n // (folds + 1)
    accs, briers, baselines, ics = [], [], [], []
    for f in range(1, folds + 1):
        tr, te = slice(0, f * fold_size), slice(f * fold_size, (f + 1) * fold_size)
        Xs, mu, sd = _standardize(X[tr])
        w, b = _logreg(Xs, y[tr])
        Xt, _, _ = _standardize(X[te], mu, sd)
        p = _sigmoid(Xt @ w + b)
        accs.append(float(((p > 0.5) == y[te]).mean()))
        briers.append(float(((p - y[te]) ** 2).mean()))
        baselines.append(float(max(y[te].mean(), 1 - y[te].mean())))
        rw, rb = _ridge(Xs, fwd[tr])
        pred = Xt @ rw + rb
        if np.std(pred) > 0 and np.std(fwd[te]) > 0:
            ics.append(float(np.corrcoef(pred, fwd[te])[0, 1]))
    # final model on all data
    Xs, mu, sd = _standardize(X)
    w, b = _logreg(Xs, y)
    rw, rb = _ridge(Xs, fwd)
    importance = sorted(({"feature": f, "weight": round(float(wi), 4)} for f, wi in zip(FEATURES, w)), key=lambda r: -abs(r["weight"]))
    acc, base = float(np.mean(accs)), float(np.mean(baselines))
    return {
        "algorithm": "logistic_regression+ridge",
        "features": FEATURES,
        "weights": {"w": w.tolist(), "b": b, "mu": mu.tolist(), "sd": sd.tolist(), "rw": rw.tolist(), "rb": rb},
        "metrics": {
            "samples": int(n), "folds": folds, "accuracy": round(acc, 4), "baseline_accuracy": round(base, 4),
            "edge_vs_baseline": round(acc - base, 4), "brier": round(float(np.mean(briers)), 4),
            "information_coefficient": round(float(np.mean(ics)), 4) if ics else None,
            "fold_accuracy": [round(a, 4) for a in accs], "feature_importance": importance,
        },
    }


def predict(model: dict, candles: list[dict]) -> dict:
    X, _, _, ts = build_features(candles)
    if not len(X):
        raise ValueError("Not enough recent data to predict")
    wts = model["weights"]
    x = (X[-1] - np.array(wts["mu"])) / np.where(np.array(wts["sd"]) < 1e-12, 1, np.array(wts["sd"]))
    p_up = float(_sigmoid(x @ np.array(wts["w"]) + wts["b"]))
    exp_ret = float(x @ np.array(wts["rw"]) + wts["rb"])
    last = candles[-1]["c"]
    acc = model["metrics"].get("accuracy", 0.5)
    base = model["metrics"].get("baseline_accuracy", 0.5)
    confidence = abs(p_up - 0.5) * 2 * max(0.0, min(1.0, (acc - base) * 10 + 0.5))
    signal = "bullish" if p_up > 0.55 else "bearish" if p_up < 0.45 else "neutral"
    contrib = sorted(({"feature": f, "value": round(float(v), 3), "impact": round(float(v * w), 4)}
                      for f, v, w in zip(model["features"], x, wts["w"])), key=lambda r: -abs(r["impact"]))
    return {
        "prob_up": round(p_up, 4), "signal": signal, "expected_return_pct": round(exp_ret * 100, 4),
        "target_price": round(last * (1 + exp_ret), 8), "last_close": last, "as_of": candles[-1]["t"],
        "confidence": round(confidence, 3), "top_drivers": contrib[:5],
        "disclaimer": "Educational model. Past patterns do not guarantee future prices.",
    }


def sanitize(obj):
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj
