import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { post } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtNum, fmtPct, fmtPrice } from "../lib/format";
import { Bars, Card, Seg, Skeleton } from "../components/ui";
import { toast } from "../store/ui";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "SPX", "EURUSD", "USDZAR", "XAUUSD"];

export function PredictionsPage() {
  const [params] = useSearchParams();
  const [symbol, setSymbol] = useState(params.get("symbol") ?? "BTCUSDT");
  const [interval, setInterval] = useState<"1D" | "4h" | "1h">("1D");
  const { data, loading, error, reload } = useApi<any>(`/api/analytics/ml/predict/${symbol}`, { params: { interval } });
  const { data: models, reload: reloadModels } = useApi<any[]>("/api/analytics/ml/models");
  const [training, setTraining] = useState(false);
  const retrain = async () => {
    setTraining(true);
    try { await post("/api/analytics/ml/train", { symbol, interval }); toast({ kind: "success", title: "Model retrained" }); reload(); reloadModels(true); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); } finally { setTraining(false); }
  };
  const m = data?.metrics;
  return (
    <>
      <div className="page-head">
        <div><h1>ML Predictions</h1><p>A transparent machine-learning pipeline: 15 technical features, walk-forward validation and a persisted model per instrument.</p></div>
        <div className="row wrap">
          <select className="input" style={{ width: 130 }} value={symbol} onChange={(e) => setSymbol(e.target.value)}>{SYMBOLS.map((s) => <option key={s}>{s}</option>)}</select>
          <Seg value={interval} onChange={setInterval} options={["1h", "4h", "1D"]} />
          <button className="btn" onClick={retrain} disabled={training}>{training ? "Training…" : "Retrain"}</button>
        </div>
      </div>
      <div className="notice warn small">Educational only. Short-term price direction is close to random for liquid markets; always compare the model's accuracy with the naive baseline before trusting a signal.</div>
      {loading && !data && <Skeleton h={300} />}
      {error && <div className="notice error">{error.message}</div>}
      {data && (
        <>
          <div className="grid g-4">
            <div className="metric"><div className="l">Next-bar probability up</div><div className={`v ${data.prob_up >= 0.5 ? "up" : "down"}`}>{(data.prob_up * 100).toFixed(1)}%</div></div>
            <div className="metric"><div className="l">Signal</div><div className="v" style={{ textTransform: "capitalize" }}>{data.signal}</div></div>
            <div className="metric"><div className="l">Expected move</div><div className="v">{fmtPct(data.expected_return_pct, 3)} → {fmtPrice(data.target_price)}</div></div>
            <div className="metric"><div className="l">Confidence</div><div className="v">{(data.confidence * 100).toFixed(0)}%</div></div>
          </div>
          <div className="grid g-3">
            <Card title="Validation (walk-forward)">
              <dl className="kv small">
                <dt>Accuracy</dt><dd>{(m.accuracy * 100).toFixed(2)}%</dd>
                <dt>Baseline (majority class)</dt><dd>{(m.baseline_accuracy * 100).toFixed(2)}%</dd>
                <dt>Edge vs baseline</dt><dd className={m.edge_vs_baseline > 0 ? "up" : "down"}>{fmtPct(m.edge_vs_baseline * 100)}</dd>
                <dt>Brier score</dt><dd>{fmtNum(m.brier, 4)}</dd>
                <dt>Information coefficient</dt><dd>{fmtNum(m.information_coefficient, 4)}</dd>
                <dt>Samples</dt><dd>{m.samples}</dd>
                <dt>Trained</dt><dd>{fmtDate(data.trained_at)}</dd>
              </dl>
              <div className="small muted mt-12 mb-8">Accuracy per fold</div>
              <Bars data={m.fold_accuracy.map((a: number, i: number) => ({ label: `Fold ${i + 1}`, value: a - 0.5 }))} height={70} />
            </Card>
            <Card title="Top drivers of this prediction">
              {data.top_drivers.map((d: any) => (
                <div key={d.feature} className="list-row small"><span className="mono grow">{d.feature}</span><span className="muted">z={d.value}</span><b className={d.impact >= 0 ? "up" : "down"} style={{ width: 70, textAlign: "right" }}>{d.impact >= 0 ? "+" : ""}{d.impact.toFixed(3)}</b></div>
              ))}
            </Card>
            <Card title="Feature weights">
              {m.feature_importance.map((f: any) => (
                <div key={f.feature} className="row small" style={{ padding: "3px 0" }}>
                  <span className="mono" style={{ width: 120 }}>{f.feature}</span>
                  <div className="bar-h grow"><div style={{ width: `${Math.min(100, Math.abs(f.weight) * 300)}%`, background: f.weight >= 0 ? "var(--up)" : "var(--down)" }} /></div>
                  <span className="num muted" style={{ width: 52, textAlign: "right" }}>{f.weight}</span>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
      <Card title="Model registry" pad={false}>
        <table className="tbl"><thead><tr><th>#</th><th>Symbol</th><th>Interval</th><th>Algorithm</th><th className="r">Accuracy</th><th className="r">Baseline</th><th>Trained</th></tr></thead>
          <tbody>{(models ?? []).map((x) => <tr key={x.id}><td>{x.id}</td><td><b>{x.symbol}</b></td><td>{x.interval}</td><td className="mono">{x.algorithm}</td><td className="r">{(x.accuracy * 100).toFixed(1)}%</td><td className="r muted">{(x.baseline * 100).toFixed(1)}%</td><td className="small muted">{fmtDate(x.trained_at)}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
