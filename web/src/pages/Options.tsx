import { useEffect, useMemo, useState } from "react";
import { post } from "../api/client";
import { useApi, useAccount } from "../lib/hooks";
import { fmtDate, fmtNum, fmtPrice, fmtUsd } from "../lib/format";
import { Card, Seg, Skeleton } from "../components/ui";
import { I } from "../components/Icons";
import { toast, useUi } from "../store/ui";

const UNDERLYINGS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "META", "SPX", "NDX", "BTCUSDT", "ETHUSDT", "XAUUSD"];

interface Leg { type: "call" | "put"; strike: number; expiry: string; qty: number; premium?: number }

function PayoffChart({ data, spot }: { data: any; spot: number }) {
  const W = 640, H = 220, P = 30;
  const xs: number[] = data.prices, a: number[] = data.expiry_pnl, b: number[] = data.today_pnl;
  const minY = Math.min(...a, ...b), maxY = Math.max(...a, ...b);
  const sx = (x: number) => P + ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - minY) / (maxY - minY || 1)) * (H - 2 * P);
  const path = (ys: number[]) => ys.map((y, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
      <line x1={P} x2={W - P} y1={sy(0)} y2={sy(0)} stroke="var(--border)" />
      <line x1={sx(spot)} x2={sx(spot)} y1={P / 2} y2={H - P} stroke="var(--faint)" strokeDasharray="4 4" />
      <text x={sx(spot) + 4} y={P / 2 + 8} fontSize="10" fill="var(--muted)">spot {fmtPrice(spot)}</text>
      <path d={path(b)} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" />
      <path d={path(a)} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {data.breakevens.map((x: number) => <circle key={x} cx={sx(x)} cy={sy(0)} r={3.5} fill="var(--up)" />)}
      <text x={P} y={H - 8} fontSize="10" fill="var(--muted)">{fmtPrice(xs[0])}</text>
      <text x={W - P} y={H - 8} fontSize="10" fill="var(--muted)" textAnchor="end">{fmtPrice(xs[xs.length - 1])}</text>
      <text x={4} y={sy(maxY) + 4} fontSize="10" fill="var(--up)">{fmtUsd(maxY, 0)}</text>
      <text x={4} y={sy(minY)} fontSize="10" fill="var(--down)">{fmtUsd(minY, 0)}</text>
    </svg>
  );
}

