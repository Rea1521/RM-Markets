import { useApi } from "../lib/hooks";
import { fmtNum, fmtPct, fmtSignedUsd, fmtUsd, pnlClass } from "../lib/format";
import { Bars, Card, Skeleton } from "../components/ui";
import { LineChart } from "../components/charts";
import { useUi } from "../store/ui";
import { I } from "../components/Icons";

function Metric({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return <div className="metric"><div className="l">{label}</div><div className={`v ${cls}`}>{value}</div></div>;
}

export function AnalyticsPage() {
  const accountId = useUi((s) => s.accountId);
  const { data, loading, error } = useApi<any>("/api/analytics/performance", { params: { account_id: accountId ?? undefined }, poll: 60000 });
  if (loading && !data) return <Skeleton h={500} />;
  if (error) return <div className="notice error">{error.message}</div>;
  const { summary: s, risk: r, trades: t, monthly_returns: m, equity_curve: curve, insights } = data;
  const dd = r.drawdown_series ?? [];
  const base = curve[0]?.equity || 1;
  return (
    <>
      <div className="page-head"><div><h1>Performance Analytics</h1><p>Portfolio growth, risk and trading behaviour for the active account.</p></div></div>
      {!!insights.length && (
        <div className="card card-pad col gap-4" style={{ borderLeft: "4px solid var(--primary)" }}>
          <b className="row"><I.bolt width={15} />Insights</b>
          {insights.map((i: string) => <div key={i} className="small">• {i}</div>)}
        </div>
      )}
      <div className="grid g-5">
        <Metric label="Equity" value={fmtUsd(s.equity)} />
        <Metric label="Total return" value={fmtPct(s.total_pnl_pct)} cls={pnlClass(s.total_pnl_pct)} />
        <Metric label="Realized P&L" value={fmtSignedUsd(t.realized_pnl)} cls={pnlClass(t.realized_pnl)} />
        <Metric label="Unrealized P&L" value={fmtSignedUsd(s.unrealized_pnl)} cls={pnlClass(s.unrealized_pnl)} />
        <Metric label="Fees paid" value={fmtUsd(t.fees_paid)} />
      </div>
      <div className="grid g-main">
        <Card title="Equity Curve vs Starting Balance">
          <LineChart height={280} series={[
            { name: "Equity", data: curve.map((p: any) => ({ t: p.t, v: p.equity })) },
            { name: "Start", color: "#94a3b8", data: curve.map((p: any) => ({ t: p.t, v: base })) },
          ]} />
        </Card>
        <Card title="Risk Metrics">
          <div className="grid g-2" style={{ gap: 8 }}>
            <Metric label="Sharpe ratio" value={fmtNum(r.sharpe)} />
            <Metric label="Sortino ratio" value={fmtNum(r.sortino)} />
            <Metric label="Max drawdown" value={fmtPct(r.max_drawdown_pct)} cls="down" />
            <Metric label="Volatility (ann.)" value={r.volatility != null ? `${r.volatility.toFixed(2)}%` : "—"} />
            <Metric label="Calmar ratio" value={fmtNum(r.calmar)} />
            <Metric label="Daily VaR 95%" value={fmtPct(r.var_95_pct)} />
          </div>
          <p className="tiny faint" style={{ marginBottom: 0 }}>Ratios need a few days of equity history to become meaningful.</p>
        </Card>
      </div>
      <div className="grid g-3">
        <Card title="Win / Loss">
          <div className="grid g-2" style={{ gap: 8 }}>
            <Metric label="Win rate" value={`${t.win_rate.toFixed(1)}%`} />
            <Metric label="Closed trades" value={`${t.wins}W / ${t.losses}L`} />
            <Metric label="Profit factor" value={fmtNum(t.profit_factor)} />
            <Metric label="Expectancy" value={fmtSignedUsd(t.expectancy)} cls={pnlClass(t.expectancy)} />
            <Metric label="Avg win" value={fmtSignedUsd(t.avg_win)} cls="up" />
            <Metric label="Avg loss" value={fmtSignedUsd(t.avg_loss)} cls="down" />
            <Metric label="Largest win" value={fmtSignedUsd(t.largest_win)} cls="up" />
            <Metric label="Largest loss" value={fmtSignedUsd(t.largest_loss)} cls="down" />
            <Metric label="Best streak" value={`${t.best_streak} wins`} />
            <Metric label="Worst streak" value={`${t.worst_streak} losses`} />
          </div>
        </Card>
        <Card title="Drawdown">
          {dd.length > 1 ? <Bars data={dd.map((v: number, i: number) => ({ label: `#${i}`, value: v }))} height={180} color={() => "var(--down)"} /> : <div className="small muted">Not enough history yet.</div>}
        </Card>
        <Card title="Monthly Returns">
          {!m.length && <div className="small muted">No monthly data yet.</div>}
          <div className="heat" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {m.map((x: any) => (
              <div key={x.month} style={{ background: x.return_pct >= 0 ? `rgba(22,163,74,${Math.min(0.15 + Math.abs(x.return_pct) / 20, 0.8)})` : `rgba(239,68,68,${Math.min(0.15 + Math.abs(x.return_pct) / 20, 0.8)})` }}>
                <div className="tiny">{x.month}</div><b>{fmtPct(x.return_pct, 1)}</b>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid g-2">
        <Card title="P&L by Symbol" pad={false}>
          {!t.by_symbol.length ? <div className="empty small">Close some trades to see per-symbol results.</div> : (
            <table className="tbl"><thead><tr><th>Symbol</th><th className="r">Trades</th><th className="r">Wins</th><th className="r">Net P&amp;L</th></tr></thead>
              <tbody>{t.by_symbol.map((b: any) => <tr key={b.symbol}><td><b>{b.symbol}</b></td><td className="r">{b.trades}</td><td className="r">{b.wins}</td><td className={`r num ${pnlClass(b.pnl)}`}>{fmtSignedUsd(b.pnl)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="P&L by Asset Class">
          {Object.entries(t.by_asset_class).length === 0 && <div className="small muted">No closed trades yet.</div>}
          {Object.entries(t.by_asset_class as Record<string, number>).map(([k, v]) => (
            <div key={k} className="list-row"><span className="grow" style={{ textTransform: "capitalize" }}>{k}</span><b className={`num ${pnlClass(v)}`}>{fmtSignedUsd(v)}</b></div>
          ))}
        </Card>
      </div>
    </>
  );
}
