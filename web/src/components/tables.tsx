import { useState } from "react";
import { post } from "../api/client";
import { useQuotes } from "../lib/hooks";
import { fmtPct, fmtPrice, fmtQty, fmtSignedUsd, pnlClass } from "../lib/format";
import type { PositionRow } from "../lib/types";
import { toast, useUi } from "../store/ui";
import { Empty, SymbolCell, useGoSymbol } from "./ui";

/** Positions with P&L recomputed client-side from live websocket quotes. */
export function livePosition(p: PositionRow, price?: number, bid?: number, ask?: number) {
  const mark = p.qty > 0 ? bid ?? price ?? p.price : ask ?? price ?? p.price;
  const upnl = (mark - p.avg_price) * p.qty;
  const pct = p.avg_price ? ((mark / p.avg_price - 1) * 100 * (p.qty > 0 ? 1 : -1)) : 0;
  return { ...p, price: price ?? p.price, unrealized_pnl: upnl, unrealized_pnl_pct: pct, market_value: p.qty * mark };
}

export function PositionsTable({ positions, compact = false, onChanged }: { positions: PositionRow[]; compact?: boolean; onChanged?: () => void }) {
  const quotes = useQuotes(positions.map((p) => p.symbol));
  const go = useGoSymbol();
  const accountId = useUi((s) => s.accountId);
  const [busy, setBusy] = useState<string | null>(null);
  if (!positions.length) return <Empty icon="layers">No open positions. Place a trade to get started.</Empty>;
  const close = async (symbol: string, qty?: number) => {
    setBusy(symbol);
    try {
      const o = await post(`/api/trading/positions/${symbol}/close`, { qty, account_id: accountId ?? undefined });
      toast({ kind: "success", title: `Closed ${fmtQty(o.qty)} ${o.display}`, body: `@ ${fmtPrice(o.filled_price)}` });
      onChanged?.();
    } catch (e) {
      toast({ kind: "error", title: "Close failed", body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="table-wrap">
      <table className={`tbl ${compact ? "compact" : ""}`}>
        <thead>
          <tr>
            <th>Symbol</th><th>Type</th><th className="r">Qty</th><th className="r">Avg Price</th><th className="r">LTP</th>
            <th className="r">P&amp;L</th><th className="r">P&amp;L%</th>{!compact && <><th className="r">Value</th><th className="r">Day</th><th /></>}
          </tr>
        </thead>
        <tbody>
          {positions.map((raw) => {
            const q = quotes[raw.symbol];
            const p = livePosition(raw, q?.price, q?.bid, q?.ask);
            return (
              <tr key={p.symbol} className="click" onClick={() => go(p.symbol)}>
                <td>{compact ? <b>{p.display}</b> : <SymbolCell symbol={p.symbol} display={p.display} name={p.asset_class} />}</td>
                <td className={p.qty > 0 ? "up" : "down"}>{p.qty > 0 ? "Buy" : "Sell"}</td>
                <td className="r num">{fmtQty(Math.abs(p.qty))}</td>
                <td className="r num">{fmtPrice(p.avg_price)}</td>
                <td className="r num">{fmtPrice(p.price)}</td>
                <td className={`r num ${pnlClass(p.unrealized_pnl)}`}>{fmtSignedUsd(p.unrealized_pnl)}</td>
                <td className={`r num ${pnlClass(p.unrealized_pnl_pct)}`}>{fmtPct(p.unrealized_pnl_pct)}</td>
                {!compact && (
                  <>
                    <td className="r num">{fmtSignedUsd(p.market_value).replace("+", "")}</td>
                    <td className={`r num ${pnlClass(q?.change_pct)}`}>{fmtPct(q?.change_pct ?? p.day_change_pct)}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn xs" disabled={busy === p.symbol} onClick={() => close(p.symbol, Math.abs(p.qty) / 2)}>Close ½</button>
                        <button className="btn xs danger" disabled={busy === p.symbol} onClick={() => close(p.symbol)}>Close</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
