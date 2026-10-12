import { useState } from "react";
import { del, post } from "../api/client";
import { useAccount, useApi, useQuotes } from "../lib/hooks";
import { fmtDate, fmtPct, fmtPrice, fmtQty, fmtSignedUsd, fmtUsd, pnlClass, timeAgo } from "../lib/format";
import type { Order, Quote, Trade } from "../lib/types";
import { Card, Change, Donut, Empty, LivePrice, Modal, PALETTE, Seg, Skeleton, SymbolCell, useGoSymbol } from "../components/ui";
import { LineChart } from "../components/charts";
import { PositionsTable } from "../components/tables";
import { I } from "../components/Icons";
import { toast, useUi } from "../store/ui";
import { StatCards } from "./Dashboard";

// ------------------------------------------------------------------ Watchlist
export function WatchlistPage() {
  const { data, reload, loading } = useApi<Quote[]>("/api/trading/watchlist");
  const { data: alerts, reload: reloadAlerts } = useApi<any[]>("/api/trading/alerts");
  const live = useQuotes((data ?? []).map((q) => q.symbol));
  const [add, setAdd] = useState("");
  const go = useGoSymbol();
  const addSym = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await post("/api/trading/watchlist", { symbol: add }); setAdd(""); reload(true); } catch (err) { toast({ kind: "error", title: (err as Error).message }); }
  };
  return (
    <>
      <div className="page-head">
        <div><h1>Watchlist</h1><p>Your instruments with live prices and price alerts.</p></div>
        <form className="row" onSubmit={addSym}><input className="input" style={{ width: 200 }} placeholder="Add symbol (e.g. NVDA, SOL)" value={add} onChange={(e) => setAdd(e.target.value)} /><button className="btn primary"><I.plus width={14} />Add</button></form>
      </div>
      <div className="grid g-main">
        <Card pad={false}>
          {loading && !data ? <div style={{ padding: 16 }}><Skeleton h={200} /></div> : !data?.length ? <Empty icon="star">Your watchlist is empty.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Instrument</th><th className="r">Price</th><th className="r">Change</th><th className="r">High</th><th className="r">Low</th><th /></tr></thead>
              <tbody>
                {data.map((r) => {
                  const q = live[r.symbol] ?? r;
                  return (
                    <tr key={r.symbol} className="click" onClick={() => go(r.symbol)}>
                      <td><SymbolCell q={q} symbol={q.symbol} /></td>
                      <td className="r bold"><LivePrice symbol={q.symbol} price={q.price} /></td>
                      <td className="r"><Change v={q.change_pct} /></td>
                      <td className="r num">{fmtPrice(q.high)}</td><td className="r num">{fmtPrice(q.low)}</td>
                      <td className="r" onClick={(e) => e.stopPropagation()}><button className="btn xs ghost" onClick={async () => { await del(`/api/trading/watchlist/${q.symbol}`); reload(true); }}><I.trash width={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Price Alerts">
          {!alerts?.length && <div className="small muted">Create alerts from any instrument page, or say “alert me when bitcoin goes above 70000”.</div>}
          {alerts?.map((a) => (
            <div key={a.id} className="list-row">
              <div className="grow"><b>{a.symbol}</b> <span className="muted">{a.condition}</span> <span className="num">{fmtPrice(a.price)}</span>
                <div className="tiny faint">{a.active ? `created ${timeAgo(a.created_at)}` : `triggered ${timeAgo(a.triggered_at)}`}</div></div>
              <span className={`chip ${a.active ? "blue" : "up"}`}>{a.active ? "Active" : "Triggered"}</span>
              <button className="btn xs ghost" onClick={async () => { await del(`/api/trading/alerts/${a.id}`); reloadAlerts(true); }}><I.x width={12} /></button>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Portfolio
export function PortfolioPage() {
  const { data: acct, reload } = useAccount();
  const accountId = useUi((s) => s.accountId);
  const { data: perf } = useApi<any>("/api/analytics/performance", { params: { account_id: accountId ?? undefined }, poll: 60000 });
  const { data: history, reload: reloadHist } = useApi<any[]>("/api/trading/history", { params: { account_id: accountId ?? undefined, limit: 30 } });
  const [modal, setModal] = useState<null | "deposit" | "withdraw" | "reset">(null);
  const [amount, setAmount] = useState("10000");

  const act = async () => {
    try {
      if (modal === "reset") await post("/api/trading/account/reset", { starting_balance: Number(amount) });
      else await post(`/api/trading/account/${modal}`, { amount: Number(amount), account_id: accountId ?? undefined });
      toast({ kind: "success", title: modal === "reset" ? "Account reset" : `${modal === "deposit" ? "Deposited" : "Withdrew"} ${fmtUsd(Number(amount))}` });
      setModal(null); reload(true); reloadHist(true);
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const items = (acct?.allocation ?? []).map((a, i) => ({ label: a.asset_class, value: a.value, pct: a.pct, color: PALETTE[i % PALETTE.length] }));

  return (
    <>
      <div className="page-head">
        <div><h1>Portfolio</h1><p>{acct?.competition_id ? "Competition account" : "Main virtual account"} · started with {fmtUsd(acct?.starting_balance)}</p></div>
        {!acct?.competition_id && (
          <div className="row wrap">
            <button className="btn" onClick={() => { setAmount("10000"); setModal("deposit"); }}><I.deposit width={15} />Deposit</button>
            <button className="btn" onClick={() => { setAmount("1000"); setModal("withdraw"); }}><I.withdraw width={15} />Withdraw</button>
            <button className="btn danger" onClick={() => { setAmount("100000"); setModal("reset"); }}><I.refresh width={15} />Reset</button>
          </div>
        )}
      </div>
      <StatCards acct={acct} />
      <div className="grid g-main">
        <Card title="Equity Curve">
          {perf ? <LineChart series={[{ name: "Equity", data: perf.equity_curve.map((p: any) => ({ t: p.t, v: p.equity })) }]} height={260} /> : <Skeleton h={260} />}
        </Card>
        <Card title="Allocation">
          {acct ? (
            <div className="col gap-12" style={{ alignItems: "center" }}>
              <Donut items={items} size={150} thickness={18} center={<div><div className="tiny muted">Equity</div><b className="num">{fmtUsd(acct.equity, 0)}</b></div>} />
              <div className="col gap-4" style={{ width: "100%" }}>
                {items.map((it) => <div key={it.label} className="row small"><span className="legend-dot" style={{ background: it.color }} /><span className="grow" style={{ textTransform: "capitalize" }}>{it.label}</span><span className="num">{fmtUsd(it.value, 0)}</span><span className="num muted" style={{ width: 48, textAlign: "right" }}>{it.pct.toFixed(1)}%</span></div>)}
              </div>
              <dl className="kv small" style={{ width: "100%" }}>
                <dt>Cash</dt><dd>{fmtUsd(acct.cash)}</dd><dt>Margin used</dt><dd>{fmtUsd(acct.margin_used)}</dd>
                <dt>Available margin</dt><dd>{fmtUsd(acct.available_margin)}</dd>
                <dt>Margin level</dt><dd className={acct.margin_level_pct && acct.margin_level_pct < 150 ? "down" : ""}>{acct.margin_level_pct ? `${acct.margin_level_pct.toFixed(0)}%` : "—"}</dd>
              </dl>
            </div>
          ) : <Skeleton h={260} />}
        </Card>
      </div>
      <Card title="Holdings" pad={false}><div style={{ padding: 8 }}><PositionsTable positions={acct?.positions ?? []} onChanged={() => reload(true)} /></div></Card>
      {!!acct?.option_positions.length && (
        <Card title="Option Positions" pad={false}>
          <table className="tbl"><thead><tr><th>Contract</th><th className="r">Contracts</th><th className="r">Avg premium</th><th className="r">Mark</th><th className="r">Value</th><th className="r">P&amp;L</th><th className="r">Expiry</th></tr></thead>
            <tbody>{acct.option_positions.map((o) => (
              <tr key={o.id}><td><b>{o.underlying}</b> {o.strike} {o.option_type.toUpperCase()}</td><td className="r num">{o.contracts}</td><td className="r num">{fmtPrice(o.avg_premium)}</td>
                <td className="r num">{fmtPrice(o.mark)}</td><td className="r num">{fmtUsd(o.market_value)}</td><td className={`r num ${pnlClass(o.unrealized_pnl)}`}>{fmtSignedUsd(o.unrealized_pnl)}</td><td className="r">{fmtDate(o.expiry, false)}</td></tr>
            ))}</tbody></table>
        </Card>
      )}
      <Card title="Account Activity (audit log)">
        {!history?.length && <div className="small muted">No activity yet.</div>}
        {history?.map((h) => (
          <div key={h.id} className="list-row small">
            <span className="chip" style={{ minWidth: 120, justifyContent: "center" }}>{h.type}</span>
            <span className="grow muted truncate">{describeEvent(h)}</span>
            <span className="faint tiny">{timeAgo(h.created_at)}</span>
          </div>
        ))}
      </Card>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === "reset" ? "Reset account" : modal === "deposit" ? "Deposit virtual funds" : "Withdraw virtual funds"}>
        <div className="col gap-12">
          {modal === "reset" && <div className="notice warn">This closes all positions, cancels open orders and resets your balance. Trade history stays in the audit log.</div>}
          <label className="field">{modal === "reset" ? "New starting balance" : "Amount"}<div className="input-group"><input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} /><span className="suffix">USD</span></div></label>
          <button className={`btn block ${modal === "reset" ? "sell" : "primary"}`} onClick={act}>Confirm</button>
        </div>
      </Modal>
    </>
  );
}

function describeEvent(h: any) {
  const p = h.payload || {};
  switch (h.type) {
    case "OrderFilled": return `${p.side} ${fmtQty(p.qty)} ${p.symbol} @ ${fmtPrice(p.price)}${p.fee ? ` (fee ${fmtUsd(p.fee)})` : ""}`;
    case "OrderPlaced": return `${p.type} ${p.side} ${fmtQty(p.qty)} ${p.symbol}`;
    case "OrderRejected": return `${p.symbol ?? ""} ${p.reason ?? ""}`;
    case "FundsDeposited": case "FundsWithdrawn": return fmtSignedUsd(p.amount);
    case "AccountOpened": case "AccountReset": return `Balance ${fmtUsd(p.cash)}`;
    case "OptionTraded": return `${p.contracts > 0 ? "Bought" : "Sold"} ${Math.abs(p.contracts)} ${p.contract} @ ${fmtPrice(p.premium)}`;
    default: return JSON.stringify(p);
  }
}

// ------------------------------------------------------------------ Orders
export function OrdersPage() {
  const accountId = useUi((s) => s.accountId);
  const [tab, setTab] = useState<"pending" | "history" | "trades">("pending");
  const { data: orders, reload } = useApi<Order[]>("/api/trading/orders", { params: { status: tab === "pending" ? "pending" : undefined, account_id: accountId ?? undefined, limit: 200 }, poll: 5000 });
  const { data: trades } = useApi<Trade[]>(tab === "trades" ? "/api/trading/trades" : null, { params: { account_id: accountId ?? undefined } });
  const cancel = async (id: number) => {
    try { await del(`/api/trading/orders/${id}`, { account_id: accountId ?? undefined }); toast({ kind: "success", title: `Order #${id} cancelled` }); reload(true); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const list = tab === "history" ? (orders ?? []).filter((o) => o.status !== "pending") : orders ?? [];
  return (
    <>
      <div className="page-head">
        <div><h1>Orders</h1><p>Working orders, order history and executions.</p></div>
        <div className="row">
          <Seg value={tab} options={[{ value: "pending", label: "Open" }, { value: "history", label: "History" }, { value: "trades", label: "Executions" }]} onChange={setTab} />
          {tab === "pending" && !!orders?.length && <button className="btn danger" onClick={async () => { const r = await del("/api/trading/orders", { account_id: accountId ?? undefined }); toast({ kind: "success", title: `Cancelled ${r.cancelled} orders` }); reload(true); }}>Cancel all</button>}
        </div>
      </div>
      <Card pad={false}>
        {tab !== "trades" ? (
          !list.length ? <Empty icon="orders">{tab === "pending" ? "No working orders." : "No orders yet."}</Empty> : (
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>#</th><th>Symbol</th><th>Side</th><th>Type</th><th className="r">Qty</th><th className="r">Limit</th><th className="r">Stop</th><th className="r">Filled @</th><th>Status</th><th>Time</th><th /></tr></thead>
              <tbody>{list.map((o) => (
                <tr key={o.id}>
                  <td className="muted">{o.id}{o.parent_id ? <span className="tiny faint"> ↳{o.parent_id}</span> : ""}</td>
                  <td><b>{o.display}</b>{o.source !== "web" && <span className="chip" style={{ marginLeft: 6 }}>{o.source}</span>}</td>
                  <td className={o.side === "buy" ? "up" : "down"}>{o.side.toUpperCase()}</td>
                  <td>{o.type.replace("_", " ")}{o.trail_percent ? ` ${o.trail_percent}%` : ""}{o.oco_group ? <span className="chip blue" style={{ marginLeft: 6 }}>OCO</span> : ""}</td>
                  <td className="r num">{fmtQty(o.qty)}</td><td className="r num">{fmtPrice(o.limit_price)}</td><td className="r num">{fmtPrice(o.stop_price)}</td><td className="r num">{fmtPrice(o.filled_price)}</td>
                  <td><span className={`chip ${o.status === "filled" ? "up" : o.status === "rejected" ? "down" : o.status === "pending" ? "blue" : ""}`} title={o.reason ?? ""}>{o.status}</span>{o.reason && o.status !== "filled" && <div className="tiny faint" style={{ maxWidth: 240, whiteSpace: "normal" }}>{o.reason}</div>}</td>
                  <td className="small muted">{fmtDate(o.created_at)}</td>
                  <td>{o.status === "pending" && <button className="btn xs danger" onClick={() => cancel(o.id)}>Cancel</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )
        ) : !trades?.length ? <Empty icon="orders">No executions yet.</Empty> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Fee</th><th className="r">Realized P&amp;L</th></tr></thead>
            <tbody>{trades.map((t) => (
              <tr key={t.id}><td className="small muted">{fmtDate(t.created_at)}</td><td><b>{t.display}</b></td><td className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</td>
                <td className="r num">{fmtQty(t.qty)}</td><td className="r num">{fmtPrice(t.price)}</td><td className="r num">{fmtUsd(t.fee)}</td>
                <td className={`r num ${pnlClass(t.net_pnl)}`}>{t.net_pnl != null ? fmtSignedUsd(t.net_pnl) : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Positions
export function PositionsPage() {
  const { data: acct, reload } = useAccount(3000);
  const accountId = useUi((s) => s.accountId);
  const closeAll = async () => {
    if (!confirm("Close every open position at market?")) return;
    await post("/api/trading/positions/close-all", {}, { account_id: accountId ?? undefined });
    toast({ kind: "success", title: "All positions closed" });
    reload(true);
  };
  const total = (acct?.positions ?? []).reduce((a, p) => a + p.unrealized_pnl, 0);
  return (
    <>
      <div className="page-head">
        <div><h1>Positions</h1><p>Open positions with live P&amp;L. Unrealized: <b className={pnlClass(total)}>{fmtSignedUsd(total)}</b></p></div>
        {!!acct?.positions.length && <button className="btn danger" onClick={closeAll}>Close all</button>}
      </div>
      <Card pad={false}><div style={{ padding: 8 }}>{acct ? <PositionsTable positions={acct.positions} onChanged={() => reload(true)} /> : <Skeleton h={160} />}</div></Card>
      {acct && <div className="small muted">Margin used {fmtUsd(acct.margin_used)} · available {fmtUsd(acct.available_margin)} · total return <span className={pnlClass(acct.total_pnl_pct)}>{fmtPct(acct.total_pnl_pct)}</span></div>}
    </>
  );
}
