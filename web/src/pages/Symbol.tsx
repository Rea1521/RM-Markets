import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { post } from "../api/client";
import { useAccount, useApi, useQuote } from "../lib/hooks";
import { fmtCompact, fmtPct, fmtPrice, timeAgo } from "../lib/format";
import type { NewsItem } from "../lib/types";
import { Card, Skeleton } from "../components/ui";
import { OrderTicket } from "../components/OrderTicket";
import { ChartCard } from "./Dashboard";
import { toast } from "../store/ui";
import { PostCard } from "./Social";

function Signals({ symbol }: { symbol: string }) {
  const { data } = useApi<any>(`/api/market/signals/${symbol}`, { poll: 60000 });
  if (!data) return <Card title="Technical Summary"><Skeleton h={90} /></Card>;
  const color = data.score > 0 ? "up" : data.score < 0 ? "down" : "";
  return (
    <Card title="Technical Summary" actions={<span className={`chip ${color}`} style={{ textTransform: "capitalize" }}>{data.verdict}</span>}>
      <div className="col gap-4 small">{data.notes.map((n: string) => <div key={n}>• {n}</div>)}</div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>Educational summary of RSI, MACD, Bollinger Bands and moving averages on the daily chart.</p>
    </Card>
  );
}

function Prediction({ symbol }: { symbol: string }) {
  const { data, error, loading } = useApi<any>(`/api/analytics/ml/predict/${symbol}`);
  return (
    <Card title="ML Prediction (next bar)" actions={<Link to={`/predictions?symbol=${symbol}`} className="small">Details</Link>}>
      {loading && <Skeleton h={70} />}
      {error && <div className="small muted">{error.message}</div>}
      {data && (
        <div className="col gap-4 small">
          <div className="row between"><span className="muted">Probability up</span><b className={data.prob_up >= 0.5 ? "up" : "down"}>{(data.prob_up * 100).toFixed(1)}%</b></div>
          <div className="bar-h"><div style={{ width: `${data.prob_up * 100}%`, background: data.prob_up >= 0.5 ? "var(--up)" : "var(--down)" }} /></div>
          <div className="row between"><span className="muted">Signal</span><span className="chip" style={{ textTransform: "capitalize" }}>{data.signal}</span></div>
          <div className="row between"><span className="muted">Validation accuracy</span><span>{(data.metrics.accuracy * 100).toFixed(1)}% <span className="faint">vs {(data.metrics.baseline_accuracy * 100).toFixed(1)}% baseline</span></span></div>
        </div>
      )}
    </Card>
  );
}

function AlertForm({ symbol, price }: { symbol: string; price?: number }) {
  const [cond, setCond] = useState<"above" | "below">("above");
  const [val, setVal] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post("/api/trading/alerts", { symbol, condition: cond, price: Number(val) });
      toast({ kind: "success", title: "Price alert created", body: `${symbol} ${cond} ${val}` });
      setVal("");
    } catch (err) { toast({ kind: "error", title: (err as Error).message }); }
  };
  return (
    <form className="row" onSubmit={submit}>
      <select className="input" style={{ width: 90 }} value={cond} onChange={(e) => setCond(e.target.value as any)}><option value="above">Above</option><option value="below">Below</option></select>
      <input className="input num" required inputMode="decimal" placeholder={fmtPrice(price)} value={val} onChange={(e) => setVal(e.target.value)} />
      <button className="btn sm">Alert</button>
    </form>
  );
}

export function SymbolPage() {
  const { symbol = "BTCUSDT" } = useParams();
  const sym = decodeURIComponent(symbol).toUpperCase();
  const q = useQuote(sym);
  const { data: acct, reload } = useAccount();
  const { data: news } = useApi<{ items: NewsItem[] }>("/api/news", { params: { symbol: sym, limit: 8 } });
  const { data: posts } = useApi<any[]>("/api/social/feed", { params: { symbol: sym, limit: 5 } });
  const pos = acct?.positions.find((p) => p.symbol === sym);

  return (
    <>
      <div className="grid g-main">
        <ChartCard symbol={sym} height={420} />
        <div className="col gap-12">
          <Card><OrderTicket symbol={sym} account={acct} onPlaced={() => reload(true)} /></Card>
        </div>
      </div>
      <div className="grid g-4">
        <Card title="Key Stats">
          <dl className="kv small">
            <dt>Open</dt><dd>{fmtPrice(q?.open)}</dd><dt>High</dt><dd>{fmtPrice(q?.high)}</dd><dt>Low</dt><dd>{fmtPrice(q?.low)}</dd>
            <dt>Prev close</dt><dd>{fmtPrice(q?.prev_close)}</dd><dt>Bid / Ask</dt><dd>{fmtPrice(q?.bid)} / {fmtPrice(q?.ask)}</dd>
            <dt>Volume</dt><dd>{fmtCompact(q?.volume)}</dd><dt>Data source</dt><dd>{q?.source}</dd>
            {pos && <><dt>Your position</dt><dd className={pos.unrealized_pnl >= 0 ? "up" : "down"}>{pos.qty} @ {fmtPrice(pos.avg_price)}</dd></>}
          </dl>
          <div className="mt-12"><div className="small muted mb-8">Price alert</div><AlertForm symbol={sym} price={q?.price} /></div>
        </Card>
        <Signals symbol={sym} />
        <Prediction symbol={sym} />
        <Card title="Community" actions={<Link className="small" to="/social">Open feed</Link>} pad={false}>
          {!posts?.length && <div className="empty small">No posts about {q?.display ?? sym} yet. Mention ${q?.display.split("/")[0] ?? sym} in the Social Feed.</div>}
          {posts?.slice(0, 3).map((p) => <PostCard key={p.id} post={p} compact />)}
        </Card>
      </div>
      <Card title={`News: ${q?.display ?? sym}`}>
        {!news && <Skeleton h={120} />}
        {news && !news.items.length && <div className="empty small">No recent headlines found for this instrument.</div>}
        {news?.items.map((n) => (
          <a key={n.id} className="news-item" href={n.url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "none" }}>
            <div className="grow">
              <div className="news-title">{n.title}</div>
              <div className="tiny muted mt-8">{n.source} · {timeAgo(n.published_at)} · <span className={n.sentiment === "bullish" ? "up" : n.sentiment === "bearish" ? "down" : ""}>{n.sentiment}</span></div>
            </div>
            {n.image && <img className="news-thumb" src={n.image} alt="" loading="lazy" />}
          </a>
        ))}
      </Card>
      <p className="tiny faint">Day change {fmtPct(q?.change_pct)} · Quotes stream over WebSocket and reconnect automatically.</p>
    </>
  );
}
