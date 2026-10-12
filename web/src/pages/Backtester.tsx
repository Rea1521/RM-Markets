import { useEffect, useState } from "react";
import { post } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtNum, fmtPct, fmtPrice, pnlClass } from "../lib/format";
import { Card, Seg, Skeleton } from "../components/ui";
import { LineChart } from "../components/charts";
import { toast } from "../store/ui";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AAPL", "TSLA", "NVDA", "MSFT", "SPX", "NDX", "EURUSD", "USDZAR", "XAUUSD", "NIFTY50"];

function Metrics({ m }: { m: any }) {
  const items: [string, React.ReactNode, string?][] = [
    ["Total return", fmtPct(m.total_return_pct), pnlClass(m.total_return_pct)], ["Buy & hold", fmtPct(m.buy_hold_return_pct), pnlClass(m.buy_hold_return_pct)],
    ["CAGR", fmtPct(m.cagr_pct)], ["Sharpe", fmtNum(m.sharpe)], ["Sortino", fmtNum(m.sortino)], ["Max drawdown", fmtPct(m.max_drawdown_pct), "down"],
    ["Trades", m.trades], ["Win rate", `${fmtNum(m.win_rate, 1)}%`], ["Profit factor", fmtNum(m.profit_factor)], ["Avg trade", fmtPct(m.avg_trade_pct)],
  ];
  return <div className="grid g-5" style={{ gap: 8 }}>{items.map(([l, v, c]) => <div key={l} className="metric"><div className="l">{l}</div><div className={`v ${c ?? ""}`}>{v ?? "—"}</div></div>)}</div>;
}

