import { useState } from "react";
import { del, post, put } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtSignedUsd, pnlClass } from "../lib/format";
import type { Trade } from "../lib/types";
import { Card, Empty, Modal, Skeleton } from "../components/ui";
import { I } from "../components/Icons";
import { toast } from "../store/ui";

const EMOTIONS = ["disciplined", "confident", "neutral", "anxious", "fearful", "greedy", "fomo", "revenge"];
const blank = { title: "", body: "", symbol: "", trade_id: null as number | null, setup: "", emotion: "neutral", tags: "", rating: 3, pnl: "" as string | number };

export function JournalPage() {
  const { data: entries, reload, loading } = useApi<any[]>("/api/journal");
  const { data: todo, reload: reloadTodo } = useApi<Trade[]>("/api/journal/unjournaled");
  const { data: stats, reload: reloadStats } = useApi<any>("/api/journal/analytics");
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const openFor = (t?: Trade) => {
    setEditId(null);
    setForm(t ? { ...blank, title: `${t.side === "sell" ? "Closed long" : "Closed short"} ${t.display}`, symbol: t.symbol, trade_id: t.id, pnl: t.net_pnl ?? "" } : { ...blank });
  };
  const save = async () => {
    if (!form) return;
    const body = { ...form, tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean), pnl: form.pnl === "" ? null : Number(form.pnl), symbol: form.symbol || null };
    try {
      if (editId) await put(`/api/journal/${editId}`, body); else await post("/api/journal", body);
      setForm(null); reload(true); reloadTodo(true); reloadStats(true);
      toast({ kind: "success", title: "Journal entry saved" });
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const shown = (entries ?? []).filter((e) => !filter || e.tags.includes(filter) || e.setup === filter || e.emotion === filter);

  return (
    <>
      <div className="page-head">
        <div><h1>Trading Journal</h1><p>Record why you took each trade and how you felt. Analytics reveal which setups and emotions make or lose money.</p></div>
        <button className="btn primary" onClick={() => openFor()}><I.plus width={14} />New entry</button>
      </div>
      {!!todo?.length && (
        <Card title={`Trades waiting for reflection (${todo.length})`}>
          <div className="row wrap">{todo.slice(0, 8).map((t) => (
            <button key={t.id} className="chip click" onClick={() => openFor(t)}>{t.display} <span className={pnlClass(t.net_pnl)}>{fmtSignedUsd(t.net_pnl)}</span></button>
          ))}</div>
        </Card>
      )}
      <div className="grid g-main">
        <Card title="Entries" actions={filter && <button className="chip click active" onClick={() => setFilter("")}>{filter} ✕</button>} pad={false}>
          {loading && !entries && <div style={{ padding: 16 }}><Skeleton h={200} /></div>}
          {entries && !shown.length && <Empty icon="book">No journal entries yet.</Empty>}
          {shown.map((e) => (
            <div key={e.id} className="post">
              <div className="row">
                <b className="grow">{e.title}</b>
                {e.pnl != null && <b className={`num ${pnlClass(e.pnl)}`}>{fmtSignedUsd(e.pnl)}</b>}
                <button className="btn xs ghost" onClick={() => { setEditId(e.id); setForm({ ...e, tags: e.tags.join(", "), symbol: e.symbol ?? "", pnl: e.pnl ?? "" }); }}>Edit</button>
                <button className="btn xs ghost danger" onClick={async () => { await del(`/api/journal/${e.id}`); reload(true); reloadStats(true); }}><I.trash width={12} /></button>
              </div>
              <div className="row wrap tiny mt-8">
                <span className="faint">{fmtDate(e.created_at)}</span>
                {e.symbol && <span className="chip blue">{e.symbol}</span>}
                {e.setup && <span className="chip click" onClick={() => setFilter(e.setup)}>setup: {e.setup}</span>}
                <span className="chip click" onClick={() => setFilter(e.emotion)}>{e.emotion}</span>
                {e.tags.map((t: string) => <span key={t} className="chip click" onClick={() => setFilter(t)}>#{t}</span>)}
                <span className="faint">execution {"★".repeat(e.rating)}{"☆".repeat(5 - e.rating)}</span>
              </div>
              {e.body && <div className="post-body small">{e.body}</div>}
            </div>
          ))}
        </Card>
        <div className="col gap-12">
          <Card title="Journal analytics">
            {!stats ? <Skeleton h={120} /> : (
              <>
                {stats.tips.map((t: string) => <div key={t} className="notice small mb-8">{t}</div>)}
                <div className="small muted mb-8">P&amp;L by emotion</div>
                {stats.by_emotion.map((r: any) => (
                  <div key={r.key} className="list-row small"><span className="grow" style={{ textTransform: "capitalize" }}>{r.key}</span><span className="muted">{r.entries}×</span><span className="muted" style={{ width: 52, textAlign: "right" }}>{r.win_rate != null ? `${r.win_rate}%` : "—"}</span><b className={`num ${pnlClass(r.pnl)}`} style={{ width: 84, textAlign: "right" }}>{fmtSignedUsd(r.pnl)}</b></div>
                ))}
                <div className="small muted mb-8 mt-12">P&amp;L by setup</div>
                {stats.by_setup.map((r: any) => (
                  <div key={r.key} className="list-row small"><span className="grow">{r.key}</span><span className="muted">{r.entries}×</span><b className={`num ${pnlClass(r.pnl)}`} style={{ width: 84, textAlign: "right" }}>{fmtSignedUsd(r.pnl)}</b></div>
                ))}
              </>
            )}
          </Card>
        </div>
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={editId ? "Edit entry" : "New journal entry"} width={520}>
        {form && (
          <div className="col gap-12">
            <label className="field">Title<input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            {form.trade_id && <div className="notice small">Linked to execution #{form.trade_id}</div>}
            <div className="grid g-3" style={{ gap: 8 }}>
              <label className="field">Symbol<input className="input" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></label>
              <label className="field">Setup<input className="input" placeholder="breakout" value={form.setup} onChange={(e) => setForm({ ...form, setup: e.target.value })} /></label>
              <label className="field">P&amp;L<input className="input num" value={form.pnl} onChange={(e) => setForm({ ...form, pnl: e.target.value })} /></label>
            </div>
            <div className="grid g-2" style={{ gap: 8 }}>
              <label className="field">Emotion<select className="input" value={form.emotion} onChange={(e) => setForm({ ...form, emotion: e.target.value })}>{EMOTIONS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field">Execution rating<select className="input" value={form.rating} onChange={(e) => setForm({ ...form, rating: +e.target.value })}>{[1, 2, 3, 4, 5].map((x) => <option key={x} value={x}>{"★".repeat(x)}</option>)}</select></label>
            </div>
            <label className="field">Tags (comma separated)<input className="input" placeholder="trend, earnings" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
            <label className="field">Notes<textarea className="input" rows={5} placeholder="Why did you enter? What was the plan? What would you do differently?" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
            <button className="btn primary" disabled={!form.title.trim()} onClick={save}>Save entry</button>
          </div>
        )}
      </Modal>
    </>
  );
}