export function OptionsPage() {
  const [und, setUnd] = useState("AAPL");
  const [expiry, setExpiry] = useState<string | undefined>();
  const [legs, setLegs] = useState<Leg[]>([]);
  const [payoff, setPayoff] = useState<any>(null);
  const [view, setView] = useState<"price" | "greeks">("price");
  const accountId = useUi((s) => s.accountId);
  const { reload } = useAccount(15000);
  const { data: chain, loading } = useApi<any>(`/api/analytics/options/chain/${und}`, { params: { expiry, strikes: 9 }, poll: 15000 });
  useEffect(() => { setExpiry(undefined); setLegs([]); }, [und]);
  const mult = chain?.multiplier ?? 100;

  useEffect(() => {
    if (!legs.length) { setPayoff(null); return; }
    post("/api/analytics/options/payoff", { underlying: und, legs: legs.map((l) => ({ ...l })) }).then(setPayoff).catch(() => setPayoff(null));
  }, [legs, und]);

  const addLeg = (type: "call" | "put", strike: number, qty: number, premium: number) =>
    setLegs((l) => [...l, { type, strike, expiry: chain.expiry, qty, premium }]);

  const trade = async (type: "call" | "put", strike: number, contracts: number) => {
    try {
      const r = await post("/api/analytics/options/orders", { underlying: und, option_type: type, strike, expiry: chain.expiry, contracts, account_id: accountId ?? undefined });
      toast({ kind: "success", title: `${contracts > 0 ? "Bought" : "Sold"} ${Math.abs(contracts)} ${und} ${strike} ${type}`, body: `Premium ${fmtPrice(r.avg_premium)} × ${mult}` });
      reload(true);
    } catch (e) { toast({ kind: "error", title: "Option order rejected", body: (e as Error).message }); }
  };

  const presets = useMemo(() => {
    if (!chain) return [];
    const rows = chain.rows; const mid = Math.floor(rows.length / 2);
    const at = (i: number) => rows[Math.max(0, Math.min(rows.length - 1, mid + i))];
    return [
      { name: "Long call", legs: [{ type: "call", strike: at(0).strike, qty: 1, premium: at(0).call.price }] },
      { name: "Bull call spread", legs: [{ type: "call", strike: at(0).strike, qty: 1, premium: at(0).call.price }, { type: "call", strike: at(2).strike, qty: -1, premium: at(2).call.price }] },
      { name: "Bear put spread", legs: [{ type: "put", strike: at(0).strike, qty: 1, premium: at(0).put.price }, { type: "put", strike: at(-2).strike, qty: -1, premium: at(-2).put.price }] },
      { name: "Long straddle", legs: [{ type: "call", strike: at(0).strike, qty: 1, premium: at(0).call.price }, { type: "put", strike: at(0).strike, qty: 1, premium: at(0).put.price }] },
      { name: "Iron condor", legs: [
        { type: "put", strike: at(-4).strike, qty: 1, premium: at(-4).put.price }, { type: "put", strike: at(-2).strike, qty: -1, premium: at(-2).put.price },
        { type: "call", strike: at(2).strike, qty: -1, premium: at(2).call.price }, { type: "call", strike: at(4).strike, qty: 1, premium: at(4).call.price }] },
    ].map((p) => ({ ...p, legs: p.legs.map((l) => ({ ...l, expiry: chain.expiry })) as Leg[] }));
  }, [chain]);

  return (
    <>
      <div className="page-head">
        <div><h1>Options Trading Simulator</h1><p>Black-Scholes priced option chains with live Greeks, multi-leg payoff analysis and paper trading.</p></div>
        <div className="row wrap">
          <select className="input" style={{ width: 130 }} value={und} onChange={(e) => setUnd(e.target.value)}>{UNDERLYINGS.map((u) => <option key={u}>{u}</option>)}</select>
          {chain && <select className="input" style={{ width: 170 }} value={chain.expiry} onChange={(e) => setExpiry(e.target.value)}>
            {chain.expiries.map((e: string) => <option key={e} value={e}>{fmtDate(e, false)}</option>)}</select>}
        </div>
      </div>
      {chain && (
        <div className="grid g-5">
          <div className="metric"><div className="l">Spot</div><div className="v">{fmtPrice(chain.spot)}</div></div>
          <div className="metric"><div className="l">Historical volatility (90d)</div><div className="v">{(chain.hist_vol * 100).toFixed(1)}%</div></div>
          <div className="metric"><div className="l">Days to expiry</div><div className="v">{chain.days_to_expiry}</div></div>
          <div className="metric"><div className="l">Contract multiplier</div><div className="v">{mult}</div></div>
          <div className="metric"><div className="l">Model</div><div className="v" style={{ fontSize: 13 }}>Black-Scholes + skew</div></div>
        </div>
      )}
      <Card pad={false} title={<h2>Option chain</h2>} actions={<Seg value={view} onChange={setView} options={[{ value: "price", label: "Prices" }, { value: "greeks", label: "Greeks" }]} />}>
        {loading && !chain ? <div style={{ padding: 16 }}><Skeleton h={300} /></div> : chain && (
          <div className="table-wrap" style={{ padding: "6px 0" }}>
            <table className="tbl compact">
              <thead>
                <tr><th colSpan={view === "price" ? 3 : 5} className="center up">CALLS</th><th className="center">Strike</th><th className="center">IV</th><th colSpan={view === "price" ? 3 : 5} className="center down">PUTS</th></tr>
                <tr>
                  {view === "price" ? <><th>Trade</th><th className="r">Delta</th><th className="r">Price</th></> : <><th className="r">Δ</th><th className="r">Γ</th><th className="r">Θ/day</th><th className="r">Vega</th><th className="r">Rho</th></>}
                  <th /><th />
                  {view === "price" ? <><th>Price</th><th className="r">Delta</th><th className="r">Trade</th></> : <><th className="r">Δ</th><th className="r">Γ</th><th className="r">Θ/day</th><th className="r">Vega</th><th className="r">Rho</th></>}
                </tr>
              </thead>
              <tbody>
                {chain.rows.map((r: any) => {
                  const atm = Math.abs(r.strike - chain.spot) === Math.min(...chain.rows.map((x: any) => Math.abs(x.strike - chain.spot)));
                  const g = (o: any) => <><td className="r num">{fmtNum(o.delta, 3)}</td><td className="r num">{fmtNum(o.gamma, 4)}</td><td className="r num">{fmtNum(o.theta, 3)}</td><td className="r num">{fmtNum(o.vega, 3)}</td><td className="r num">{fmtNum(o.rho, 3)}</td></>;
                  return (
                    <tr key={r.strike} style={{ background: atm ? "var(--primary-soft)" : undefined }}>
                      {view === "price" ? <>
                        <td><div className="row gap-4"><button className="btn xs buy" onClick={() => trade("call", r.strike, 1)}>B</button><button className="btn xs sell" onClick={() => trade("call", r.strike, -1)}>S</button><button className="btn xs" title="Add to strategy" onClick={() => addLeg("call", r.strike, 1, r.call.price)}>+</button></div></td>
                        <td className="r num muted">{fmtNum(r.call.delta, 2)}</td>
                        <td className="r num bold" style={{ background: r.itm_call ? "var(--up-soft)" : undefined }}>{fmtPrice(r.call.price)}</td>
                      </> : g(r.call)}
                      <td className="center bold num">{fmtPrice(r.strike)}</td>
                      <td className="center num muted">{(r.iv * 100).toFixed(1)}%</td>
                      {view === "price" ? <>
                        <td className="num bold" style={{ background: r.itm_put ? "var(--down-soft)" : undefined }}>{fmtPrice(r.put.price)}</td>
                        <td className="r num muted">{fmtNum(r.put.delta, 2)}</td>
                        <td className="r"><div className="row gap-4" style={{ justifyContent: "flex-end" }}><button className="btn xs" title="Add to strategy" onClick={() => addLeg("put", r.strike, 1, r.put.price)}>+</button><button className="btn xs buy" onClick={() => trade("put", r.strike, 1)}>B</button><button className="btn xs sell" onClick={() => trade("put", r.strike, -1)}>S</button></div></td>
                      </> : g(r.put)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid g-main">
        <Card title="Strategy payoff" actions={legs.length > 0 && <button className="btn xs" onClick={() => setLegs([])}>Clear</button>}>
          <div className="row wrap gap-4 mb-12">{presets.map((p) => <button key={p.name} className="chip click" onClick={() => setLegs(p.legs)}>{p.name}</button>)}</div>
          {!payoff && <div className="small muted">Pick a preset strategy or press “+” in the chain to add legs.</div>}
          {payoff && (
            <>
              <PayoffChart data={payoff} spot={payoff.spot} />
              <div className="row small muted"><span className="legend-dot" style={{ background: "var(--primary)" }} />At expiry<span className="legend-dot" style={{ background: "#f59e0b", marginLeft: 12 }} />Today (theoretical)</div>
              <div className="grid g-4 mt-12" style={{ gap: 8 }}>
                <div className="metric"><div className="l">Max profit (per share)</div><div className="v up">{unlimited(payoff.expiry_pnl) ? "Unlimited" : fmtPrice(payoff.max_profit)}</div></div>
                <div className="metric"><div className="l">Max loss (per share)</div><div className="v down">{fmtPrice(payoff.max_loss)}</div></div>
                <div className="metric"><div className="l">Breakeven</div><div className="v">{payoff.breakevens.map((b: number) => fmtPrice(b)).join(" / ") || "—"}</div></div>
                <div className="metric"><div className="l">Net Δ / Θ</div><div className="v">{fmtNum(payoff.greeks.delta, 2)} / {fmtNum(payoff.greeks.theta, 3)}</div></div>
              </div>
            </>
          )}
        </Card>
        <Card title="Legs">
          {!legs.length && <div className="small muted">No legs yet.</div>}
          {legs.map((l, i) => (
            <div key={i} className="list-row small">
              <span className={l.qty > 0 ? "up bold" : "down bold"}>{l.qty > 0 ? "Long" : "Short"}</span>
              <span className="grow">{Math.abs(l.qty)}× {fmtPrice(l.strike)} {l.type}</span>
              <span className="num muted">{fmtPrice(l.premium)}</span>
              <button className="btn xs ghost" onClick={() => setLegs(legs.map((x, j) => (j === i ? { ...x, qty: -x.qty } : x)))} title="Flip long/short"><I.transfer width={12} /></button>
              <button className="btn xs ghost" onClick={() => setLegs(legs.filter((_, j) => j !== i))}><I.x width={12} /></button>
            </div>
          ))}
          {legs.length > 0 && (
            <button className="btn primary block mt-12" onClick={async () => { for (const l of legs) await trade(l.type, l.strike, l.qty); }}>Execute strategy ({legs.length} legs)</button>
          )}
          <BSCalculator spot={chain?.spot} />
        </Card>
      </div>
    </>
  );
}

function unlimited(p: number[]) {
  const n = p.length;
  return n > 2 && p[n - 1] === Math.max(...p) && p[n - 1] - p[n - 2] > 1e-9;
}

function BSCalculator({ spot }: { spot?: number }) {
  const [f, setF] = useState({ spot: "", strike: "", days: "30", volatility: "25", rate: "5", option_type: "call" });
  const [r, setR] = useState<any>(null);
  useEffect(() => { if (spot && !f.spot) setF((x) => ({ ...x, spot: spot.toFixed(2), strike: spot.toFixed(0) })); }, [spot, f.spot]);
  const calc = async () => {
    try { setR(await post("/api/analytics/options/price", { spot: +f.spot, strike: +f.strike, days: +f.days, volatility: +f.volatility / 100, rate: +f.rate / 100, option_type: f.option_type })); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); }
  };
  const inp = (k: keyof typeof f, label: string) => <label className="field">{label}<input className="input num" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="mt-16" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <b className="small">Black-Scholes calculator</b>
      <div className="grid g-3 mt-8" style={{ gap: 8 }}>{inp("spot", "Spot")}{inp("strike", "Strike")}{inp("days", "Days")}{inp("volatility", "Vol %")}{inp("rate", "Rate %")}
        <label className="field">Type<select className="input" value={f.option_type} onChange={(e) => setF({ ...f, option_type: e.target.value })}><option value="call">Call</option><option value="put">Put</option></select></label></div>
      <button className="btn block mt-8" onClick={calc}>Calculate</button>
      {r && <dl className="kv small mt-8"><dt>Price</dt><dd>{fmtPrice(r.price)}</dd><dt>Delta</dt><dd>{fmtNum(r.delta, 4)}</dd><dt>Gamma</dt><dd>{fmtNum(r.gamma, 5)}</dd><dt>Theta / day</dt><dd>{fmtNum(r.theta, 4)}</dd><dt>Vega (1%)</dt><dd>{fmtNum(r.vega, 4)}</dd><dt>Rho (1%)</dt><dd>{fmtNum(r.rho, 4)}</dd></dl>}
    </div>
  );
}
