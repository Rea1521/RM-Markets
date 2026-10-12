import { useState } from "react";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { timeAgo } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast } from "../lib/ui";
import { Btn, Card, Chip, Empty, Input, Row, Screen, Seg, T } from "../components/ui";

export default function Social() {
  const t = useTheme();
  const [scope, setScope] = useState<"all" | "following" | "mine">("all");
  const { data: feed, reload, loading } = useApi<any[]>("/api/social/feed", { params: { scope } });
  const { data: trending } = useApi<any[]>("/api/social/trending");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState<"neutral" | "bullish" | "bearish">("neutral");
  const submit = async () => {
    try { await post("/api/social/posts", { body, sentiment: sent }); setBody(""); reload(true); } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const like = async (id: number) => { await post(`/api/social/posts/${id}/like`); reload(true); };
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Card>
        <Input multiline value={body} onChangeText={setBody} placeholder="Share an idea… use $BTC, $AAPL cashtags" style={{ minHeight: 60 }} />
        <Row style={{ marginTop: 10, justifyContent: "space-between" }}>
          <Seg value={sent} onChange={setSent} options={[{ value: "neutral", label: "Neutral" }, { value: "bullish", label: "Bull" }, { value: "bearish", label: "Bear" }]} />
          <Btn small kind="primary" title="Post" disabled={!body.trim()} onPress={submit} />
        </Row>
      </Card>
      {!!trending?.length && <Row gap={6} style={{ flexWrap: "wrap" }}>{trending.map((x) => <Chip key={x.symbol} label={`$${x.symbol} · ${x.mentions}`} color="blue" onPress={() => router.push(`/symbol/${x.symbol}`)} />)}</Row>}
      <Seg value={scope} onChange={setScope} options={[{ value: "all", label: "Everyone" }, { value: "following", label: "Following" }, { value: "mine", label: "Mine" }]} />
      {feed && !feed.length && <Empty text="No posts yet. Be the first!" />}
      {feed?.map((p) => (
        <Card key={p.id}>
          <Row style={{ justifyContent: "space-between" }}>
            <T v="h3">{p.author.display_name} <T v="tiny" color={t.muted}>@{p.author.username} · {timeAgo(p.created_at)}</T></T>
            {p.sentiment !== "neutral" && <Chip label={p.sentiment} color={p.sentiment === "bullish" ? "up" : "down"} />}
          </Row>
          <T style={{ marginVertical: 8 }}>{p.body}</T>
          <Row gap={16}>
            <Pressable onPress={() => like(p.id)}><T v="small" color={p.liked ? t.down : t.muted}>♥ {p.likes}</T></Pressable>
            <T v="small" color={t.muted}>💬 {p.comments}</T>
            {p.symbols.map((s: string) => <Chip key={s} label={s} color="blue" onPress={() => router.push(`/symbol/${s}`)} />)}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
