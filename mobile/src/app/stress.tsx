import { useEffect, useState } from "react";
import { View } from "react-native";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtPct, fmtSignedUsd, fmtUsd } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useAccountSel } from "../lib/ui";
import { Card, Empty, KV, Loading, Row, Screen, T } from "../components/ui";

export default function Stress() {
  const t = useTheme();
  const accountId = useAccountSel((s) => s.accountId);
  const [res, setRes] = useState<any>(null);
  const { data: mc } = useApi<any>("/api/analytics/stress/monte-carlo", { params: { horizon_days: 10, paths: 3000, account_id: accountId ?? undefined } });
  useEffect(() => { post("/api/analytics/stress", { account_id: accountId ?? undefined }).then(setRes).catch(() => {}); }, [accountId]);
  return (
    <Screen>
      {!res && <Loading />}
      {res && res.results.every((r: any) => !r.positions.length) && <Empty text="Open some positions to stress-test your portfolio." />}
      {res?.results.map((r: any) => (
        <Card key={r.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <T v="h3" style={{ flex: 1 }}>{r.name}</T>
            <T v="h3" color={r.pnl < 0 ? t.down : t.up}>{fmtPct(r.pnl_pct, 1)}</T>
          </Row>
          <View style={{ height: 6, backgroundColor: t.surface3, borderRadius: 3, marginVertical: 8 }}>
            <View style={{ height: 6, borderRadius: 3, width: `${Math.min(100, Math.abs(r.pnl_pct))}%`, backgroundColor: r.pnl < 0 ? t.down : t.up }} />
          </View>
          <T v="tiny" color={t.muted}>{fmtSignedUsd(r.pnl)} → equity {fmtUsd(r.equity_after)}{r.margin_call ? " · margin call" : ""}</T>
        </Card>
      ))}
      {mc?.histogram?.length > 0 && (
        <Card title={`Monte Carlo (${mc.horizon_days} days, ${mc.paths} paths)`}>
          <KV k="VaR 95%" v={fmtUsd(mc.var_95, 0)} vColor={t.down} />
          <KV k="VaR 99%" v={fmtUsd(mc.var_99, 0)} vColor={t.down} />
          <KV k="Expected shortfall 95%" v={fmtUsd(mc.cvar_95, 0)} vColor={t.down} />
          <KV k="Probability of loss" v={`${mc.prob_loss_pct.toFixed(1)}%`} />
          <Row gap={1} style={{ height: 70, alignItems: "flex-end", marginTop: 10 }}>
            {mc.histogram.map((b: any, i: number) => {
              const max = Math.max(...mc.histogram.map((x: any) => x.count));
              return <View key={i} style={{ flex: 1, height: `${(b.count / max) * 100}%`, backgroundColor: b.to <= 0 ? t.down : b.from >= 0 ? t.up : t.faint, opacity: 0.8 }} />;
            })}
          </Row>
        </Card>
      )}
    </Screen>
  );
}