export function BacktesterPage() {
  const { data: strategies } = useApi<any[]>("/api/analytics/backtest/strategies");
  const [mode, setMode] = useState<"backtest" | "optimize" | "walk">("backtest");
  const [cfg, setCfg] = useState<any>({ symbol: "BTCUSDT", strategy: "sma_cross", interval: "1D", bars: 750, fee_bps: 10, allow_short: false, stop_loss_pct: "", initial: 10000, objective: "sharpe", windows: 5, train_ratio: 0.7, anchored: false });
  const [params, setParams] = useState<Record<string, number>>({});
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const strat = strategies?.find((s) => s.id === cfg.strategy);
  useEffect(() => { if (strat) setParams(strat.defaults); }, [strat]);

  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const body = { ...cfg, params, stop_loss_pct: cfg.stop_loss_pct === "" ? null : Number(cfg.stop_loss_pct) };
      const path = mode === "backtest" ? "/api/analytics/backtest" : mode === "optimize" ? "/api/analytics/backtest/optimize" : "/api/analytics/backtest/walk-forward";
      setRes({ mode, data: await post(path, body) });
    } catch (e) { toast({ kind: "error", title: "Backtest failed", body: (e as Error).message }); } finally { setBusy(false); }
  };
  const set = (k: string, v: any) => setCfg({ ...cfg, [k]: v });

  return (
    <>
      <div className="page-head">
        <div><h1>Strategy Backtester</h1><p>Test rule-based strategies on historical data, optimise parameters and validate them with walk-forward analysis.</p></div>
        <Seg value={mode} onChange={setMode} options={[{ value: "backtest", label: "Backtest" }, { value: "optimize", label: "Optimise" }, { value: "walk", label: "Walk-forward" }]} />
      </div>
      <div className="grid g-side">
        <Card title="Configuration">
          <div className="col gap-12">
            <label className="field">Symbol<select className="input" value={cfg.symbol} onChange={(e) => set("symbol", e.target.value)}>{SYMBOLS.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Strategy<select className="input" value={cfg.strategy} onChange={(e) => set("strategy", e.target.value)}>{strategies?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <div className="grid g-2" style={{ gap: 8 }}>
              <label className="field">Timeframe<select className="input" value={cfg.interval} onChange={(e) => set("interval", e.target.value)}>{["1h", "4h", "1D", "1W"].map((i) => <option key={i}>{i}</option>)}</select></label>
              <label className="field">Bars<input className="input num" type="number" min={100} max={1000} value={cfg.bars} onChange={(e) => set("bars", +e.target.value)} /></label>
            </div>
            {mode === "backtest" && strat && Object.keys(strat.defaults).length > 0 && (
              <div className="grid g-2" style={{ gap: 8 }}>
                {Object.keys(strat.defaults).map((k) => <label key={k} className="field">{k}<input className="input num" type="number" value={params[k] ?? ""} onChange={(e) => setParams({ ...params, [k]: +e.target.value })} /></label>)}
              </div>
            )}
            {mode !== "backtest" && (
              <label className="field">Optimise for<select className="input" value={cfg.objective} onChange={(e) => set("objective", e.target.value)}>
                <option value="sharpe">Sharpe ratio</option><option value="sortino">Sortino ratio</option><option value="total_return_pct">Total return</option><option value="cagr_pct">CAGR</option></select></label>
            )}
            {mode === "walk" && (
              <div className="grid g-2" style={{ gap: 8 }}>
                <label className="field">Windows<input className="input num" type="number" min={2} max={12} value={cfg.windows} onChange={(e) => set("windows", +e.target.value)} /></label>
                <label className="field">Train %<input className="input num" type="number" min={40} max={90} value={Math.round(cfg.train_ratio * 100)} onChange={(e) => set("train_ratio", +e.target.value / 100)} /></label>
                <label className="switch small" style={{ gridColumn: "1/-1" }}><input type="checkbox" checked={cfg.anchored} onChange={(e) => set("anchored", e.target.checked)} />Anchored (expanding) training window</label>
              </div>
            )}
            <div className="grid g-2" style={{ gap: 8 }}>
              <label className="field">Fees (bps)<input className="input num" type="number" value={cfg.fee_bps} onChange={(e) => set("fee_bps", +e.target.value)} /></label>
              <label className="field">Stop loss %<input className="input num" type="number" placeholder="none" value={cfg.stop_loss_pct} onChange={(e) => set("stop_loss_pct", e.target.value)} /></label>
            </div>
            <label className="switch small"><input type="checkbox" checked={cfg.allow_short} onChange={(e) => set("allow_short", e.target.checked)} />Allow short positions</label>
            <button className="btn primary block" onClick={run} disabled={busy}>{busy ? "Running…" : mode === "backtest" ? "Run backtest" : mode === "optimize" ? "Run optimisation" : "Run walk-forward"}</button>
            <p className="tiny faint" style={{ margin: 0 }}>Signals are computed at bar close and filled at the next bar's open (no look-ahead). Results are hypothetical.</p>
          </div>
        </Card>
        <div className="col gap-12">
          {busy && <Card><Skeleton h={320} /></Card>}
          {!busy && !res && <Card><div className="empty">Configure a strategy and run it to see results.</div></Card>}
          {res?.mode === "backtest" && (
            <>
              <Metrics m={res.data.metrics} />
              <Card title="Equity: strategy vs buy & hold">
                <LineChart height={300} area series={[
                  { name: "Strategy", data: res.data.equity.map((p: any) => ({ t: p.t, v: p.equity })) },
                  { name: "Buy & hold", color: "#94a3b8", data: res.data.benchmark.map((p: any) => ({ t: p.t, v: p.equity })) },
                ]} />
              </Card>
              <Card title={`Trades (${res.data.trades.length})`} pad={false}>
                <div className="table-wrap" style={{ maxHeight: 320 }}>
                  <table className="tbl compact"><thead><tr><th>Entry</th><th>Exit</th><th>Side</th><th className="r">Entry px</th><th className="r">Exit px</th><th className="r">Return</th><th>Exit reason</th></tr></thead>
                    <tbody>{[...res.data.trades].reverse().map((t: any, i: number) => (
                      <tr key={i}><td>{fmtDate(t.entry_t, false)}</td><td>{t.exit_t ? fmtDate(t.exit_t, false) : "open"}</td><td className={t.dir > 0 ? "up" : "down"}>{t.dir > 0 ? "Long" : "Short"}</td>
                        <td className="r num">{fmtPrice(t.entry)}</td><td className="r num">{fmtPrice(t.exit)}</td><td className={`r num ${pnlClass(t.ret_pct)}`}>{fmtPct(t.ret_pct)}</td><td>{t.reason}</td></tr>
                    ))}</tbody></table>
                </div>
              </Card>
            </>
          )}
          {res?.mode === "optimize" && (
            <Card title={`Parameter optimisation (${res.data.tested} combinations)`} pad={false}>
              <table className="tbl"><thead><tr><th>#</th><th>Parameters</th><th className="r">Return</th><th className="r">Sharpe</th><th className="r">Max DD</th><th className="r">Trades</th><th className="r">Win rate</th><th /></tr></thead>
                <tbody>{res.data.results.map((r: any, i: number) => (
                  <tr key={i}><td>{i + 1}</td><td className="mono">{Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(", ")}</td>
                    <td className={`r num ${pnlClass(r.metrics.total_return_pct)}`}>{fmtPct(r.metrics.total_return_pct)}</td><td className="r num">{fmtNum(r.metrics.sharpe)}</td>
                    <td className="r num down">{fmtPct(r.metrics.max_drawdown_pct)}</td><td className="r">{r.metrics.trades}</td><td className="r">{fmtNum(r.metrics.win_rate, 1)}%</td>
                    <td><button className="btn xs" onClick={() => { setParams(r.params); setMode("backtest"); }}>Use</button></td></tr>
                ))}</tbody></table>
              <div className="notice warn" style={{ margin: 12 }}>In-sample optimisation over-fits. Confirm the best parameters with a walk-forward run before trusting them.</div>
            </Card>
          )}
          {res?.mode === "walk" && (
            <>
              <div className="grid g-4">
                <div className="metric"><div className="l">Out-of-sample return</div><div className={`v ${pnlClass(res.data.oos_metrics.total_return_pct)}`}>{fmtPct(res.data.oos_metrics.total_return_pct)}</div></div>
                <div className="metric"><div className="l">OOS Sharpe</div><div className="v">{fmtNum(res.data.oos_metrics.sharpe)}</div></div>
                <div className="metric"><div className="l">Walk-forward efficiency</div><div className="v">{fmtNum(res.data.walk_forward_efficiency)}</div></div>
                <div className="metric"><div className="l">Verdict</div><div className={`v ${res.data.robust ? "up" : "down"}`}>{res.data.robust ? "Robust" : "Not robust"}</div></div>
              </div>
              <Card title="Stitched out-of-sample equity"><LineChart height={260} series={[{ name: "OOS equity", data: res.data.oos_equity.map((p: any) => ({ t: p.t, v: p.equity })) }]} /></Card>
              <Card title="Windows" pad={false}>
                <table className="tbl"><thead><tr><th>#</th><th>Train</th><th>Test</th><th>Best params (in-sample)</th><th className="r">IS return</th><th className="r">OOS return</th><th className="r">OOS Sharpe</th></tr></thead>
                  <tbody>{res.data.windows.map((w: any) => (
                    <tr key={w.window}><td>{w.window}</td><td className="small">{fmtDate(w.train_from, false)} – {fmtDate(w.train_to, false)}</td><td className="small">{fmtDate(w.test_from, false)} – {fmtDate(w.test_to, false)}</td>
                      <td className="mono">{Object.entries(w.best_params).map(([k, v]) => `${k}=${v}`).join(", ")}</td>
                      <td className={`r num ${pnlClass(w.in_sample.total_return_pct)}`}>{fmtPct(w.in_sample.total_return_pct)}</td>
                      <td className={`r num ${pnlClass(w.out_of_sample.total_return_pct)}`}>{fmtPct(w.out_of_sample.total_return_pct)}</td>
                      <td className="r num">{fmtNum(w.out_of_sample.sharpe)}</td></tr>
                  ))}</tbody></table>
                <p className="tiny faint" style={{ padding: "0 16px" }}>Efficiency = average OOS return / average in-sample return. Above 0.5 with positive OOS return suggests the edge survives on unseen data.</p>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
