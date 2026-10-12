import { Fragment, useState } from "react";
import { api, post } from "../api/client";
import { API_URL, WS_URL } from "../api/config";
import { useApi } from "../lib/hooks";
import { useAuth } from "../store/auth";
import { useMarket } from "../store/market";
import { toast, useUi } from "../store/ui";
import { Card, ConnPill } from "../components/ui";

export function SettingsPage() {
  const { user, setUser, setSession } = useAuth();
  const { theme, toggleTheme } = useUi();
  const [p, setP] = useState({ display_name: user?.display_name ?? "", title: user?.title ?? "", bio: user?.bio ?? "" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const { data: status } = useApi<any>("/api/market/status");
  const { data: rules } = useApi<any>("/api/trading/rules");
  const { data: health } = useApi<any>("/health");
  const wsStatus = useMarket((s) => s.status);

  const save = async () => {
    try { setUser(await api("/api/auth/me", { method: "PATCH", body: p })); toast({ kind: "success", title: "Profile saved" }); } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const changePw = async () => {
    try { const t = await post("/api/auth/password", pw); setSession({ ...t, user: user! }); setPw({ current_password: "", new_password: "" }); toast({ kind: "success", title: "Password changed", body: "Other sessions were signed out." }); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Profile, security, appearance and system status.</p></div></div>
      <div className="grid g-2">
        <Card title="Profile">
          <div className="col gap-12">
            <label className="field">Display name<input className="input" value={p.display_name} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></label>
            <label className="field">Title<input className="input" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} /></label>
            <label className="field">Bio<textarea className="input" maxLength={280} value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} /></label>
            <button className="btn primary" onClick={save}>Save profile</button>
            {user?.is_demo && <div className="notice warn small">You're using a guest account. Register to keep your portfolio and host competitions.</div>}
          </div>
        </Card>
        <div className="col gap-12">
          <Card title="Appearance">
            <label className="switch"><input type="checkbox" checked={theme === "dark"} onChange={toggleTheme} />Dark mode</label>
          </Card>
          {!user?.is_demo && !user?.oauth_provider && (
            <Card title="Change password">
              <div className="col gap-8">
                <input className="input" type="password" placeholder="Current password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
                <input className="input" type="password" placeholder="New password (8+ chars, letters & numbers)" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
                <button className="btn" onClick={changePw} disabled={pw.new_password.length < 8}>Update password</button>
              </div>
            </Card>
          )}
        </div>
      </div>
      <div className="grid g-2">
        <Card title="System status">
          <dl className="kv small">
            <dt>API</dt><dd>{API_URL || window.location.origin}</dd>
            <dt>WebSocket</dt><dd className="row" style={{ justifyContent: "flex-end" }}><ConnPill /> <span className="faint tiny">{WS_URL}</span></dd>
            <dt>Backend health</dt><dd className={health?.status === "ok" ? "up" : "down"}>{health?.status ?? "…"}</dd>
            <dt>Database</dt><dd>{health ? (health.db ? "connected" : "error") : "…"}</dd>
            <dt>Cache</dt><dd>{health?.cache}</dd>
            <dt>Services</dt><dd>{health?.services?.join(", ")}</dd>
            <dt>Instance</dt><dd>{health?.instance}</dd>
            <dt>Socket state</dt><dd>{wsStatus}</dd>
          </dl>
          <div className="small muted mt-12 mb-8">Market data providers</div>
          {status?.providers.map((pr: any) => {
            const live = status.feed?.providers?.[pr.name] ?? status.feed?.providers?.[pr.name + "_ws"];
            return (
              <div key={pr.name} className="list-row small">
                <span className="status-dot" style={{ background: !pr.enabled ? "var(--faint)" : live?.ok === false ? "var(--down)" : "var(--up)" }} />
                <b style={{ width: 100 }}>{pr.name}</b><span className="grow muted">{pr.assets.join(", ")}{pr.note ? ` (${pr.note})` : ""}</span>
                <span className="chip">{pr.enabled ? (pr.realtime ? "streaming" : "polling") : "add API key"}</span>
              </div>
            );
          })}
          {!!status?.feed?.sim?.length && <div className="notice warn small mt-8">Simulated fallback active for: {status.feed.sim.join(", ")}</div>}
        </Card>
        <Card title="Trading rules">
          {rules && (
            <dl className="kv small">
              {Object.entries(rules.leverage).map(([k, v]) => <Fragment key={k}><dt>Max leverage: {k}</dt><dd>{String(v)}×</dd></Fragment>)}
              <dt>Crypto fee</dt><dd>{(rules.fees.crypto * 100).toFixed(2)}%</dd>
              <dt>Stock commission</dt><dd>${rules.fees.stock_per_share}/share (min ${rules.fees.stock_min})</dd>
              <dt>Short selling</dt><dd>{rules.shortable.join(", ")}</dd>
              <dt>Daily loss limit</dt><dd>{(rules.daily_loss_limit_pct * 100).toFixed(0)}% of start-of-day equity</dd>
              <dt>Margin call</dt><dd>equity &lt; {(rules.maintenance_ratio * 100).toFixed(0)}% of margin used</dd>
              <dt>Order types</dt><dd>{rules.order_types.join(", ")}</dd>
              <dt>Max open orders</dt><dd>{rules.max_open_orders}</dd>
              <dt>Market hours enforced</dt><dd>{rules.enforce_market_hours ? "yes" : "no"}</dd>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}

export function HelpPage() {
  const faq = [
    ["Is any real money involved?", "No. RM Markets is a demo platform. Your balance is virtual and orders never reach a real exchange."],
    ["Where do prices come from?", "Crypto streams live from Binance. Stocks, forex, commodities and indices are polled from Yahoo Finance (and Polygon, Alpha Vantage or Finnhub when API keys are configured). If no source is reachable the app falls back to a clearly labelled simulation."],
    ["How are orders filled?", "Market orders fill at the live ask (buy) or bid (sell) plus a small size-based slippage. Limit, stop, stop-limit and trailing-stop orders rest on the server and fill when the live price crosses your level, even when you're offline."],
    ["What do the indicators mean?", "Moving averages show trend; RSI above 70 / below 30 flags overbought/oversold; MACD crossovers indicate momentum shifts; Bollinger Bands show volatility envelopes two standard deviations around the 20-period average."],
    ["What voice commands work?", "“Buy 2 Apple”, “sell half bitcoin at 70000”, “what's the price of gold”, “show Tesla chart”, “alert me when ethereum goes above 4000”, “close all positions”, “open portfolio”. Trades always ask for confirmation."],
    ["How do competitions work?", "Joining creates a separate account with the competition's starting balance. Switch accounts from the profile menu. Ranking is by percentage return; winners are notified when it ends."],
    ["Why does a backtest look great but walk-forward fails?", "Optimising on the same data you evaluate on over-fits. Walk-forward picks parameters on past data only and tests them on the next unseen window, which is a much more honest estimate."],
  ];
  return (
    <>
      <div className="page-head"><div><h1>Help &amp; Support</h1><p>How RM Markets works.</p></div></div>
      <Card>
        {faq.map(([q, a]) => <details key={q} className="list-row" style={{ display: "block" }}><summary className="bold" style={{ cursor: "pointer" }}>{q}</summary><p className="small muted">{a}</p></details>)}
      </Card>
    </>
  );
}
