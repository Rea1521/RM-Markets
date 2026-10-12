import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtNum, fmtPrice } from "../lib/format";
import { useTheme } from "../lib/theme";
import { Card, Change, Chip, Empty, Loading, Row, Screen, Sparkline, T, styles } from "../components/ui";

export default function Screener() {
  const t = useTheme();
  const { data: pd } = useApi<{ count: number; presets: any[] }>("/api/analytics/screener/presets");
  const [group, setGroup] = useState("Strategies");
  const [sel, setSel] = useState<string[]>([]);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => [...new Set((pd?.presets ?? []).map((p) => p.group))], [pd]);
  useEffect(() => {
    setBusy(true);
    post("/api/analytics/screener", { presets: sel, limit: 100 }).then(setRes).catch(() => setRes(null)).finally(() => setBusy(false));
  }, [sel]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Screen>
      <T v="small" color={t.muted}>{pd?.count ?? "100+"} preset filters. Tap to combine.</T>
      <Row gap={6} style={{ flexWrap: "wrap" }}>{groups.map((g) => <Chip key={g} label={g} active={group === g} onPress={() => setGroup(g)} />)}</Row>
      <Card>
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          {(pd?.presets ?? []).filter((p) => p.group === group).map((p) => <Chip key={p.id} label={p.name} active={sel.includes(p.id)} onPress={() => toggle(p.id)} />)}
        </Row>
      </Card>
      {!!sel.length && <Pressable onPress={() => setSel([])}><T v="small" color={t.primary}>Clear {sel.length} filter(s)</T></Pressable>}
      <Card title={res ? `${res.total} of ${res.universe} match` : "Results"}>
        {busy && !res && <Loading />}
        {res && !res.results.length && <Empty text="No matches. Remove a filter." />}
        {res?.results.map((r: any) => (
          <Pressable key={r.symbol} onPress={() => router.push(`/symbol/${r.symbol}`)} style={styles(t).listRow}>
            <View style={{ flex: 1 }}><T v="h3">{r.display}</T><T v="tiny" color={t.muted}>RSI {fmtNum(r.rsi_14, 1)} · 1M {fmtNum(r.perf_1m, 1)}%</T></View>
            <Sparkline data={r.sparkline} />
            <View style={{ alignItems: "flex-end", minWidth: 80 }}><T v="small">{fmtPrice(r.price)}</T><Change v={r.change_pct} v2="tiny" /></View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
