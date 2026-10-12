import { useState } from "react";
import { View } from "react-native";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtSignedUsd } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast } from "../lib/ui";
import type { Trade } from "../lib/types";
import { Btn, Card, Chip, Empty, Input, KV, Row, Screen, T } from "../components/ui";

const EMO = ["disciplined", "confident", "neutral", "anxious", "fearful", "greedy", "fomo", "revenge"];

export default function Journal() {
  const t = useTheme();
  const { data: entries, reload } = useApi<any[]>("/api/journal");
  const { data: todo, reload: reloadTodo } = useApi<Trade[]>("/api/journal/unjournaled");
  const { data: stats, reload: reloadStats } = useApi<any>("/api/journal/analytics");
  const [f, setF] = useState<any>(null);
  const save = async () => {
    try {
      await post("/api/journal", { ...f, tags: (f.tags || "").split(",").map((x: string) => x.trim()).filter(Boolean), pnl: f.pnl === "" || f.pnl == null ? null : Number(f.pnl) });
      setF(null); reload(true); reloadTodo(true); reloadStats(true);
      toast({ kind: "success", title: "Saved" });
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  return (
    <Screen>
      {!f && <Btn kind="primary" title="New entry" onPress={() => setF({ title: "", body: "", setup: "", emotion: "neutral", tags: "", rating: 3, pnl: "" })} />}
      {!f && !!todo?.length && (
        <Card title="Reflect on recent trades">
          <Row gap={6} style={{ flexWrap: "wrap" }}>
            {todo.slice(0, 6).map((x) => <Chip key={x.id} label={`${x.display} ${fmtSignedUsd(x.net_pnl)}`} color={(x.net_pnl ?? 0) >= 0 ? "up" : "down"}
              onPress={() => setF({ title: `Closed ${x.display}`, trade_id: x.id, symbol: x.symbol, body: "", setup: "", emotion: "neutral", tags: "", rating: 3, pnl: x.net_pnl })} />)}
          </Row>
        </Card>
      )}
      {f && (
        <Card title="Journal entry">
          <View style={{ gap: 10 }}>
            <Input label="Title" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} />
            <Input label="Setup" value={f.setup} onChangeText={(v) => setF({ ...f, setup: v })} placeholder="breakout, pullback…" />
            <T v="small" color={t.muted}>Emotion</T>
            <Row gap={6} style={{ flexWrap: "wrap" }}>{EMO.map((e) => <Chip key={e} label={e} active={f.emotion === e} onPress={() => setF({ ...f, emotion: e })} />)}</Row>
            <T v="small" color={t.muted}>Execution rating</T>
            <Row gap={6}>{[1, 2, 3, 4, 5].map((r) => <Chip key={r} label={"★".repeat(r)} active={f.rating === r} onPress={() => setF({ ...f, rating: r })} />)}</Row>
            <Input label="Tags (comma separated)" value={f.tags} onChangeText={(v) => setF({ ...f, tags: v })} />
            <Input label="Notes" multiline value={f.body} onChangeText={(v) => setF({ ...f, body: v })} style={{ minHeight: 80 }} />
            <Row gap={10}><Btn title="Cancel" onPress={() => setF(null)} style={{ flex: 1 }} /><Btn kind="primary" title="Save" disabled={!f.title} onPress={save} style={{ flex: 1 }} /></Row>
          </View>
        </Card>
      )}
      {stats?.tips?.map((x: string) => <Card key={x}><T v="small">💡 {x}</T></Card>)}
      {stats?.by_emotion?.length > 0 && <Card title="P&L by emotion">{stats.by_emotion.map((r: any) => <KV key={r.key} k={`${r.key} (${r.entries})`} v={fmtSignedUsd(r.pnl)} vColor={r.pnl >= 0 ? t.up : t.down} />)}</Card>}
      {entries && !entries.length && <Empty text="No entries yet." />}
      {entries?.map((e) => (
        <Card key={e.id}>
          <Row style={{ justifyContent: "space-between" }}><T v="h3" style={{ flex: 1 }}>{e.title}</T>{e.pnl != null && <T v="h3" color={e.pnl >= 0 ? t.up : t.down}>{fmtSignedUsd(e.pnl)}</T>}</Row>
          <T v="tiny" color={t.muted}>{fmtDate(e.created_at)} · {e.emotion}{e.setup ? ` · ${e.setup}` : ""} · {"★".repeat(e.rating)}</T>
          {e.body ? <T v="small" style={{ marginTop: 6 }}>{e.body}</T> : null}
        </Card>
      ))}
    </Screen>
  );
}
