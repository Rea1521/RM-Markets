import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useApi, useDebounced } from "../lib/hooks";
import { fmtDate, timeAgo } from "../lib/format";
import type { NewsItem } from "../lib/types";
import { Card, Empty, Seg, Skeleton } from "../components/ui";

export function SourceStatus({ sources }: { sources?: Record<string, { ok: boolean; error?: string; items?: number }> }) {
  if (!sources) return null;
  const ok = Object.values(sources).filter((s) => s.ok).length;
  const failed = Object.entries(sources).filter(([, s]) => !s.ok);
  return (
    <span className="tiny muted" title={failed.map(([k, s]) => `${k}: ${s.error}`).join("\n")}>
      {ok}/{Object.keys(sources).length} sources reachable
    </span>
  );
}

export function NewsPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [cat, setCat] = useState("all");
  const [sent, setSent] = useState("all");
  const dq = useDebounced(q, 350);
  const { data, loading, error } = useApi<{ items: NewsItem[]; sources: any }>("/api/news", { params: { q: dq || undefined, category: cat === "all" ? undefined : cat, limit: 100 }, poll: 300000 });
  const items = (data?.items ?? []).filter((n) => sent === "all" || n.sentiment === sent);
  return (
    <>
      <div className="page-head">
        <div><h1>Market News</h1><p>Aggregated headlines from financial and crypto news sources, tagged by instrument and sentiment. <SourceStatus sources={data?.sources} /></p></div>
        <div className="row wrap">
          <input className="input" style={{ width: 220 }} placeholder="Search headlines…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Seg value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, { value: "stock", label: "Stocks" }, { value: "crypto", label: "Crypto" }, { value: "forex", label: "Forex" }, { value: "commodity", label: "Commodities" }]} />
          <Seg value={sent} onChange={setSent} options={[{ value: "all", label: "Any" }, { value: "bullish", label: "Bullish" }, { value: "bearish", label: "Bearish" }]} />
        </div>
      </div>
      <Card>
        {error && <div className="notice error">{error.message}</div>}
        {loading && !data && <Skeleton h={400} />}
        {data && !items.length && (
          <Empty icon="news">
            No headlines right now.{data.sources && Object.values(data.sources).every((s: any) => !s.ok) && " The news sources could not be reached from the server. Check outbound network access or add FINNHUB_API_KEY / NEWSAPI_KEY."}
          </Empty>
        )}
        {items.map((n) => (
          <div key={n.id} className="news-item">
            <div className="grow col" style={{ gap: 4 }}>
              <a className="news-title" href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a>
              {n.summary && <div className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.summary}</div>}
              <div className="row wrap tiny">
                <span className="muted">{n.source}</span><span className="faint" title={fmtDate(n.published_at)}>{timeAgo(n.published_at)}</span>
                <span className={`chip ${n.sentiment === "bullish" ? "up" : n.sentiment === "bearish" ? "down" : ""}`}>{n.sentiment}</span>
                {n.symbols.map((s) => <Link key={s} to={`/market/${s}`} className="chip blue">{s}</Link>)}
              </div>
            </div>
            {n.image && <img className="news-thumb" src={n.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />}
          </div>
        ))}
      </Card>
    </>
  );
}
