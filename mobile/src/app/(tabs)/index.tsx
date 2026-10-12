import { useEffect, useMemo, useState } from "react";
import { Image, Linking, Modal, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { get, post } from "../../lib/api";
import { useAccount, useApi, useQuotes } from "../../lib/hooks";
import { fmtPct, fmtPrice, fmtSignedUsd, fmtUsd, timeAgo } from "../../lib/format";
import { useTheme } from "../../lib/theme";
import { toast, useAccountSel } from "../../lib/ui";
import { useMarket } from "../../lib/market";
import type { NewsItem, Quote } from "../../lib/types";
import { Btn, Card, Change, Empty, Input, Row, Screen, Sparkline, SymbolIcon, T, styles } from "../../components/ui";
import { Icons } from "../../components/icons";
import { VoiceButton } from "../../components/VoiceButton";
import { syncWidgets } from "../../widgets/sync";

function useSparklines(symbols: string[]) {
  const [data, setData] = useState<Record<string, number[]>>({});
  const key = symbols.join(",");
  useEffect(() => {
    let alive = true;
    symbols.forEach((s) => get(`/api/market/history/${s}`, { interval: "1h", limit: 24 })
      .then((h) => alive && setData((d) => ({ ...d, [s]: h.candles.map((c: any) => c.c) }))).catch(() => {}));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: acct, reload, loading } = useAccount();
  const { data: watch, reload: reloadWatch } = useApi<Quote[]>("/api/trading/watchlist");
  const { data: news } = useApi<{ items: NewsItem[] }>("/api/news", { params: { limit: 4 }, poll: 300000 });
  const { data: notif } = useApi<{ unread: number }>("/api/trading/notifications", { poll: 30000 });
  const symbols = useMemo(() => (watch ?? []).map((w) => w.symbol), [watch]);
  const live = useQuotes(symbols);
  const spark = useSparklines(symbols);
  const status = useMarket((s) => s.status);
  const accountId = useAccountSel((s) => s.accountId);
  const [funds, setFunds] = useState<null | "deposit" | "withdraw">(null);
  const [amount, setAmount] = useState("10000");

  const rows = (watch ?? []).map((w) => live[w.symbol] ?? w);
  useEffect(() => { if (rows.length) syncWidgets(rows); }, [rows.map((r) => r.price).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const doFunds = async () => {
    try {
      await post(`/api/trading/account/${funds}`, { amount: Number(amount), account_id: accountId ?? undefined });
      toast({ kind: "success", title: `${funds === "deposit" ? "Deposited" : "Withdrew"} ${fmtUsd(Number(amount))}` });
      setFunds(null); reload(true);
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };

  const actions = [
    { label: "Deposit", icon: Icons.deposit, on: () => { setAmount("10000"); setFunds("deposit"); } },
    { label: "Withdraw", icon: Icons.withdraw, on: () => { setAmount("1000"); setFunds("withdraw"); } },
    { label: "Accounts", icon: Icons.transfer, on: () => router.push("/competitions") },
    { label: "History", icon: Icons.history, on: () => router.push("/history") },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Row style={{ paddingHorizontal: 16, height: 52, backgroundColor: t.bg }} gap={14}>
        <Pressable onPress={() => router.push("/more")} hitSlop={10}><Icons.menu color={t.text} /></Pressable>
        <T v="h2" style={{ flex: 1 }}>RM Markets</T>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status === "open" ? t.up : t.warn }} />
        <VoiceButton />
        <Pressable onPress={() => router.push("/settings")} hitSlop={10}>
          <Icons.bell color={t.text} />
          {!!notif?.unread && <View style={{ position: "absolute", top: -2, right: -2, backgroundColor: t.down, borderRadius: 7, minWidth: 14, height: 14, alignItems: "center", justifyContent: "center" }}><T style={{ fontSize: 9, fontWeight: "700" }} color="#fff">{notif.unread}</T></View>}
        </Pressable>
      </Row>
      <Screen refreshing={loading} onRefresh={() => { reload(); reloadWatch(); }}>
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <T v="small" color={t.muted}>{accountId ? "Competition account" : "Total Balance"}</T>
            <T v="small" color={(acct?.total_pnl_pct ?? 0) >= 0 ? t.up : t.down} style={{ fontWeight: "700" }}>{fmtPct(acct?.total_pnl_pct)}</T>
          </Row>
          <T v="big" style={{ marginTop: 4 }}>{fmtUsd(acct?.equity)}</T>
          <Row style={{ marginTop: 6 }} gap={14}>
            <T v="tiny" color={t.muted}>Day <T v="tiny" color={(acct?.day_pnl ?? 0) >= 0 ? t.up : t.down}>{fmtSignedUsd(acct?.day_pnl)}</T></T>
            <T v="tiny" color={t.muted}>Buying power <T v="tiny">{fmtUsd(acct?.buying_power, 0)}</T></T>
            <T v="tiny" color={t.muted}>Win rate <T v="tiny">{(acct?.win_rate ?? 0).toFixed(1)}%</T></T>
          </Row>
          <Row style={{ justifyContent: "space-around", marginTop: 16 }}>
            {actions.map((a) => (
              <Pressable key={a.label} onPress={a.on} style={{ alignItems: "center", gap: 6 }}>
                <a.icon color={t.text} size={20} />
                <T v="tiny" color={t.text2}>{a.label}</T>
              </Pressable>
            ))}
          </Row>
        </Card>

        <Card title="Watchlist" right={<Pressable onPress={() => router.push("/markets")}><T v="small" color={t.primary}>Edit</T></Pressable>}>
          {!rows.length && <Empty text="Your watchlist is empty. Add instruments from Markets." />}
          {rows.map((q) => (
            <Pressable key={q.symbol} onPress={() => router.push(`/symbol/${q.symbol}`)} style={styles(t).listRow}>
              <SymbolIcon symbol={q.symbol} display={q.display} size={26} />
              <T v="h3" style={{ flex: 1 }}>{q.display}</T>
              <Sparkline data={spark[q.symbol] ?? []} />
              <View style={{ alignItems: "flex-end", minWidth: 84 }}>
                <T v="small" color={q.change_pct >= 0 ? t.up : t.down} style={{ fontWeight: "600" }}>{fmtPrice(q.price)}</T>
                <Change v={q.change_pct} v2="tiny" />
              </View>
            </Pressable>
          ))}
        </Card>

        <Card title="News" right={<Pressable onPress={() => router.push("/news")}><T v="small" color={t.primary}>View All</T></Pressable>}>
          {!news?.items.length && <Empty text="No headlines available right now." />}
          {news?.items.map((n) => (
            <Pressable key={n.id} onPress={() => Linking.openURL(n.url)} style={[styles(t).listRow, { alignItems: "flex-start" }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <T v="small" style={{ fontWeight: "600" }} numberOfLines={2}>{n.title}</T>
                <T v="tiny" color={t.muted}>{n.source} · {timeAgo(n.published_at)}</T>
              </View>
              {n.image ? <Image source={{ uri: n.image }} style={{ width: 64, height: 46, borderRadius: 6, backgroundColor: t.surface3 }} /> : null}
            </Pressable>
          ))}
        </Card>
      </Screen>
      <Modal visible={!!funds} transparent animationType="fade" onRequestClose={() => setFunds(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: t.surface, borderRadius: 16, padding: 18, gap: 12 }}>
            <T v="h2">{funds === "deposit" ? "Deposit virtual funds" : "Withdraw virtual funds"}</T>
            <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} suffix="USD" />
            <Btn kind="primary" title="Confirm" onPress={doFunds} />
            <Btn kind="ghost" title="Cancel" onPress={() => setFunds(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
