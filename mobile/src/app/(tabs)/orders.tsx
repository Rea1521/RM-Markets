import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { del } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { fmtDate, fmtPrice, fmtQty, fmtSignedUsd, fmtUsd } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { toast, useAccountSel } from "../../lib/ui";
import type { Order, Trade } from "../../lib/types";
import { Chip, Empty, Row, Screen, Seg, T, styles } from "../../components/ui";

export default function Orders() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const accountId = useAccountSel((s) => s.accountId);
  const [tab, setTab] = useState<"open" | "history" | "fills">("open");
  const { data: orders, reload, loading } = useApi<Order[]>("/api/trading/orders", { params: { status: tab === "open" ? "pending" : undefined, account_id: accountId ?? undefined, limit: 100 }, poll: 5000 });
  const { data: fills } = useApi<Trade[]>(tab === "fills" ? "/api/trading/trades" : null, { params: { account_id: accountId ?? undefined } });
  const list = tab === "history" ? (orders ?? []).filter((o) => o.status !== "pending") : orders ?? [];
  const cancel = async (id: number) => {
    try { await del(`/api/trading/orders/${id}`, { account_id: accountId ?? undefined }); toast({ kind: "success", title: `Order #${id} cancelled` }); reload(true); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Screen refreshing={loading} onRefresh={reload}>
        <T v="h1">Orders</T>
        <Seg value={tab} onChange={setTab} options={[{ value: "open", label: "Open" }, { value: "history", label: "History" }, { value: "fills", label: "Fills" }]} />
        {tab !== "fills" ? (
          <>
            {!list.length && <Empty text={tab === "open" ? "No working orders." : "No orders yet."} />}
            {list.map((o) => (
              <View key={o.id} style={styles(t).listRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}><T v="h3" color={o.side === "buy" ? t.up : t.down}>{o.side.toUpperCase()}</T><T v="h3">{o.display}</T><Chip label={o.type.replace("_", " ")} /></Row>
                  <T v="tiny" color={t.muted}>{fmtQty(o.qty)} {o.limit_price ? `@ ${fmtPrice(o.limit_price)}` : ""}{o.stop_price ? ` stop ${fmtPrice(o.stop_price)}` : ""} · {fmtDate(o.created_at)}</T>
                  {o.reason && o.status !== "filled" ? <T v="tiny" color={t.faint}>{o.reason}</T> : null}
                </View>
                {o.status === "pending" ? (
                  <Pressable onPress={() => cancel(o.id)}><T v="small" color={t.down} style={{ fontWeight: "700" }}>Cancel</T></Pressable>
                ) : (
                  <View style={{ alignItems: "flex-end" }}>
                    <Chip label={o.status} color={o.status === "filled" ? "up" : o.status === "rejected" ? "down" : undefined} />
                    {o.filled_price ? <T v="tiny" color={t.muted}>@ {fmtPrice(o.filled_price)}</T> : null}
                  </View>
                )}
              </View>
            ))}
          </>
        ) : (
          <>
            {!fills?.length && <Empty text="No executions yet." />}
            {fills?.map((f) => (
              <View key={f.id} style={styles(t).listRow}>
                <View style={{ flex: 1 }}>
                  <T v="h3"><T v="h3" color={f.side === "buy" ? t.up : t.down}>{f.side.toUpperCase()}</T> {f.display}</T>
                  <T v="tiny" color={t.muted}>{fmtQty(f.qty)} @ {fmtPrice(f.price)} · fee {fmtUsd(f.fee)} · {fmtDate(f.created_at)}</T>
                </View>
                {f.net_pnl != null && <T v="small" color={f.net_pnl >= 0 ? t.up : t.down} style={{ fontWeight: "700" }}>{fmtSignedUsd(f.net_pnl)}</T>}
              </View>
            ))}
          </>
        )}
      </Screen>
    </View>
  );
}
