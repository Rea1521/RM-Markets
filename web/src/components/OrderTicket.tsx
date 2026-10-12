import { useEffect, useMemo, useState } from "react";
import { post } from "../api/client";
import { useQuote } from "../lib/hooks";
import { baseAsset, fmtPrice, fmtQty, fmtUsd } from "../lib/format";
import type { AccountSummary } from "../lib/types";
import { toast, useUi } from "../store/ui";
import { I } from "./Icons";

const TYPES = [
  { v: "market", l: "Market" }, { v: "limit", l: "Limit" }, { v: "stop", l: "Stop" },
  { v: "stop_limit", l: "Stop-Limit" }, { v: "trailing_stop", l: "Trailing Stop" },
];
const FEE: Record<string, number> = { crypto: 0.001, stock: 0, index: 0.0001, commodity: 0.0001, forex: 0.00002 };

export function OrderTicket({ symbol, account, onPlaced, initialSide = "buy" }: {
  symbol: string; account?: AccountSummary | null; onPlaced?: () => void; initialSide?: "buy" | "sell";
}) {
  const q = useQuote(symbol);
  const accountId = useUi((s) => s.accountId);
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [type, setType] = useState("market");
  const [unit, setUnit] = useState<"usd" | "qty">("usd");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const [stop, setStop] = useState("");
  const [trail, setTrail] = useState("2");
  const [tif, setTif] = useState<"gtc" | "day">("gtc");
  const [bracket, setBracket] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setAmount(""); setLimit(""); setStop(""); setTp(""); setSl(""); }, [symbol]);
  useEffect(() => setSide(initialSide), [initialSide]);

  const ref = type === "limit" || type === "stop_limit" ? Number(limit) || q?.price : type === "stop" ? Number(stop) || q?.price : side === "buy" ? q?.ask : q?.bid;
  const qty = useMemo(() => {
    const a = Number(amount);
    if (!a || !ref) return 0;
    return unit === "qty" ? a : a / ref;
  }, [amount, unit, ref]);
  const notional = qty * (ref || 0);
  const fee = q ? (q.asset_class === "stock" ? (qty > 0 ? Math.max(1, qty * 0.005) : 0) : notional * (FEE[q.asset_class] ?? 0)) : 0;
  const position = account?.positions.find((p) => p.symbol === symbol);
  const bp = q && account ? account.buying_power_by_class[q.asset_class] ?? account.available_margin : 0;
  const base = q ? baseAsset(q.display) : "";
  const quoteCcy = q?.display.includes("/") ? q.display.split("/")[1] : "USD";

  const setPct = (p: number) => {
    if (!q) return;
    if (side === "sell" && position && position.qty > 0) {
      const units = position.qty * p;
      setAmount(unit === "qty" ? fmtQty(units) : (units * (ref || q.price)).toFixed(2));
    } else {
      const usd = bp * p * (p === 1 ? 0.995 : 1);
      setAmount(unit === "qty" ? fmtQty(usd / (ref || q.price)) : usd.toFixed(2));
    }
  };

  const submit = async () => {
    if (!q || qty <= 0) { toast({ kind: "error", title: "Enter an amount" }); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { symbol, side, qty: Number(qty.toPrecision(10)), type, time_in_force: tif, account_id: accountId ?? undefined };
      if (type === "limit" || type === "stop_limit") body.limit_price = Number(limit);
      if (type === "stop" || type === "stop_limit") body.stop_price = Number(stop);
      if (type === "trailing_stop") body.trail_percent = Number(trail);
      if (bracket) { if (tp) body.take_profit = Number(tp); if (sl) body.stop_loss = Number(sl); }
      const o = await post("/api/trading/orders", body);
      toast({
        kind: "success",
        title: o.status === "filled" ? `${side === "buy" ? "Bought" : "Sold"} ${fmtQty(o.qty)} ${base}` : `${type.replace("_", " ")} order placed`,
        body: o.status === "filled" ? `Filled @ ${fmtPrice(o.filled_price)}${o.fee ? ` · fee ${fmtUsd(o.fee)}` : ""}` : `#${o.id} is working`,
      });
      setAmount("");
      onPlaced?.();
    } catch (e) {
      toast({ kind: "error", title: "Order rejected", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col gap-12">
      <div className="side-tabs">
        <button className={`buy ${side === "buy" ? "active" : ""}`} onClick={() => setSide("buy")}>Buy</button>
        <button className={`sell ${side === "sell" ? "active" : ""}`} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <label className="field">Order Type
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
      </label>
      {(type === "stop" || type === "stop_limit") && (
        <label className="field">Stop price
          <div className="input-group"><input className="input num" inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} placeholder={fmtPrice(q?.price)} /><span className="suffix">{quoteCcy}</span></div>
        </label>
      )}
      {(type === "limit" || type === "stop_limit") && (
        <label className="field">Limit price
          <div className="input-group"><input className="input num" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={fmtPrice(q?.price)} /><span className="suffix">{quoteCcy}</span></div>
        </label>
      )}
      {type === "trailing_stop" && (
        <label className="field">Trail %
          <div className="input-group"><input className="input num" inputMode="decimal" value={trail} onChange={(e) => setTrail(e.target.value)} /><span className="suffix">%</span></div>
        </label>
      )}
      <label className="field">
        <span className="row between">Amount
          <button type="button" className="btn xs ghost" onClick={() => { setUnit(unit === "usd" ? "qty" : "usd"); setAmount(""); }} title="Switch unit">
            in {unit === "usd" ? quoteCcy : base} ⇄
          </button>
        </span>
        <div className="input-group">
          <input className="input num" inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <span className="suffix">{unit === "usd" ? quoteCcy : base}</span>
        </div>
      </label>
      <div className="pct-row">
        {[0.25, 0.5, 0.75, 1].map((p) => <button key={p} type="button" onClick={() => setPct(p)}>{p * 100}%</button>)}
      </div>
      <label className="switch small"><input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} /> Take profit / Stop loss</label>
      {bracket && (
        <div className="grid g-2" style={{ gap: 8 }}>
          <input className="input num" placeholder="Take profit" value={tp} onChange={(e) => setTp(e.target.value)} />
          <input className="input num" placeholder="Stop loss" value={sl} onChange={(e) => setSl(e.target.value)} />
        </div>
      )}
      {type !== "market" && (
        <div className="row between small"><span className="muted">Time in force</span>
          <select className="input" style={{ width: 110, height: 28 }} value={tif} onChange={(e) => setTif(e.target.value as "gtc" | "day")}>
            <option value="gtc">GTC</option><option value="day">Day</option>
          </select>
        </div>
      )}
      <div className="col gap-4 small">
        <div className="row between"><span className="muted">Estimated</span><span className="num bold">{unit === "usd" ? `${fmtQty(qty)} ${base}` : `${fmtPrice(notional, 2)} ${quoteCcy}`}</span></div>
        <div className="row between"><span className="muted">Est. fee</span><span className="num">{fmtUsd(fee)}</span></div>
        <div className="row between"><span className="muted">Buying power</span><span className="num">{fmtUsd(bp)}</span></div>
        {position && <div className="row between"><span className="muted">Position</span><span className="num">{fmtQty(position.qty)} {base}</span></div>}
      </div>
      <button className={`btn block ${side}`} style={{ height: 38 }} disabled={busy || !q} onClick={submit}>
        {busy ? "Placing…" : `${side === "buy" ? "Buy" : "Sell"} ${base}`}
      </button>
      {q && !q.market_open && q.asset_class !== "crypto" && (
        <div className="notice warn small row gap-4"><I.alert width={14} />Market closed: prices may be stale until the session opens.</div>
      )}
    </div>
  );
}
