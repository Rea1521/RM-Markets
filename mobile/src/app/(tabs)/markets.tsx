import { useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { del, post } from "../../lib/api";
import { useApi, useQuotes } from "../../lib/hooks";
import { fmtPrice } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { toast } from "../../lib/ui";
import type { Quote } from "../../lib/types";
import { Change, Chip, Loading, Row, SymbolIcon, T, styles } from "../../components/ui";
import { Icons } from "../../components/icons";

const CLASSES = [{ v: "all", l: "All" }, { v: "crypto", l: "Crypto" }, { v: "stock", l: "Stocks" }, { v: "forex", l: "Forex" }, { v: "commodity", l: "Commodities" }, { v: "index", l: "Indices" }];

export default function Markets() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [cls, setCls] = useState("all");
  const [q, setQ] = useState("");
  const { data, loading, reload } = useApi<Quote[]>("/api/market/quotes");
  const { data: watch, reload: reloadWatch } = useApi<Quote[]>("/api/trading/watchlist");
  const live = useQuotes((data ?? []).map((x) => x.symbol));
  const watched = new Set((watch ?? []).map((w) => w.symbol));
  const rows = useMemo(() => (data ?? []).map((x) => live[x.symbol] ?? x)
    .filter((x) => (cls === "all" || x.asset_class === cls) && (!q || `${x.display} ${x.name}`.toLowerCase().includes(q.toLowerCase()))), [data, live, cls, q]);
  const toggle = async (s: string) => {
    try { if (watched.has(s)) await del(`/api/trading/watchlist/${s}`); else await post("/api/trading/watchlist", { symbol: s }); reloadWatch(true); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={{ padding: 16, gap: 10 }}>
        <T v="h1">Markets</T>
        <TextInput placeholder="Search instruments" placeholderTextColor={t.faint} value={q} onChangeText={setQ}
          style={{ height: 40, borderRadius: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, color: t.text }} />
        <Row gap={6} style={{ flexWrap: "wrap" }}>{CLASSES.map((c) => <Chip key={c.v} label={c.l} active={cls === c.v} onPress={() => setCls(c.v)} />)}</Row>
      </View>
      {loading && !data ? <Loading /> : (
        <FlatList data={rows} keyExtractor={(x) => x.symbol} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} onRefresh={reload} refreshing={false}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/symbol/${item.symbol}`)} style={styles(t).listRow}>
              <Pressable onPress={() => toggle(item.symbol)} hitSlop={8}><Icons.star color={t.faint} size={18} filled={watched.has(item.symbol)} /></Pressable>
              <SymbolIcon symbol={item.symbol} display={item.display} size={28} />
              <View style={{ flex: 1 }}><T v="h3">{item.display}</T><T v="tiny" color={t.muted} numberOfLines={1}>{item.name}{item.source === "sim" ? " · simulated" : ""}</T></View>
              <View style={{ alignItems: "flex-end" }}><T v="h3">{fmtPrice(item.price)}</T><Change v={item.change_pct} v2="tiny" /></View>
            </Pressable>
          )} />
      )}
    </View>
  );
}
