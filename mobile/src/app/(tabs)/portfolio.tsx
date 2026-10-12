import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { post } from "../../lib/api";
import { useAccount, useApi, useQuotes } from "../../lib/hooks";
import { fmtPct, fmtPrice, fmtQty, fmtSignedUsd, fmtUsd } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { toast, useAccountSel } from "../../lib/ui";
import { Card, Donut, Empty, KV, PALETTE, Row, Screen, SymbolIcon, T, styles } from "../../components/ui";
import { LineChartSimple } from "../../components/Charts";

export default function Portfolio() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const accountId = useAccountSel((s) => s.accountId);
  const { data: a, reload, loading } = useAccount(4000);
  const { data: perf } = useApi<any>("/api/analytics/performance", { params: { account_id: accountId ?? undefined }, poll: 60000 });
  const live = useQuotes((a?.positions ?? []).map((p) => p.symbol));

  const close = (symbol: string, display: string) => Alert.alert(`Close ${display}?`, "Closes the full position at market.", [
    { text: "Cancel", style: "cancel" },
    { text: "Close", style: "destructive", onPress: async () => {
      try { const o = await post(`/api/trading/positions/${symbol}/close`, { account_id: accountId ?? undefined }); toast({ kind: "success", title: `Closed ${display}`, body: `@ ${fmtPrice(o.filled_price)}` }); reload(true); }
      catch (e) { toast({ kind: "error", title: (e as Error).message }); }
    } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Screen refreshing={loading} onRefresh={reload}>
        <T v="h1">Portfolio</T>
        <Card>
          <T v="small" color={t.muted}>Total Value</T>
          <T v="big">{fmtUsd(a?.equity)}</T>
          <T v="small" color={(a?.total_pnl ?? 0) >= 0 ? t.up : t.down} style={{ fontWeight: "700" }}>{fmtSignedUsd(a?.total_pnl)} ({fmtPct(a?.total_pnl_pct)})</T>
          <View style={{ marginTop: 12 }}><LineChartSimple data={(perf?.equity_curve ?? []).map((p: any) => ({ t: p.t, v: p.equity }))} height={110} /></View>
        </Card>
        <Card title="Allocation">
          <Row gap={16}>
            <Donut items={(a?.allocation ?? []).map((x) => ({ label: x.asset_class, value: x.value }))} />
            <View style={{ flex: 1, gap: 6 }}>
              {(a?.allocation ?? []).map((x, i) => (
                <Row key={x.asset_class} gap={6}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PALETTE[i % PALETTE.length] }} />
                  <T v="small" style={{ flex: 1, textTransform: "capitalize" }}>{x.asset_class}</T><T v="small" color={t.muted}>{x.pct.toFixed(1)}%</T></Row>
              ))}
            </View>
          </Row>
          <View style={{ marginTop: 10 }}>
            <KV k="Cash" v={fmtUsd(a?.cash)} />
            <KV k="Margin used" v={fmtUsd(a?.margin_used)} />
            <KV k="Buying power (stocks)" v={fmtUsd(a?.buying_power)} />
          </View>
        </Card>
        <Card title={`Positions (${a?.positions.length ?? 0})`}>
          {!a?.positions.length && <Empty text="No open positions yet." />}
          {a?.positions.map((p) => {
            const q = live[p.symbol];
            const mark = q ? (p.qty > 0 ? q.bid : q.ask) : p.price;
            const pnl = (mark - p.avg_price) * p.qty;
            const pct = p.avg_price ? (mark / p.avg_price - 1) * 100 * (p.qty > 0 ? 1 : -1) : 0;
            return (
              <Pressable key={p.symbol} onPress={() => router.push(`/symbol/${p.symbol}`)} onLongPress={() => close(p.symbol, p.display)} style={styles(t).listRow}>
                <SymbolIcon symbol={p.symbol} display={p.display} size={28} />
                <View style={{ flex: 1 }}>
                  <T v="h3">{p.display} <T v="tiny" color={p.qty > 0 ? t.up : t.down}>{p.qty > 0 ? "LONG" : "SHORT"}</T></T>
                  <T v="tiny" color={t.muted}>{fmtQty(Math.abs(p.qty))} @ {fmtPrice(p.avg_price)}</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T v="small" color={pnl >= 0 ? t.up : t.down} style={{ fontWeight: "700" }}>{fmtSignedUsd(pnl)}</T>
                  <T v="tiny" color={pnl >= 0 ? t.up : t.down}>{fmtPct(pct)}</T>
                </View>
              </Pressable>
            );
          })}
          {!!a?.positions.length && <T v="tiny" color={t.faint} style={{ marginTop: 6 }}>Long-press a position to close it.</T>}
        </Card>
        {!!a?.option_positions.length && (
          <Card title="Options">
            {a.option_positions.map((o) => (
              <View key={o.id} style={styles(t).listRow}>
                <T v="small" style={{ flex: 1 }}>{o.underlying} {o.strike} {o.option_type.toUpperCase()} ×{o.contracts}</T>
                <T v="small" color={o.unrealized_pnl >= 0 ? t.up : t.down}>{fmtSignedUsd(o.unrealized_pnl)}</T>
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </View>
  );
}
