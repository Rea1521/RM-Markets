import { View } from "react-native";
import { useApi } from "../lib/hooks";
import { fmtNum, fmtPct, fmtSignedUsd, fmtUsd } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useAccountSel } from "../lib/ui";
import { Card, ErrorText, KV, Loading, Row, Screen, T } from "../components/ui";
import { LineChartSimple } from "../components/Charts";

function M({ l, v, c }: { l: string; v: string; c?: string }) {
  const t = useTheme();
  return <View style={{ flexBasis: "47%", flexGrow: 1, backgroundColor: t.surface2, padding: 10, borderRadius: 10 }}><T v="tiny" color={t.muted}>{l}</T><T v="h3" color={c}>{v}</T></View>;
}

export default function Analytics() {
  const t = useTheme();
  const accountId = useAccountSel((s) => s.accountId);
  const { data, loading, error, reload } = useApi<any>("/api/analytics/performance", { params: { account_id: accountId ?? undefined } });
  if (loading && !data) return <Loading />;
  if (!data) return <Screen><ErrorText error={error} /></Screen>;
  const { summary: s, risk: r, trades: tr, insights } = data;
  const col = (v: number) => (v >= 0 ? t.up : t.down);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {insights.map((i: string) => <Card key={i}><T v="small">💡 {i}</T></Card>)}
      <Card title="Equity curve"><LineChartSimple data={data.equity_curve.map((p: any) => ({ t: p.t, v: p.equity }))} /></Card>
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <M l="Equity" v={fmtUsd(s.equity)} />
        <M l="Total return" v={fmtPct(s.total_pnl_pct)} c={col(s.total_pnl_pct)} />
        <M l="Win rate" v={`${tr.win_rate.toFixed(1)}%`} />
        <M l="Profit factor" v={fmtNum(tr.profit_factor)} />
        <M l="Sharpe" v={fmtNum(r.sharpe)} />
        <M l="Max drawdown" v={fmtPct(r.max_drawdown_pct)} c={t.down} />
      </Row>
      <Card title="Trades">
        <KV k="Closed trades" v={`${tr.wins}W / ${tr.losses}L`} />
        <KV k="Average win" v={fmtSignedUsd(tr.avg_win)} vColor={t.up} />
        <KV k="Average loss" v={fmtSignedUsd(tr.avg_loss)} vColor={t.down} />
        <KV k="Expectancy" v={fmtSignedUsd(tr.expectancy)} />
        <KV k="Largest win / loss" v={`${fmtSignedUsd(tr.largest_win)} / ${fmtSignedUsd(tr.largest_loss)}`} />
        <KV k="Streaks" v={`${tr.best_streak}W / ${tr.worst_streak}L`} />
        <KV k="Fees paid" v={fmtUsd(tr.fees_paid)} />
      </Card>
      <Card title="Risk">
        <KV k="Sortino" v={fmtNum(r.sortino)} /><KV k="Volatility (ann.)" v={r.volatility != null ? `${r.volatility.toFixed(2)}%` : "—"} />
        <KV k="Calmar" v={fmtNum(r.calmar)} /><KV k="Daily VaR 95%" v={fmtPct(r.var_95_pct)} />
      </Card>
      {tr.by_symbol.length > 0 && <Card title="P&L by symbol">{tr.by_symbol.map((b: any) => <KV key={b.symbol} k={`${b.symbol} (${b.trades})`} v={fmtSignedUsd(b.pnl)} vColor={col(b.pnl)} />)}</Card>}
    </Screen>
  );
}
