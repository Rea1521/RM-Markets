import { View } from "react-native";
import { useApi } from "../lib/hooks";
import { fmtPrice, fmtQty, fmtSignedUsd, fmtUsd, timeAgo } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useAccountSel } from "../lib/ui";
import { Card, Chip, Empty, KV, Loading, Screen, T, styles } from "../components/ui";

function describe(h: any) {
  const p = h.payload || {};
  if (h.type === "OrderFilled") return `${p.side} ${fmtQty(p.qty)} ${p.symbol} @ ${fmtPrice(p.price)}`;
  if (h.type === "OrderPlaced") return `${p.type} ${p.side} ${fmtQty(p.qty)} ${p.symbol}`;
  if (h.type.startsWith("Funds")) return fmtSignedUsd(p.amount);
  if (h.type === "AccountOpened" || h.type === "AccountReset") return `Balance ${fmtUsd(p.cash)}`;
  if (h.type === "OptionTraded") return `${p.contracts} × ${p.contract} @ ${fmtPrice(p.premium)}`;
  return p.reason ?? p.symbol ?? "";
}

export default function History() {
  const t = useTheme();
  const accountId = useAccountSel((s) => s.accountId);
  const { data, loading, reload } = useApi<any[]>("/api/trading/history", { params: { account_id: accountId ?? undefined, limit: 100 } });
  const { data: audit } = useApi<any>("/api/trading/audit/replay", { params: { account_id: accountId ?? undefined } });
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {audit && (
        <Card title="Event-sourcing audit">
          <KV k="Events in log" v={String(audit.rebuilt.events)} />
          <KV k="Replay matches live state" v={audit.consistent ? "Yes ✓" : "No ✗"} vColor={audit.consistent ? t.up : t.down} />
        </Card>
      )}
      {loading && !data && <Loading />}
      {data && !data.length && <Empty text="No activity yet." />}
      <View>
        {data?.map((h) => (
          <View key={h.id} style={styles(t).listRow}>
            <Chip label={h.type} />
            <T v="small" style={{ flex: 1 }} numberOfLines={1}>{describe(h)}</T>
            <T v="tiny" color={t.faint}>{timeAgo(h.created_at)}</T>
          </View>
        ))}
      </View>
    </Screen>
  );
}
