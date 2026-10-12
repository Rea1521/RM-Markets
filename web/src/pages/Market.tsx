import { useMemo, useState } from "react";
import { del, post } from "../api/client";
import { useApi, useQuotes } from "../lib/hooks";
import { fmtCompact, fmtPrice } from "../lib/format";
import type { Quote } from "../lib/types";
import { Card, Change, LivePrice, Seg, Skeleton, SymbolCell, useGoSymbol } from "../components/ui";
import { I } from "../components/Icons";
import { toast } from "../store/ui";

const CLASSES = [
  { value: "all", label: "All" }, { value: "crypto", label: "Crypto" }, { value: "stock", label: "Stocks" },
  { value: "forex", label: "Forex" }, { value: "commodity", label: "Commodities" }, { value: "index", label: "Indices" },
] as const;

export function MarketPage() {
  const [cls, setCls] = useState<string>("all");
  const [sort, setSort] = useState<{ k: keyof Quote; d: 1 | -1 }>({ k: "volume", d: -1 });
  const { data, loading } = useApi<Quote[]>("/api/market/quotes");
  const { data: watch, reload } = useApi<Quote[]>("/api/trading/watchlist");
  const live = useQuotes((data ?? []).map((q) => q.symbol));
  const go = useGoSymbol();
  const watched = new Set((watch ?? []).map((w) => w.symbol));

  const rows = useMemo(() => {
    const r = (data ?? []).map((q) => live[q.symbol] ?? q).filter((q) => cls === "all" || q.asset_class === cls);
    return r.sort((a, b) => {
      const av = sort.k === "volume" ? a.volume * a.price : (a[sort.k] as any);
      const bv = sort.k === "volume" ? b.volume * b.price : (b[sort.k] as any);
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.d;
    });
  }, [data, live, cls, sort]);

  const th = (k: keyof Quote, label: string, right = true) => (
    <th className={right ? "r" : ""} style={{ cursor: "pointer" }} onClick={() => setSort({ k, d: sort.k === k ? (-sort.d as 1 | -1) : -1 })}>
      {label}{sort.k === k ? (sort.d > 0 ? " ↑" : " ↓") : ""}
    </th>
  );

  const toggleWatch = async (s: string) => {
    try {
      if (watched.has(s)) await del(`/api/trading/watchlist/${s}`); else await post("/api/trading/watchlist", { symbol: s });
      reload(true);
    } catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Markets</h1><p>Live prices across crypto, stocks, forex, commodities and indices.</p></div>
        <Seg value={cls} options={CLASSES as any} onChange={setCls} />
      </div>
      <Card pad={false}>
        {loading && !data ? <div style={{ padding: 16 }}><Skeleton h={300} /></div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 32 }} />{th("display", "Instrument", false)}{th("price", "Price")}{th("change_pct", "24h / Day")}
                {th("bid", "Bid")}{th("ask", "Ask")}{th("high", "High")}{th("low", "Low")}{th("volume", "Volume")}<th className="r">Session</th><th className="r">Source</th>
              </tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.symbol} className="click" onClick={() => go(q.symbol)}>
                    <td onClick={(e) => { e.stopPropagation(); toggleWatch(q.symbol); }}>
                      <I.star width={15} style={{ color: watched.has(q.symbol) ? "#f59e0b" : "var(--faint)", fill: watched.has(q.symbol) ? "#f59e0b" : "none" }} />
                    </td>
                    <td><SymbolCell q={q} symbol={q.symbol} /></td>
                    <td className="r bold"><LivePrice symbol={q.symbol} price={q.price} /></td>
                    <td className="r"><Change v={q.change_pct} /></td>
                    <td className="r num muted">{fmtPrice(q.bid)}</td>
                    <td className="r num muted">{fmtPrice(q.ask)}</td>
                    <td className="r num">{fmtPrice(q.high)}</td>
                    <td className="r num">{fmtPrice(q.low)}</td>
                    <td className="r num">{fmtCompact(q.volume)}</td>
                    <td className="r">{q.market_open ? <span className="chip up">Open</span> : <span className="chip">Closed</span>}</td>
                    <td className="r"><span className={`chip ${q.source === "sim" ? "warn" : "blue"}`}>{q.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
