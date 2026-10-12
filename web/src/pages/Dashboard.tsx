import { useEffect, useMemo, useState } from "react";
import { useApi, useAccount, useQuote, useQuotes } from "../lib/hooks";
import { fmtPct, fmtPrice, fmtSignedUsd, fmtUsd, pnlClass } from "../lib/format";
import type { AccountSummary, Quote } from "../lib/types";
import { Card, Change, Donut, LivePrice, PALETTE, Skeleton, Sparkline, SymbolIcon, useGoSymbol } from "../components/ui";
import { CandleChart, INDICATOR_LABELS, INTERVALS, type IndicatorKey } from "../components/charts";
import { OrderTicket } from "../components/OrderTicket";
import { PositionsTable, livePosition } from "../components/tables";
import { I } from "../components/Icons";

const CLASS_LABEL: Record<string, string> = { stock: "Stocks", crypto: "Crypto", forex: "Forex", index: "Indices", commodity: "Commodities", options: "Options", cash: "Cash" };

export function useLiveEquity(acct: AccountSummary | null) {
  const quotes = useQuotes(acct?.positions.map((p) => p.symbol) ?? []);
  return useMemo(() => {
    if (!acct) return null;
    let mv = 0;
    for (const p of acct.positions) {
      const q = quotes[p.symbol];
      mv += livePosition(p, q?.price, q?.bid, q?.ask).market_value;
    }
    const equity = acct.cash + mv + acct.options_value;
    const base = acct.starting_balance + acct.net_deposits;
    const dayStart = acct.equity - acct.day_pnl;
    return { equity, total: equity - base, totalPct: base ? (equity / base - 1) * 100 : 0, day: equity - dayStart, dayPct: dayStart ? (equity / dayStart - 1) * 100 : 0 };
  }, [acct, quotes]);
}

