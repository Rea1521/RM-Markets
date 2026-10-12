import { useState } from "react";
import { api, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { API_URL, WS_URL } from "../lib/config";
import { useApi } from "../lib/hooks";
import { useMarket } from "../lib/market";
import { timeAgo } from "../lib/format";
import { useTheme, useThemePref } from "../lib/theme";
import { toast } from "../lib/ui";
import { Btn, Card, Input, KV, Screen, Seg, T } from "../components/ui";

export default function Settings() {
  const t = useTheme();
  const { user, setUser } = useAuth();
  const { mode, set } = useThemePref();
  const ws = useMarket((s) => s.status);
  const [name, setName] = useState(user?.display_name ?? "");
  const { data: health } = useApi<any>("/health");
  const { data: notif, reload } = useApi<{ items: any[] }>("/api/trading/notifications");
  return (
    <Screen>
      <Card title="Notifications" right={<T v="small" color={t.primary} onPress={async () => { await post("/api/trading/notifications/read"); reload(true); }}>Mark read</T>}>
        {!notif?.items.length && <T v="small" color={t.muted}>Order fills, price alerts and competition results appear here.</T>}
        {notif?.items.slice(0, 10).map((n) => <KV key={n.id} k={n.title} v={timeAgo(n.created_at)} />)}
      </Card>
      <Card title="Profile">
        <Input label="Display name" value={name} onChangeText={setName} />
        <Btn small kind="primary" title="Save" style={{ marginTop: 10 }} onPress={async () => {
          try { setUser(await api("/api/auth/me", { method: "PATCH", body: { display_name: name } })); toast({ kind: "success", title: "Saved" }); }
          catch (e) { toast({ kind: "error", title: (e as Error).message }); }
        }} />
      </Card>
      <Card title="Appearance">
        <Seg value={mode} onChange={set} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
      </Card>
      <Card title="Connection">
        <KV k="API" v={API_URL} />
        <KV k="WebSocket" v={ws} vColor={ws === "open" ? t.up : t.warn} />
        <KV k="Socket URL" v={WS_URL} />
        <KV k="Backend" v={health?.status ?? "…"} vColor={health?.status === "ok" ? t.up : t.down} />
        <KV k="Cache" v={health?.cache ?? "…"} />
      </Card>
    </Screen>
  );
}
