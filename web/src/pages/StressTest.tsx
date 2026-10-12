import { useEffect, useState } from "react";
import { post } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtPct, fmtSignedUsd, fmtUsd, pnlClass } from "../lib/format";
import { Card, Empty, Skeleton } from "../components/ui";
import { Histogram } from "../components/charts";
import { toast, useUi } from "../store/ui";

const CLASSES = ["stock", "crypto", "forex", "commodity", "index"];

export function StressPage() {
  const accountId = useUi((s) => s.accountId);
  const [res, setRes] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, number>>({ stock: -20, crypto: -40, forex: 0, commodity: -10, index: -20 });
  const [customRes, setCustomRes] = useState<any>(null);
  const [horizon, setHorizon] = useState(10);
  const { data: mc, loading: mcLoading } = useApi<any>("/api/analytics/stress/monte-carlo", { params: { horizon_days: horizon, paths: 5000, account_id: accountId ?? undefined } });

  useEffect(() => {
    post("/api/analytics/stress", { account_id: accountId ?? undefined }).then((r) => { setRes(r); setSelected(r.results[0]?.id ?? null); }).catch((e) => toast({ kind: "error", title: e.message }));
  }, [accountId]);

  const runCustom = async () => {
    try {
      const shocks = Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, v / 100]));
      setCustomRes((await post("/api/analytics/stress", { custom_shocks: shocks, account_id: accountId ?? undefined })).results[0]);
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const sel = res?.results.find((r: any) => r.id === selected);
  const noPositions = res && res.results.every((r: any) => !r.positions.length);

  return (
    <>
      <div className="page-head"><div><h1>Portfolio Stress Testing</h1><p>See how your current positions would fare in historical crises, custom shocks and 5,000 Monte Carlo simulations.</p></div></div>
      {noPositions && <div className="notice warn">You have no open positions, so every scenario shows zero impact. Open a few trades first.</div>}
      <div className="grid g-main">
        <Card title="Historical scenarios" pad={false}>
          {!res ? <div style={{ padding: 16 }}><Skeleton h={260} /></div> : (
            <table className="tbl">
              <thead><tr><th>Scenario</th><th className="r">P&amp;L</th><th className="r">Impact</th><th className="r">Equity after</th><th /></tr></thead>
              <tbody>{res.results.map((r: any) => (
                <tr key={r.id} className="click" onClick={() => setSelected(r.id)} style={{ background: r.id === selected ? "var(--primary-soft)" : undefined }}>
                  <td className="bold">{r.name}</td><td className={`r num ${pnlClass(r.pnl)}`}>{fmtSignedUsd(r.pnl)}</td>
                  <td className="r" style={{ width: 160 }}><div className="row"><div className="bar-h grow"><div style={{ width: `${Math.min(100, Math.abs(r.pnl_pct))}%`, background: r.pnl < 0 ? "var(--down)" : "var(--up)" }} /></div><span className={`num ${pnlClass(r.pnl_pct)}`} style={{ width: 56, textAlign: "right" }}>{fmtPct(r.pnl_pct, 1)}</span></div></td>
                  <td className="r num">{fmtUsd(r.equity_after)}</td>
                  <td>{r.margin_call && <span className="chip down">Margin call</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        <Card title={sel ? `Breakdown: ${sel.name}` : "Breakdown"}>
          {!sel?.positions.length && <div className="small muted">No positions affected.</div>}
          {sel?.positions.map((p: any) => (
            <div key={p.symbol} className="list-row small"><b className="grow">{p.display}</b><span className="muted">{fmtPct(p.shock_pct, 0)}</span><span className={`num bold ${pnlClass(p.pnl)}`} style={{ width: 96, textAlign: "right" }}>{fmtSignedUsd(p.pnl)}</span></div>
          ))}
        </Card>
      </div>
      <div className="grid g-2">
        <Card title="Custom shock">
          <div className="col gap-8">
            {CLASSES.map((c) => (
              <div key={c} className="row"><span style={{ width: 90, textTransform: "capitalize" }}>{c}</span>
                <input type="range" min={-90} max={90} value={custom[c]} onChange={(e) => setCustom({ ...custom, [c]: +e.target.value })} className="grow" />
                <span className={`num ${pnlClass(custom[c])}`} style={{ width: 48, textAlign: "right" }}>{custom[c]}%</span></div>
            ))}
            <button className="btn primary" onClick={runCustom}>Apply shock</button>
            {customRes && <div className={`notice ${customRes.pnl < 0 ? "error" : "ok"}`}>Portfolio P&amp;L {fmtSignedUsd(customRes.pnl)} ({fmtPct(customRes.pnl_pct)}) → equity {fmtUsd(customRes.equity_after)}{customRes.margin_call ? " · would trigger a margin call" : ""}</div>}
          </div>
        </Card>
        <Card title="Monte Carlo value-at-risk" actions={<select className="input" style={{ height: 28, width: 110 }} value={horizon} onChange={(e) => setHorizon(+e.target.value)}>{[1, 5, 10, 21, 63].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select>}>
          {mcLoading && !mc && <Skeleton h={200} />}
          {mc && !mc.histogram.length && <Empty icon="shield">{mc.note}</Empty>}
          {mc?.histogram.length > 0 && (
            <>
              <div className="grid g-4" style={{ gap: 8 }}>
                <div className="metric"><div className="l">VaR 95%</div><div className="v down">{fmtUsd(mc.var_95, 0)}</div></div>
                <div className="metric"><div className="l">VaR 99%</div><div className="v down">{fmtUsd(mc.var_99, 0)}</div></div>
                <div className="metric"><div className="l">CVaR 95%</div><div className="v down">{fmtUsd(mc.cvar_95, 0)}</div></div>
                <div className="metric"><div className="l">P(loss)</div><div className="v">{mc.prob_loss_pct.toFixed(1)}%</div></div>
              </div>
              <div className="mt-12"><Histogram bins={mc.histogram} /></div>
              <p className="tiny faint">Bootstraps whole historical days across your holdings (preserving correlation) over a {mc.horizon_days}-day horizon. 95% VaR = loss not exceeded in 95% of {mc.paths.toLocaleString()} paths.</p>
              {mc.correlation.symbols.length > 1 && (
                <div className="table-wrap"><table className="tbl compact"><thead><tr><th />{mc.correlation.symbols.map((s: string) => <th key={s} className="r">{s}</th>)}</tr></thead>
                  <tbody>{mc.correlation.matrix.map((row: number[], i: number) => (
                    <tr key={i}><td className="bold">{mc.correlation.symbols[i]}</td>{row.map((v, j) => <td key={j} className="r num" style={{ background: `rgba(${v >= 0 ? "37,99,235" : "239,68,68"},${Math.abs(v) * 0.35})` }}>{v.toFixed(2)}</td>)}</tr>
                  ))}</tbody></table></div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
