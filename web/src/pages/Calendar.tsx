import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { Card, Empty, Seg, Skeleton } from "../components/ui";

interface Ev {
  id: string; title: string; country: string; time: number; impact: string; forecast: string | null; previous: string | null; actual: string | null;
  source: string; symbols: string[]; related_news: { title: string; url: string; source: string }[];
}

export function CalendarPage() {
  const [impact, setImpact] = useState("all");
  const [country, setCountry] = useState("all");
  const { data, loading, error } = useApi<{ events: Ev[]; errors: Record<string, string> }>("/api/calendar", { params: { impact: impact === "all" ? undefined : impact }, poll: 600000 });
  const countries = useMemo(() => [...new Set((data?.events ?? []).map((e) => e.country))].sort(), [data]);
  const events = (data?.events ?? []).filter((e) => country === "all" || e.country === country);
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) {
      const k = new Date(e.time * 1000).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [events]);
  const now = Date.now() / 1000;
  return (
    <>
      <div className="page-head">
        <div><h1>Economic Calendar</h1><p>This week's macro events with related headlines and the instruments they tend to move. Times shown in your local timezone.</p></div>
        <div className="row wrap">
          <Seg value={impact} onChange={setImpact} options={[{ value: "all", label: "All" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
          <select className="input" style={{ width: 110 }} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">All countries</option>{countries.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {error && <div className="notice error">{error.message}</div>}
      {loading && !data && <Skeleton h={400} />}
      {data && !events.length && <Card><Empty icon="calendar">No events available.{Object.keys(data.errors).length > 0 && ` Calendar sources unreachable: ${Object.keys(data.errors).join(", ")}.`}</Empty></Card>}
      {byDay.map(([day, evs]) => (
        <Card key={day} title={day} pad={false}>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th style={{ width: 70 }}>Time</th><th style={{ width: 60 }}>Ccy</th><th style={{ width: 30 }} /><th>Event</th><th className="r">Actual</th><th className="r">Forecast</th><th className="r">Previous</th><th>Related</th></tr></thead>
              <tbody>
                {evs.map((e) => (
                  <tr key={e.id} style={{ opacity: e.time < now - 3600 ? 0.65 : 1 }}>
                    <td className="num">{new Date(e.time * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td><b>{e.country}</b></td>
                    <td><span className={`impact ${e.impact}`} title={`${e.impact} impact`} /></td>
                    <td style={{ whiteSpace: "normal" }}>
                      <div className="bold">{e.title}</div>
                      {e.related_news.map((n) => <a key={n.url} className="tiny" href={n.url} target="_blank" rel="noreferrer noopener" style={{ display: "block" }}>↳ {n.title} <span className="faint">({n.source})</span></a>)}
                    </td>
                    <td className="r num bold">{e.actual ?? "—"}</td><td className="r num">{e.forecast ?? "—"}</td><td className="r num muted">{e.previous ?? "—"}</td>
                    <td><div className="row wrap gap-4">{e.symbols.map((s) => <Link key={s} className="chip blue" to={`/market/${s}`}>{s}</Link>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}
