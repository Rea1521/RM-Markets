import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { get, post } from "../api/client";
import { useApi, useDebounced } from "../lib/hooks";
import { timeAgo } from "../lib/format";
import { useAuth } from "../store/auth";
import { onPrivateEvent } from "../store/market";
import { toast, useUi } from "../store/ui";
import { I, type IconName } from "./Icons";
import { ConnPill, SymbolIcon, Toasts } from "./ui";
import { VoiceButton } from "./Voice";

const NAV: ({ to: string; label: string; icon: IconName } | { section: string })[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/market", label: "Market", icon: "market" },
  { to: "/watchlist", label: "Watchlist", icon: "star" },
  { to: "/portfolio", label: "Portfolio", icon: "briefcase" },
  { to: "/orders", label: "Orders", icon: "orders" },
  { to: "/positions", label: "Positions", icon: "layers" },
  { to: "/analytics", label: "Analytics", icon: "analytics" },
  { to: "/screener", label: "Screener", icon: "filter" },
  { to: "/news", label: "News", icon: "news" },
  { to: "/calendar", label: "Calendar", icon: "calendar" },
  { to: "/social", label: "Social Feed", icon: "social" },
  { section: "Tools" },
  { to: "/options", label: "Options Simulator", icon: "sigma" },
  { to: "/backtester", label: "Strategy Backtester", icon: "flask" },
  { to: "/stress-test", label: "Stress Test", icon: "shield" },
  { to: "/predictions", label: "ML Predictions", icon: "brain" },
  { to: "/journal", label: "Trading Journal", icon: "book" },
  { to: "/competitions", label: "Competitions", icon: "trophy" },
  { section: "" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

function Sidebar() {
  const { sidebarOpen, setSidebar } = useUi();
  const loc = useLocation();
  useEffect(() => setSidebar(false), [loc.pathname, setSidebar]);
  return (
    <>
      <div className={`scrim ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebar(false)} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark">RM</span> RM Markets</div>
        <nav className="nav">
          {NAV.map((n, i) => {
            if ("section" in n) return n.section ? <div key={i} className="nav-section">{n.section}</div> : <div key={i} style={{ height: 8 }} />;
            const Ico = I[n.icon];
            return <NavLink key={n.to} to={n.to} end={n.to === "/"}><Ico />{n.label}</NavLink>;
          })}
        </nav>
        <div className="sidebar-foot nav">
          <NavLink to="/help"><I.help />Help &amp; Support</NavLink>
        </div>
      </aside>
    </>
  );
}

function SearchBox() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 150);
  const nav = useNavigate();
  useEffect(() => {
    if (!dq.trim()) { setResults([]); return; }
    get("/api/market/search", { q: dq.trim() }).then(setResults).catch(() => setResults([]));
  }, [dq]);
  const go = (s: string) => { nav(`/market/${s}`); setQ(""); setOpen(false); };
  return (
    <div className="search">
      <I.search />
      <input className="input" placeholder="Search markets, stocks, news…" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter") { if (results[active]) go(results[active].symbol); else if (q.trim()) { nav(`/news?q=${encodeURIComponent(q)}`); setOpen(false); } }
        }} />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={r.symbol} className={i === active ? "active" : ""} onMouseDown={() => go(r.symbol)}>
              <SymbolIcon symbol={r.symbol} display={r.display} />
              <div className="grow"><div className="bold">{r.display}</div><div className="tiny muted">{r.name}</div></div>
              <span className="chip">{r.asset_class}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<{ unread: number; items: any[] }>("/api/trading/notifications", { poll: 30000 });
  useEffect(() => onPrivateEvent(() => reload(true)), [reload]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = async () => {
    setOpen(!open);
    if (!open && data?.unread) { await post("/api/trading/notifications/read"); reload(true); }
  };
  return (
    <div className="dropdown" ref={ref}>
      <button className="icon-btn" onClick={toggle} aria-label="Notifications"><I.bell />{!!data?.unread && <span className="badge-dot">{data.unread > 9 ? "9+" : data.unread}</span>}</button>
      {open && (
        <div className="dropdown-menu" style={{ width: 340, maxHeight: 420, overflow: "auto" }}>
          <div className="row between" style={{ padding: "4px 8px 8px" }}><b>Notifications</b></div>
          {!data?.items.length && <div className="empty">No notifications yet. Order fills and price alerts show up here.</div>}
          {data?.items.map((n) => (
            <div key={n.id} style={{ padding: "8px", borderTop: "1px solid var(--border)" }}>
              <div className="row between"><b className="small">{n.title}</b><span className="tiny faint">{timeAgo(n.created_at)}</span></div>
              {n.body && <div className="small muted">{n.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { accountId, setAccountId } = useUi();
  const [open, setOpen] = useState(false);
  const { data: accounts } = useApi<any[]>(open ? "/api/trading/accounts" : null);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!user) return null;
  const initials = user.display_name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="dropdown" ref={ref}>
      <button className="user-chip" onClick={() => setOpen(!open)}>
        <span className="avatar">{initials}</span>
        <span className="col hide-sm" style={{ gap: 0 }}><b className="small">{user.display_name}</b><span className="tiny muted">{accountId ? "Competition account" : user.title}</span></span>
        <I.chevron width={14} className="hide-sm" />
      </button>
      {open && (
        <div className="dropdown-menu" style={{ width: 260 }}>
          <div className="tiny muted" style={{ padding: "4px 8px" }}>Trading account</div>
          {(accounts ?? []).map((a) => (
            <button key={a.id} onClick={() => { setAccountId(a.competition_id ? a.id : null); setOpen(false); toast({ kind: "info", title: `Switched to ${a.name}` }); }}>
              {((a.competition_id ? a.id : null) === accountId) ? <I.check width={14} /> : <span style={{ width: 14 }} />}
              <span className="grow truncate">{a.competition_id ? `🏆 ${a.name}` : "Main account"}</span>
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }} />
          <button onClick={() => { nav(`/u/${user.username}`); setOpen(false); }}><I.social width={14} />My public profile</button>
          <button onClick={() => { nav("/settings"); setOpen(false); }}><I.settings width={14} />Settings</button>
          <button onClick={async () => { try { await post("/api/auth/logout"); } catch { /* ignore */ } logout(); nav("/login"); }}><I.logout width={14} />Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { theme, toggleTheme, setSidebar } = useUi();
  useEffect(() => onPrivateEvent((m) => {
    toast({ kind: m.type === "order_rejected" || m.type === "margin_call" ? "error" : "success", title: m.title, body: m.body });
  }), []);
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebar(true)} aria-label="Menu"><I.menu /></button>
          <SearchBox />
          <div className="grow" />
          <span className="hide-sm"><ConnPill /></span>
          <VoiceButton />
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{theme === "dark" ? <I.moon /> : <I.sun />}</button>
          <Notifications />
          <UserMenu />
        </header>
        <main className="content"><Outlet /></main>
      </div>
      <Toasts />
    </div>
  );
}
