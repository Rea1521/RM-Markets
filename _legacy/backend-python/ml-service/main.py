from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

app = FastAPI(title="RM Markets ML Service", version="0.1.0")


class IndicatorRequest(BaseModel):
    symbol: str
    prices: List[float]


class BacktestRequest(BaseModel):
    symbol: str
    prices: List[float]


class PredictRequest(BaseModel):
    symbol: str
    features: List[float]


@app.get("/api/v1/ping")
def ping():
    return {"status": "ok", "service": "ml-service"}


@app.post("/api/v1/indicator/rsi")
def calculate_rsi(req: IndicatorRequest):
    if len(req.prices) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 price values")

    prices = pd.Series(req.prices)
    deltas = prices.diff().dropna()
    gain = deltas.where(deltas > 0, 0.0).rolling(window=14, min_periods=1).mean()
    loss = -deltas.where(deltas < 0, 0.0).rolling(window=14, min_periods=1).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    last = float(rsi.iloc[-1]) if not rsi.empty else 50.0

    return {"symbol": req.symbol.upper(), "rsi": round(last, 2)}


@app.post("/api/v1/backtest")
def backtest(req: BacktestRequest):
    if len(req.prices) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 price values")

    prices = np.array(req.prices)
    returns = np.diff(prices) / prices[:-1]
    total_return = float(np.prod(1 + returns) - 1)
    sharpe = float(np.mean(returns) / np.std(returns) * np.sqrt(252)) if len(returns) > 1 else 0.0

    return {
        "symbol": req.symbol.upper(),
        "total_return": round(total_return, 6),
        "sharpe_ratio": round(sharpe, 4),
        "trades": len(returns)
    }


@app.post("/api/v1/model/predict")
def predict(req: PredictRequest):
    if len(req.features) == 0:
        raise HTTPException(status_code=400, detail="Need non-empty feature vector")

    X_sample = np.array(req.features).reshape(-1, 1)
    y_sample = np.array([x * 1.05 for x in req.features])

    model = LinearRegression()
    model.fit(X_sample, y_sample)

    predicted = model.predict(X_sample)

    return {
        "symbol": req.symbol.upper(),
        "prediction": float(predicted[-1]),
        "coeff": float(model.coef_[0]),
        "intercept": float(model.intercept_)
    }
