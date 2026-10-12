import { useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";
import { useApi } from "../lib/hooks";
import { timeAgo } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { NewsItem } from "../lib/types";
import { Chip, Empty, Loading, Row, Screen, T, styles } from "../components/ui";

export default function News() {
  const t = useTheme();
  const [cat, setCat] = useState("all");
  const { data, loading, reload } = useApi<{ items: NewsItem[]; sources: any }>("/api/news", { params: { category: cat === "all" ? undefined : cat, limit: 60 } });
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Row gap={6} style={{ flexWrap: "wrap" }}>{["all", "stock", "crypto", "forex", "commodity"].map((c) => <Chip key={c} label={c} active={cat === c} onPress={() => setCat(c)} />)}</Row>
      {loading && !data && <Loading />}
      {data && !data.items.length && <Empty text="No headlines right now. News sources may be unreachable from the server." />}
      {data?.items.map((n) => (
        <Pressable key={n.id} onPress={() => Linking.openURL(n.url)} style={[styles(t).listRow, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <T v="h3" numberOfLines={3}>{n.title}</T>
            <Row gap={6} style={{ flexWrap: "wrap" }}>
              <T v="tiny" color={t.muted}>{n.source} · {timeAgo(n.published_at)}</T>
              {n.sentiment !== "neutral" && <Chip label={n.sentiment} color={n.sentiment === "bullish" ? "up" : "down"} />}
              {n.symbols.slice(0, 3).map((s) => <Chip key={s} label={s} color="blue" />)}
            </Row>
          </View>
          {n.image ? <Image source={{ uri: n.image }} style={{ width: 70, height: 52, borderRadius: 6 }} /> : null}
        </Pressable>
      ))}
    </Screen>
  );
}
