import { useEffect, useMemo, useState } from "react";
import { post } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtCompact, fmtNum, fmtPct, fmtPrice } from "../lib/format";
import { Card, Change, Empty, Skeleton, Sparkline, SymbolCell, useGoSymbol } from "../components/ui";
import { I } from "../components/Icons";

interface Field { field: string; label: string; group: string; type: "num" | "bool" | "str" }
interface Cond { field: string; op: string; value: any }

const COLS: { k: string; l: string; f: (v: any) => React.ReactNode }[] = [
  { k: "change_pct", l: "Change", f: (v) => <Change v={v} /> },
  { k: "perf_1m", l: "1M", f: (v) => <Change v={v} /> },
  { k: "rsi_14", l: "RSI 14", f: (v) => fmtNum(v, 1) },
  { k: "macd_hist", l: "MACD hist", f: (v) => fmtNum(v, 3) },
  { k: "bb_pctb", l: "BB %B", f: (v) => fmtNum(v, 2) },
  { k: "sma50_dist", l: "vs SMA50", f: (v) => fmtPct(v, 1) },
  { k: "volatility_30d", l: "Vol 30d", f: (v) => (v == null ? "—" : `${v.toFixed(1)}%`) },
  { k: "rel_volume", l: "Rel vol", f: (v) => fmtNum(v, 2) },
  { k: "dist_52w_high", l: "From 52W hi", f: (v) => fmtPct(v, 1) },
  { k: "beta", l: "Beta", f: (v) => fmtNum(v, 2) },
];

