import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { post } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtPct, fmtUsd, pnlClass } from "../lib/format";
import { useAuth } from "../store/auth";
import { toast, useUi } from "../store/ui";
import { Card, Empty, Modal, Seg, Skeleton } from "../components/ui";
import { I } from "../components/Icons";

function countdown(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

export function CompetitionsPage() {
  const [status, setStatus] = useState("all");
  const { data: comps, reload, loading } = useApi<any[]>("/api/competitions", { params: { status: status === "all" ? undefined : status } });
  const [openId, setOpenId] = useState<number | null>(null);
  const [create, setCreate] = useState(false);
  const { setAccountId } = useUi();
  const nav = useNavigate();
  const user = useAuth((s) => s.user);

  const join = async (id: number) => {
    try {
      const c = await post(`/api/competitions/${id}/join`);
      setAccountId(c.account_id);
      toast({ kind: "success", title: `Joined ${c.name}`, body: "Switched to your competition account. Trade from the dashboard." });
      reload(true);
      nav("/");
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Paper Trading Competitions</h1><p>Everyone starts with the same virtual balance in a separate account. Highest % return wins.</p></div>
        <div className="row"><Seg value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "active", label: "Live" }, { value: "scheduled", label: "Upcoming" }, { value: "finished", label: "Finished" }]} />
          <button className="btn primary" onClick={() => setCreate(true)} disabled={user?.is_demo} title={user?.is_demo ? "Register to host competitions" : ""}><I.plus width={14} />Host</button></div>
      </div>
      {loading && !comps && <Skeleton h={200} />}
      {comps && !comps.length && <Card><Empty icon="trophy">No competitions here yet.</Empty></Card>}
      <div className="grid g-3">
        {comps?.map((c) => (
          <Card key={c.id} title={<div className="row"><I.trophy width={16} style={{ color: "#f59e0b" }} /><h2>{c.name}</h2></div>}
            actions={<span className={`chip ${c.status === "active" ? "up" : c.status === "scheduled" ? "blue" : ""}`}>{c.status === "active" ? "Live" : c.status}</span>}>
            <p className="small muted" style={{ marginTop: 0 }}>{c.description}</p>
            <dl className="kv small">
              <dt>Starting balance</dt><dd>{fmtUsd(c.starting_balance, 0)}</dd>
              <dt>{c.status === "scheduled" ? "Starts in" : c.status === "active" ? "Ends in" : "Ended"}</dt><dd>{c.status === "finished" ? fmtDate(c.end_at, false) : countdown(c.status === "scheduled" ? c.start_at : c.end_at)}</dd>
              <dt>Participants</dt><dd>{c.participants} / {c.max_participants}</dd>
              <dt>Markets</dt><dd>{c.allowed_asset_classes.length ? c.allowed_asset_classes.join(", ") : "All"}</dd>
              <dt>Prize</dt><dd style={{ whiteSpace: "normal" }}>{c.prize || "—"}{c.prize_pool ? ` (${fmtUsd(c.prize_pool, 0)})` : ""}</dd>
              {c.sponsor && <><dt>Sponsor</dt><dd>{c.sponsor}</dd></>}
            </dl>
            {!!c.winners.length && <div className="notice ok small mt-8">🏆 {c.winners.map((w: any) => `#${w.rank} ${w.username} (${fmtPct(w.return_pct)})`).join(" · ")}</div>}
            <div className="row mt-12">
              <button className="btn sm" onClick={() => setOpenId(c.id)}>Leaderboard</button>
              <div className="grow" />
              {c.joined ? <button className="btn sm primary" onClick={() => { setAccountId(c.account_id); nav("/"); }}>Trade</button>
                : c.status !== "finished" && <button className="btn sm primary" onClick={() => join(c.id)}>Join</button>}
            </div>
          </Card>
        ))}
      </div>
      <p className="tiny faint">Prizes are provided and fulfilled by each competition's sponsor. RM Markets never handles real money; winners are recorded and notified when a competition ends.</p>
      <Leaderboard id={openId} onClose={() => setOpenId(null)} />
      <CreateModal open={create} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); reload(true); }} />
    </>
  );
}

function Leaderboard({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data } = useApi<any>(id ? `/api/competitions/${id}` : null, { poll: 15000 });
  return (
    <Modal open={id != null} onClose={onClose} title={data?.name ?? "Leaderboard"} width={620}>
      {!data ? <Skeleton h={200} /> : !data.leaderboard.length ? <Empty icon="trophy">No participants yet.</Empty> : (
        <table className="tbl"><thead><tr><th>#</th><th>Trader</th><th className="r">Equity</th><th className="r">Return</th><th className="r">Trades</th></tr></thead>
          <tbody>{data.leaderboard.map((r: any) => (
            <tr key={r.user_id}><td>{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td><td><b>{r.display_name}</b> <span className="tiny faint">@{r.username}</span></td>
              <td className="r num">{fmtUsd(r.equity)}</td><td className={`r num bold ${pnlClass(r.return_pct)}`}>{fmtPct(r.return_pct)}</td><td className="r">{r.trades}</td></tr>
          ))}</tbody></table>
      )}
    </Modal>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ name: "", description: "", starting_balance: 100000, start_at: toLocal(new Date()), end_at: toLocal(new Date(Date.now() + 7 * 86400000)), prize: "", prize_pool: 0, sponsor: "", allowed: [] as string[], max_participants: 100 });
  const submit = async () => {
    try {
      await post("/api/competitions", { name: f.name, description: f.description, starting_balance: +f.starting_balance, start_at: new Date(f.start_at).toISOString(), end_at: new Date(f.end_at).toISOString(),
        prize: f.prize, prize_pool: +f.prize_pool, sponsor: f.sponsor, allowed_asset_classes: f.allowed, max_participants: +f.max_participants });
      toast({ kind: "success", title: "Competition created" });
      onCreated();
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Host a competition" width={520}>
      <div className="col gap-12">
        <label className="field">Name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Description<textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="grid g-2" style={{ gap: 8 }}>
          <label className="field">Starts<input className="input" type="datetime-local" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} /></label>
          <label className="field">Ends<input className="input" type="datetime-local" value={f.end_at} onChange={(e) => setF({ ...f, end_at: e.target.value })} /></label>
          <label className="field">Starting balance<input className="input num" type="number" value={f.starting_balance} onChange={(e) => setF({ ...f, starting_balance: +e.target.value })} /></label>
          <label className="field">Max participants<input className="input num" type="number" value={f.max_participants} onChange={(e) => setF({ ...f, max_participants: +e.target.value })} /></label>
          <label className="field">Prize<input className="input" placeholder="e.g. R2,000 voucher" value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} /></label>
          <label className="field">Sponsor<input className="input" value={f.sponsor} onChange={(e) => setF({ ...f, sponsor: e.target.value })} /></label>
        </div>
        <div className="row wrap gap-4"><span className="small muted">Markets:</span>{["crypto", "stock", "forex", "commodity", "index"].map((c) => (
          <span key={c} className={`chip click ${f.allowed.includes(c) ? "active" : ""}`} onClick={() => setF({ ...f, allowed: f.allowed.includes(c) ? f.allowed.filter((x) => x !== c) : [...f.allowed, c] })}>{c}</span>
        ))}<span className="tiny faint">(none selected = all)</span></div>
        <button className="btn primary" disabled={f.name.length < 3} onClick={submit}>Create competition</button>
      </div>
    </Modal>
  );
}
