import { Fragment, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, post, del } from "../api/client";
import { useApi } from "../lib/hooks";
import { fmtPct, timeAgo } from "../lib/format";
import { useAuth } from "../store/auth";
import { toast } from "../store/ui";
import { Card, Empty, Seg, Skeleton } from "../components/ui";
import { I } from "../components/Icons";

function Body({ text }: { text: string }) {
  const nav = useNavigate();
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9/]{0,9})/g);
  return (
    <div className="post-body">
      {parts.map((p, i) => p.startsWith("$") ? <span key={i} className="cashtag" onClick={() => nav(`/market/${p.slice(1)}`)}>{p}</span> : <Fragment key={i}>{p}</Fragment>)}
    </div>
  );
}

export function PostCard({ post: p0, compact = false, onDeleted }: { post: any; compact?: boolean; onDeleted?: () => void }) {
  const [p, setP] = useState(p0);
  const [comments, setComments] = useState<any[] | null>(null);
  const [reply, setReply] = useState("");
  const me = useAuth((s) => s.user);
  const like = async () => {
    try { const r = await post(`/api/social/posts/${p.id}/like`); setP({ ...p, liked: r.liked, likes: r.likes }); } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const loadComments = async () => setComments(comments ? null : await get(`/api/social/posts/${p.id}/comments`));
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    const c = await post(`/api/social/posts/${p.id}/comments`, { body: reply });
    setComments([...(comments ?? []), c]); setReply(""); setP({ ...p, comments: p.comments + 1 });
  };
  const initials = p.author.display_name.slice(0, 2).toUpperCase();
  return (
    <div className="post" style={compact ? { padding: "10px 16px" } : undefined}>
      <div className="row">
        <span className="avatar" style={{ width: 28, height: 28, fontSize: 10 }}>{initials}</span>
        <Link to={`/u/${p.author.username}`} className="bold" style={{ color: "var(--text)" }}>{p.author.display_name}</Link>
        <span className="tiny faint">@{p.author.username} · {timeAgo(p.created_at)}</span>
        <div className="grow" />
        {p.sentiment !== "neutral" && <span className={`chip ${p.sentiment === "bullish" ? "up" : "down"}`}>{p.sentiment}</span>}
      </div>
      <Body text={compact && p.body.length > 160 ? p.body.slice(0, 160) + "…" : p.body} />
      {!compact && (
        <>
          <div className="row small muted">
            <button className="btn xs ghost" onClick={like}><I.heart width={14} style={{ fill: p.liked ? "var(--down)" : "none", color: p.liked ? "var(--down)" : undefined }} />{p.likes}</button>
            <button className="btn xs ghost" onClick={loadComments}><I.comment width={14} />{p.comments}</button>
            {me?.id === p.author.id && <button className="btn xs ghost danger" onClick={async () => { await del(`/api/social/posts/${p.id}`); onDeleted?.(); }}><I.trash width={13} /></button>}
          </div>
          {comments && (
            <div className="col gap-4 mt-8" style={{ paddingLeft: 36 }}>
              {comments.map((c) => <div key={c.id} className="small"><b>{c.author.display_name}</b> <span className="faint tiny">{timeAgo(c.created_at)}</span><div>{c.body}</div></div>)}
              <form className="row" onSubmit={send}><input className="input" style={{ height: 30 }} placeholder="Write a reply…" maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)} /><button className="btn sm">Reply</button></form>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SocialPage() {
  const [scope, setScope] = useState<"all" | "following" | "mine">("all");
  const { data: feed, reload, loading } = useApi<any[]>("/api/social/feed", { params: { scope, limit: 50 }, poll: 30000 });
  const { data: trending } = useApi<any[]>("/api/social/trending");
  const { data: leaders } = useApi<any[]>("/api/social/leaderboard", { params: { limit: 10 } });
  const [body, setBody] = useState("");
  const [sentiment, setSentiment] = useState<"neutral" | "bullish" | "bearish">("neutral");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await post("/api/social/posts", { body, sentiment }); setBody(""); setSentiment("neutral"); reload(true); }
    catch (err) { toast({ kind: "error", title: (err as Error).message }); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Social Feed</h1><p>Share trade ideas. Mention instruments with cashtags like $BTC or $AAPL.</p></div><Seg value={scope} onChange={setScope} options={[{ value: "all", label: "Everyone" }, { value: "following", label: "Following" }, { value: "mine", label: "My posts" }]} /></div>
      <div className="grid g-main">
        <div className="col gap-12">
          <Card>
            <form className="col gap-8" onSubmit={submit}>
              <textarea className="input" maxLength={1000} placeholder="What's your trade idea? e.g. $ETH reclaiming the 50-day MA, watching 3,800" value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="row between">
                <Seg value={sentiment} onChange={setSentiment} options={[{ value: "neutral", label: "Neutral" }, { value: "bullish", label: "Bullish" }, { value: "bearish", label: "Bearish" }]} />
                <div className="row"><span className="tiny faint">{body.length}/1000</span><button className="btn primary" disabled={!body.trim()}>Post</button></div>
              </div>
            </form>
          </Card>
          <Card pad={false}>
            {loading && !feed && <div style={{ padding: 16 }}><Skeleton h={200} /></div>}
            {feed && !feed.length && <Empty icon="social">No posts yet. Be the first to share an idea!</Empty>}
            {feed?.map((p) => <PostCard key={p.id} post={p} onDeleted={() => reload(true)} />)}
          </Card>
        </div>
        <div className="col gap-12">
          <Card title="Trending (24h)">
            {!trending?.length && <div className="small muted">No cashtags mentioned in the last 24 hours.</div>}
            {trending?.map((t) => (
              <div key={t.symbol} className="list-row"><Link to={`/market/${t.symbol}`} className="bold grow">${t.symbol}</Link><span className="tiny muted">{t.mentions} posts</span>
                <span className="chip up">{t.bullish}↑</span><span className="chip down">{t.bearish}↓</span></div>
            ))}
          </Card>
          <Card title="Top Traders">
            {leaders?.map((l) => (
              <div key={l.user.id} className="list-row"><span className="muted" style={{ width: 20 }}>{l.rank}</span><Link to={`/u/${l.user.username}`} className="grow truncate">{l.user.display_name}</Link><b className={l.return_pct >= 0 ? "up" : "down"}>{fmtPct(l.return_pct)}</b></div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}

export function ProfilePage() {
  const { username = "" } = useParams();
  const { data, reload, error } = useApi<any>(`/api/social/users/${username}`);
  const me = useAuth((s) => s.user);
  if (error) return <div className="notice error">{error.message}</div>;
  if (!data) return <Skeleton h={300} />;
  return (
    <>
      <Card>
        <div className="row gap-16">
          <span className="avatar" style={{ width: 56, height: 56, fontSize: 18 }}>{data.display_name.slice(0, 2).toUpperCase()}</span>
          <div className="grow">
            <h1>{data.display_name}</h1>
            <div className="muted small">@{data.username} · {data.title} · joined {timeAgo(data.created_at)}</div>
            {data.bio && <p className="small">{data.bio}</p>}
            <div className="row small mt-8"><b>{data.followers}</b> followers <b>{data.following}</b> following · Return <b className={data.return_pct >= 0 ? "up" : "down"}>{fmtPct(data.return_pct)}</b></div>
          </div>
          {me?.username !== data.username && (
            <button className={`btn ${data.is_following ? "" : "primary"}`} onClick={async () => { await post(`/api/social/users/${data.username}/follow`); reload(true); }}>
              {data.is_following ? "Following" : "Follow"}
            </button>
          )}
        </div>
      </Card>
      <Card title="Posts" pad={false}>
        {!data.posts.length && <Empty icon="social">No posts yet.</Empty>}
        {data.posts.map((p: any) => <PostCard key={p.id} post={p} />)}
      </Card>
    </>
  );
}