export function StatCards({ acct }: { acct: AccountSummary | null }) {
  const live = useLiveEquity(acct);
  if (!acct || !live) return <div className="grid g-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={62} />)}</div>;
  const cards = [
    { icon: <I.wallet width={18} />, label: "Virtual Balance", value: fmtUsd(live.equity) },
    { label: "Total P&L", value: fmtSignedUsd(live.total), cls: pnlClass(live.total), sub: fmtPct(live.totalPct) },
    { label: "Day's P&L", value: fmtSignedUsd(live.day), cls: pnlClass(live.day), sub: fmtPct(live.dayPct) },
    { label: "Buying Power", value: fmtUsd(acct.buying_power) },
    { label: "Win Rate", value: `${(acct.win_rate ?? 0).toFixed(2)}%`, sub2: `${acct.closed_trades ?? 0} closed trades` },
  ];
  return (
    <div className="grid g-5">
      {cards.map((c) => (
        <div key={c.label} className="card stat">
          {c.icon && <div className="stat-icon">{c.icon}</div>}
          <div className="grow">
            <div className="stat-label">{c.label}</div>
            <div className="row between">
              <div className={`stat-value num ${c.cls ?? ""}`}>{c.value}</div>
              {c.sub && <span className={`stat-sub num ${c.cls ?? ""}`}>{c.sub}</span>}
            </div>
            {c.sub2 && <div className="tiny faint">{c.sub2}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ symbol, onSymbol, symbols, height = 300 }: { symbol: string; onSymbol?: (s: string) => void; symbols?: Quote[]; height?: number }) {
  const q = useQuote(symbol);
  const [interval, setInterval] = useState(() => { try { return localStorage.getItem("rm.interval") || "1D"; } catch { return "1D"; } });
  const [inds, setInds] = useState<Set<IndicatorKey>>(() => {
    try { const s = localStorage.getItem("rm.indicators"); if (s) return new Set(JSON.parse(s)); } catch { /* ignore */ }
    return new Set<IndicatorKey>(["ma20", "ma50", "volume", "rsi"]);
  });
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState(false);
  useEffect(() => { try { localStorage.setItem("rm.interval", interval); localStorage.setItem("rm.indicators", JSON.stringify([...inds])); } catch { /* ignore */ } }, [interval, inds]);
  const toggle = (k: IndicatorKey) => setInds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="card">
      <div className="chart-toolbar">
        <div className="dropdown">
          <button className="row btn ghost" style={{ padding: "0 6px" }} onClick={() => onSymbol && setPick(!pick)}>
            <SymbolIcon symbol={symbol} display={q?.display} size={22} /><b>{q?.display ?? symbol}</b>{onSymbol && <I.chevron width={14} />}
          </button>
          {pick && symbols && (
            <div className="dropdown-menu" style={{ left: 0, right: "auto", maxHeight: 320, overflow: "auto" }}>
              {symbols.map((s) => <button key={s.symbol} onClick={() => { onSymbol?.(s.symbol); setPick(false); }}><SymbolIcon symbol={s.symbol} display={s.display} size={18} />{s.display}</button>)}
            </div>
          )}
        </div>
        <LivePrice symbol={symbol} price={q?.price} className="chart-price" />
        <Change v={q?.change_pct} className="bold" />
        <div className="grow" />
        <div className="seg blue">
          {INTERVALS.map((iv) => <button key={iv} className={iv === interval ? "active" : ""} onClick={() => setInterval(iv)}>{iv}</button>)}
        </div>
        <div className="dropdown">
          <button className="btn sm ghost" onClick={() => setMenu(!menu)}><I.analytics width={14} />Indicators<I.chevron width={12} /></button>
          {menu && (
            <div className="dropdown-menu" onMouseLeave={() => setMenu(false)}>
              {(Object.keys(INDICATOR_LABELS) as IndicatorKey[]).map((k) => (
                <label key={k}><input type="checkbox" checked={inds.has(k)} onChange={() => toggle(k)} />{INDICATOR_LABELS[k]}</label>
              ))}
            </div>
          )}
        </div>
      </div>
      <CandleChart symbol={symbol} interval={interval} indicators={inds} height={height} />
    </div>
  );
}

export function MarketMovers() {
  const { data } = useApi<{ gainers: Quote[]; losers: Quote[]; most_active: Quote[] }>("/api/market/movers", { params: { limit: 5 }, poll: 30000 });
  const [tab, setTab] = useState<"gainers" | "losers" | "most_active">("gainers");
  const rows = data?.[tab] ?? [];
  const live = useQuotes(rows.map((r) => r.symbol));
  const go = useGoSymbol();
  return (
    <Card title="Market Movers" actions={
      <select className="input" style={{ height: 26, width: 112, fontSize: 11.5 }} value={tab} onChange={(e) => setTab(e.target.value as any)}>
        <option value="gainers">Top gainers</option><option value="losers">Top losers</option><option value="most_active">Most active</option>
      </select>}>
      {!data && <Skeleton h={180} />}
      {rows.map((r) => {
        const q = live[r.symbol] ?? r;
        return (
          <div key={r.symbol} className="list-row click" onClick={() => go(r.symbol)}>
            <SymbolIcon symbol={r.symbol} display={r.display} />
            <div className="grow col" style={{ gap: 0 }}><b>{r.display}</b><span className="tiny faint truncate">{r.name}</span></div>
            <span className="num">{fmtPrice(q.price)}</span>
            <Change v={q.change_pct} className="small bold" />
          </div>
        );
      })}
    </Card>
  );
}

export function PortfolioOverview({ acct }: { acct: AccountSummary | null }) {
  const live = useLiveEquity(acct);
  const { data: perf } = useApi<any>("/api/analytics/performance", { poll: 60000, deps: [acct?.account_id] });
  if (!acct || !live) return <Card title="Portfolio Overview"><Skeleton h={140} /></Card>;
  const items = acct.allocation.map((a, i) => ({ label: CLASS_LABEL[a.asset_class] ?? a.asset_class, value: a.value, pct: a.pct, color: PALETTE[i % PALETTE.length] }));
  const curve = (perf?.equity_curve ?? []).map((p: any) => p.equity);
  return (
    <Card title="Portfolio Overview">
      <div className="col" style={{ gap: 2 }}>
        <span className="muted small">Total Value</span>
        <div className="row" style={{ alignItems: "baseline" }}>
          <span className="stat-value num" style={{ fontSize: 20 }}>{fmtUsd(live.equity)}</span>
          <span className={`small bold ${pnlClass(live.totalPct)}`}>{fmtPct(live.totalPct)}</span>
        </div>
      </div>
      <div className="row gap-12 mt-8" style={{ alignItems: "center" }}>
        <div className="grow" style={{ minWidth: 60 }}><Sparkline data={curve.length > 1 ? curve : [acct.starting_balance, live.equity]} width={120} height={60} /></div>
        <Donut items={items} size={92} thickness={13} />
        <div className="col" style={{ gap: 4, minWidth: 104 }}>
          {items.map((it) => (
            <div key={it.label} className="row tiny" style={{ gap: 6 }}>
              <span className="legend-dot" style={{ background: it.color }} /><span className="grow">{it.label}</span><span className="num muted">{it.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { data: acct, reload } = useAccount();
  const { data: watch } = useApi<Quote[]>("/api/trading/watchlist");
  const [symbol, setSymbol] = useState(() => { try { return localStorage.getItem("rm.symbol") || "BTCUSDT"; } catch { return "BTCUSDT"; } });
  useEffect(() => { try { localStorage.setItem("rm.symbol", symbol); } catch { /* ignore */ } }, [symbol]);
  const positions = acct?.positions ?? [];

  return (
    <>
      <StatCards acct={acct} />
      <div className="grid g-main">
        <ChartCard symbol={symbol} onSymbol={setSymbol} symbols={watch ?? undefined} />
        <Card><OrderTicket symbol={symbol} account={acct} onPlaced={() => reload(true)} /></Card>
      </div>
      <div className="grid g-bottom">
        <PortfolioOverview acct={acct} />
        <Card title={`Positions (${positions.length})`} pad={false}>
          <div style={{ padding: "6px 6px 8px" }}><PositionsTable positions={positions} compact onChanged={() => reload(true)} /></div>
        </Card>
        <MarketMovers />
      </div>
    </>
  );
}
