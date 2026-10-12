import { useState } from "react";
import { Linking, View } from "react-native";
import { useApi } from "../lib/hooks";
import { useTheme } from "../lib/theme";
import { Card, Chip, Empty, Loading, Row, Screen, T } from "../components/ui";

export default function Calendar() {
  const t = useTheme();
  const [impact, setImpact] = useState("high");
  const { data, loading, reload } = useApi<{ events: any[]; errors: any }>("/api/calendar", { params: { impact: impact === "all" ? undefined : impact } });
  const days = new Map<string, any[]>();
  (data?.events ?? []).forEach((e) => {
    const k = new Date(e.time * 1000).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    days.set(k, [...(days.get(k) ?? []), e]);
  });
  const color = (i: string) => (i === "high" ? t.down : i === "medium" ? t.warn : t.faint);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Row gap={6}>{["high", "medium", "low", "all"].map((c) => <Chip key={c} label={c} active={impact === c} onPress={() => setImpact(c)} />)}</Row>
      {loading && !data && <Loading />}
      {data && !data.events.length && <Empty text="No events available. The calendar source may be unreachable." />}
      {[...days.entries()].map(([day, evs]) => (
        <Card key={day} title={day}>
          {evs.map((e) => (
            <View key={e.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border, gap: 3 }}>
              <Row gap={8}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color(e.impact) }} />
                <T v="tiny" color={t.muted}>{new Date(e.time * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</T>
                <T v="tiny" style={{ fontWeight: "700" }}>{e.country}</T>
              </Row>
              <T v="h3">{e.title}</T>
              <T v="tiny" color={t.muted}>Actual {e.actual ?? "—"} · Forecast {e.forecast ?? "—"} · Previous {e.previous ?? "—"}</T>
              {e.related_news.map((n: any) => <T key={n.url} v="tiny" color={t.primary} onPress={() => Linking.openURL(n.url)} numberOfLines={1}>↳ {n.title}</T>)}
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
