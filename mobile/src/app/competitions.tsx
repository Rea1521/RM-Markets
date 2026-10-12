import { router } from "expo-router";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtPct, fmtUsd } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast, useAccountSel } from "../lib/ui";
import { Btn, Card, Chip, KV, Loading, Row, Screen, T } from "../components/ui";

export default function Competitions() {
  const t = useTheme();
  const { accountId, setAccountId } = useAccountSel();
  const { data, reload, loading } = useApi<any[]>("/api/competitions");
  const join = async (id: number) => {
    try { const c = await post(`/api/competitions/${id}/join`); setAccountId(c.account_id); toast({ kind: "success", title: `Joined ${c.name}`, body: "Switched to the competition account" }); reload(true); router.back(); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Card title="Active trading account">
        <T v="small" color={t.muted}>{accountId ? "You're trading a competition account." : "You're trading your main account."}</T>
        {accountId && <Btn small title="Switch to main account" onPress={() => { setAccountId(null); toast({ kind: "info", title: "Main account active" }); }} style={{ marginTop: 10 }} />}
      </Card>
      {loading && !data && <Loading />}
      {data?.map((c) => (
        <Card key={c.id} title={`🏆 ${c.name}`} right={<Chip label={c.status} color={c.status === "active" ? "up" : c.status === "scheduled" ? "blue" : undefined} />}>
          <T v="small" color={t.muted}>{c.description}</T>
          <KV k="Starting balance" v={fmtUsd(c.starting_balance, 0)} />
          <KV k="Ends" v={fmtDate(c.end_at)} />
          <KV k="Participants" v={`${c.participants}/${c.max_participants}`} />
          <KV k="Markets" v={c.allowed_asset_classes.join(", ") || "All"} />
          <KV k="Prize" v={c.prize || "—"} />
          {!!c.winners.length && <T v="small" color={t.up}>{c.winners.map((w: any) => `#${w.rank} ${w.username} ${fmtPct(w.return_pct)}`).join(" · ")}</T>}
          <Row gap={10} style={{ marginTop: 10 }}>
            {c.joined ? <Btn small kind={c.account_id === accountId ? "default" : "primary"} title={c.account_id === accountId ? "Active" : "Trade this account"} onPress={() => setAccountId(c.account_id)} style={{ flex: 1 }} />
              : c.status !== "finished" && <Btn small kind="primary" title="Join" onPress={() => join(c.id)} style={{ flex: 1 }} />}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
