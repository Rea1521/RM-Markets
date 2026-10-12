import { useState } from "react";
import { Pressable, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { del, post } from "../../lib/api";
import { useAccount, useApi, useQuote } from "../../lib/hooks";
import { fmtCompact, fmtDate, fmtPrice, fmtQty, fmtSignedUsd } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { toast, useAccountSel } from "../../lib/ui";
import type { Order, Quote, Trade } from "../../lib/types";
import { Btn, Card, Change, Chip, Empty, KV, Row, Screen, T, styles } from "../../components/ui";
import { CandleChart } from "../../components/Charts";
import { OrderSheet } from "../../components/OrderSheet";
import { Icons } from "../../components/icons";

const IV = ["1m", "5m", "15m", "1h", "4h", "1D"];

export default function SymbolScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { symbol = "BTCUSDT" } = useLocalSearchParams<{ symbol: string }>();
  const sym = String(symbol).toUpperCase();
  const q = useQuote(sym);
  const accountId = useAccountSel((s) => s.accountId);
  const { data: acct, reload } = useAccount();
  const [tab, setTab] = useState<"chart" | "orders" | "trades" | "info">("chart");
  const [interval, setInterval] = useState("1D");
  const [sheet, setSheet] = useState<null | "buy" | "sell">(null);
  const { data: watch, reload: reloadWatch } = useApi<Quote[]>("/api/trading/watchlist");
  const { data: orders, reload: reloadOrders } = useApi<Order[]>(tab === "orders" ? "/api/trading/orders" : null, { params: { symbol: sym, account_id: accountId ?? undefined } });
  const { data: trades } = useApi<Trade[]>(tab === "trades" ? "/api/trading/trades" : null, { params: { account_id: accountId ?? undefined } });
  const { data: signals } = useApi<any>(tab === "info" ? `/api/market/signals/${sym}` : null);
  const starred = !!watch?.some((w) => w.symbol === sym);
  const pos = acct?.positions.find((p) => p.symbol === sym);

  const toggleStar = async () => {
    try { if (starred) await del(`/api/trading/watchlist/${sym}`); else await post("/api/trading/watchlist", { symbol: sym }); reloadWatch(true); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: q?.display ?? sym, headerRight: () => <Pressable onPress={toggleStar} hitSlop={10}><Icons.star color={t.text} filled={starred} /></Pressable> }} />
      <Screen>
        <View>
          <Row gap={8} style={{ alignItems: "baseline" }}><T v="big">{fmtPrice(q?.price)}</T><Change v={q?.change_pct} v2="body" /></Row>
          <T v="tiny" color={t.muted}>{q?.name} · {q?.market_open ? "Market open" : "Market closed"}{q?.source === "sim" ? " · simulated data" : ""}</T>
        </View>
        <Row gap={18} style={{ borderBottomWidth: 1, borderBottomColor: t.border }}>
          {(["chart", "orders", "trades", "info"] as const).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: tab === k ? t.primary : "transparent", marginBottom: -1 }}>
              <T v="small" color={tab === k ? t.primary : t.muted} style={{ fontWeight: "600", textTransform: "capitalize" }}>{k === "orders" ? "My Orders" : k === "trades" ? "My Trades" : k}</T>
            </Pressable>
          ))}
        </Row>
        {tab === "chart" && (
          <>
            <Row gap={6}>{IV.map((i) => <Chip key={i} label={i} active={interval === i} onPress={() => setInterval(i)} />)}</Row>
            <CandleChart symbol={sym} interval={interval} height={280} />
            {pos && (
              <Card>
                <Row style={{ justifyContent: "space-between" }}>
                  <T v="small" color={t.muted}>Your position</T>
                  <T v="small" color={pos.unrealized_pnl >= 0 ? t.up : t.down} style={{ fontWeight: "700" }}>{fmtSignedUsd(pos.unrealized_pnl)}</T>
                </Row>
                <T v="h3">{fmtQty(pos.qty)} @ {fmtPrice(pos.avg_price)}</T>
              </Card>
            )}
          </>
        )}
        {tab === "orders" && (
          <View>
            {!orders?.length && <Empty text="No orders for this instrument." />}
            {orders?.map((o) => (
              <View key={o.id} style={styles(t).listRow}>
                <View style={{ flex: 1 }}>
                  <T v="h3" color={o.side === "buy" ? t.up : t.down}>{o.side.toUpperCase()} <T v="h3">{fmtQty(o.qty)}</T></T>
                  <T v="tiny" color={t.muted}>{o.type} · {o.status} · {fmtDate(o.created_at)}</T>
                </View>
                {o.status === "pending" && <Pressable onPress={async () => { await del(`/api/trading/orders/${o.id}`, { account_id: accountId ?? undefined }); reloadOrders(true); }}><T v="small" color={t.down}>Cancel</T></Pressable>}
              </View>
            ))}
          </View>
        )}
        {tab === "trades" && (
          <View>
            {!trades?.filter((x) => x.symbol === sym).length && <Empty text="You haven't traded this instrument yet." />}
            {trades?.filter((x) => x.symbol === sym).map((x) => (
              <View key={x.id} style={styles(t).listRow}>
                <T v="small" style={{ flex: 1 }} color={x.side === "buy" ? t.up : t.down}>{x.side.toUpperCase()} {fmtQty(x.qty)} @ {fmtPrice(x.price)}</T>
                <T v="tiny" color={t.muted}>{fmtDate(x.created_at)}</T>
              </View>
            ))}
          </View>
        )}
        {tab === "info" && (
          <>
            <Card>
              <KV k="Open" v={fmtPrice(q?.open)} /><KV k="High" v={fmtPrice(q?.high)} /><KV k="Low" v={fmtPrice(q?.low)} />
              <KV k="Prev close" v={fmtPrice(q?.prev_close)} /><KV k="Bid / Ask" v={`${fmtPrice(q?.bid)} / ${fmtPrice(q?.ask)}`} />
              <KV k="Volume" v={fmtCompact(q?.volume)} /><KV k="Asset class" v={q?.asset_class ?? "—"} /><KV k="Source" v={q?.source ?? "—"} />
            </Card>
            {signals && (
              <Card title="Technical summary" right={<Chip label={signals.verdict} color={signals.score > 0 ? "up" : signals.score < 0 ? "down" : undefined} />}>
                {signals.notes.map((n: string) => <T key={n} v="small" style={{ paddingVertical: 2 }}>• {n}</T>)}
              </Card>
            )}
          </>
        )}
      </Screen>
      <Row gap={12} style={{ padding: 16, paddingBottom: 16 + insets.bottom, backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.border }}>
        <Btn title="Buy" kind="buy" style={{ flex: 1 }} onPress={() => setSheet("buy")} />
        <Btn title="Sell" kind="sell" style={{ flex: 1 }} onPress={() => setSheet("sell")} />
      </Row>
      <OrderSheet symbol={sym} side={sheet ?? "buy"} visible={!!sheet} onClose={() => setSheet(null)} account={acct} onPlaced={() => { reload(true); reloadOrders(true); }} />
    </View>
  );
}