export function ScreenerPage() {
  const { data: fields } = useApi<Field[]>("/api/analytics/screener/fields");
  const { data: presetData } = useApi<{ count: number; presets: any[] }>("/api/analytics/screener/presets");
  const [presets, setPresets] = useState<string[]>([]);
  const [conds, setConds] = useState<Cond[]>([]);
  const [sort, setSort] = useState("change_pct");
  const [desc, setDesc] = useState(true);
  const [group, setGroup] = useState("Strategies");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const go = useGoSymbol();

  const groups = useMemo(() => [...new Set((presetData?.presets ?? []).map((p) => p.group))], [presetData]);
  const shown = (presetData?.presets ?? []).filter((p) => (q ? p.name.toLowerCase().includes(q.toLowerCase()) : p.group === group));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const valid = conds.filter((c) => c.value !== "" && c.value != null);
    post("/api/analytics/screener", { presets, conditions: valid, sort, desc, limit: 200 })
      .then((r) => { if (alive) { setRes(r); setErr(null); } })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [presets, conds, sort, desc]);

  const togglePreset = (id: string) => setPresets((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const fieldMap = Object.fromEntries((fields ?? []).map((f) => [f.field, f]));
  const addCond = () => setConds([...conds, { field: "rsi_14", op: "lt", value: 30 }]);

  return (
    <>
      <div className="page-head">
        <div><h1>Advanced Screener</h1><p>{presetData?.count ?? "100+"} preset filters and {fields?.length ?? 45} live metrics computed from market data.</p></div>
        {(presets.length > 0 || conds.length > 0) && <button className="btn" onClick={() => { setPresets([]); setConds([]); }}>Clear all</button>}
      </div>
      <div className="grid g-side">
        <div className="col gap-12">
          <Card title="Preset filters">
            <input className="input mb-8" placeholder="Search filters…" value={q} onChange={(e) => setQ(e.target.value)} />
            {!q && <div className="row wrap gap-4 mb-8">{groups.map((g) => <span key={g} className={`chip click ${g === group ? "active" : ""}`} onClick={() => setGroup(g)}>{g}</span>)}</div>}
            <div className="col gap-4" style={{ maxHeight: 360, overflow: "auto" }}>
              {shown.map((p) => (
                <label key={p.id} className="switch small"><input type="checkbox" checked={presets.includes(p.id)} onChange={() => togglePreset(p.id)} />{p.name}</label>
              ))}
            </div>
          </Card>
          <Card title="Custom conditions" actions={<button className="btn xs" onClick={addCond}><I.plus width={12} />Add</button>}>
            {!conds.length && <div className="small muted">Build your own rules on any metric.</div>}
            {conds.map((c, i) => {
              const f = fieldMap[c.field];
              const upd = (patch: Partial<Cond>) => setConds(conds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="col gap-4 mb-8" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                  <div className="row">
                    <select className="input" value={c.field} onChange={(e) => { const nf = fieldMap[e.target.value]; upd({ field: e.target.value, op: nf?.type === "num" ? "gt" : "eq", value: nf?.type === "bool" ? true : nf?.type === "str" ? "" : 0 }); }}>
                      {(fields ?? []).map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                    </select>
                    <button className="btn xs ghost" onClick={() => setConds(conds.filter((_, j) => j !== i))}><I.x width={12} /></button>
                  </div>
                  <div className="row">
                    {f?.type === "num" ? (
                      <>
                        <select className="input" style={{ width: 70 }} value={c.op} onChange={(e) => upd({ op: e.target.value })}>
                          {["gt", "gte", "lt", "lte"].map((o) => <option key={o} value={o}>{{ gt: ">", gte: "≥", lt: "<", lte: "≤" }[o]}</option>)}
                        </select>
                        <input className="input num" type="number" value={c.value} onChange={(e) => upd({ value: e.target.value === "" ? "" : Number(e.target.value) })} />
                      </>
                    ) : f?.type === "bool" ? (
                      <select className="input" value={String(c.value)} onChange={(e) => upd({ op: "eq", value: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select>
                    ) : (
                      <input className="input" value={c.value} placeholder="value" onChange={(e) => upd({ op: "eq", value: e.target.value })} />
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
        <Card pad={false} title={<h2>{res ? `${res.total} of ${res.universe} instruments match` : "Results"}</h2>} actions={
          <div className="row"><select className="input" style={{ height: 28, width: 170 }} value={sort} onChange={(e) => setSort(e.target.value)}>
            {(fields ?? []).filter((f) => f.type === "num").map((f) => <option key={f.field} value={f.field}>Sort: {f.label}</option>)}
          </select><button className="btn xs" onClick={() => setDesc(!desc)}>{desc ? "↓" : "↑"}</button></div>}>
          <div style={{ padding: "8px 0" }}>
            {err && <div className="notice error" style={{ margin: 12 }}>{err}</div>}
            {loading && !res && <div style={{ padding: 12 }}><Skeleton h={300} /></div>}
            {res && !res.results.length && <Empty icon="filter">No instruments match these filters. Try removing one.</Empty>}
            {res?.results.length > 0 && (
              <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
                <table className="tbl">
                  <thead><tr><th>Instrument</th><th className="r">Price</th><th>30d</th>{COLS.map((c) => <th key={c.k} className="r">{c.l}</th>)}<th>Trend</th></tr></thead>
                  <tbody>{res.results.map((r: any) => (
                    <tr key={r.symbol} className="click" onClick={() => go(r.symbol)}>
                      <td><SymbolCell symbol={r.symbol} display={r.display} name={r.sector} /></td>
                      <td className="r num bold">{fmtPrice(r.price)}</td>
                      <td><Sparkline data={r.sparkline} width={70} height={22} /></td>
                      {COLS.map((c) => <td key={c.k} className="r num">{c.f(r[c.k])}</td>)}
                      <td>{r.golden_cross ? <span className="chip up">Up</span> : <span className="chip down">Down</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {res && <div className="tiny faint" style={{ padding: "8px 16px" }}>Dollar volume and other metrics use daily bars; rows refresh every 2 minutes. {fmtCompact(res.universe)} instruments scanned.</div>}
          </div>
        </Card>
      </div>
    </>
  );
}
