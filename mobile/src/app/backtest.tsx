import { useState } from "react";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtNum, fmtPct } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast } from "../lib/ui";
import { Btn, Card, Chip, KV, Row, Screen, Seg, T } from "../components/ui";
import { LineChartSimple } from "../components/Charts";

const SYMS = ["BTCUSDT", "ETHUSDT", "AAPL", "TSLA", "SPX", "EURUSD", "XAUUSD"];

export default function Backtest() {
  const t = useTheme();
  const { data: strategies } = useApi<any[]>("/api/analytics/backtest/strategies");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [strategy, setStrategy] = useState("sma_cross");
  const [mode, setMode] = useState<"bt" | "wf">("bt");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setRes(null);
    try { setRes(await post(mode === "bt" ? "/api/analytics/backtest" : "/api/analytics/backtest/walk-forward", { symbol, strategy, bars: 750, interval: "1D" })); }
    catch (e) { toast({ kind: "error", title: (e as Error).message }); } finally { setBusy(false); }
  };
  const m = mode === "bt" ? res?.metrics : res?.oos_metrics;
  return (
    <Screen>
      <Seg value={mode} onChange={(v) => { setMode(v); setRes(null); }} options={[{ value: "bt", label: "Backtest" }, { value: "wf", label: "Walk-forward" }]} />
      <Row gap={6} style={{ flexWrap: "wrap" }}>{SYMS.map((s) => <Chip key={s} label={s} active={s === symbol} onPress={() => setSymbol(s)} />)}</Row>
      <Row gap={6} style={{ flexWrap: "wrap" }}>{strategies?.map((s) => <Chip key={s.id} label={s.name} active={s.id === strategy} onPress={() => setStrategy(s.id)} />)}</Row>
      <Btn kind="primary" title={busy ? "Running…" : "Run"} loading={busy} onPress={run} />
      {res && m && (
        <>
          <Card title={mode === "bt" ? "Equity vs buy & hold" : "Out-of-sample equity"}>
            <LineChartSimple data={(mode === "bt" ? res.equity : res.oos_equity).map((p: any) => ({ t: p.t, v: p.equity }))} />
          </Card>
          <Card title="Results">
            <KV k="Total return" v={fmtPct(m.total_return_pct)} vColor={m.total_return_pct >= 0 ? t.up : t.down} />
            {mode === "bt" && <KV k="Buy & hold" v={fmtPct(m.buy_hold_return_pct)} />}
            <KV k="Sharpe" v={fmtNum(m.sharpe)} /><KV k="Max drawdown" v={fmtPct(m.max_drawdown_pct)} vColor={t.down} />
            {mode === "bt" && <><KV k="Trades" v={String(m.trades)} /><KV k="Win rate" v={`${fmtNum(m.win_rate, 1)}%`} /></>}
            {mode === "wf" && <><KV k="Walk-forward efficiency" v={fmtNum(res.walk_forward_efficiency)} /><KV k="Verdict" v={res.robust ? "Robust" : "Not robust"} vColor={res.robust ? t.up : t.down} /></>}
          </Card>
          {mode === "wf" && (
            <Card title="Windows">
              {res.windows.map((w: any) => <KV key={w.window} k={`#${w.window} ${Object.entries(w.best_params).map(([k, v]) => `${k}=${v}`).join(" ")}`} v={`IS ${fmtPct(w.in_sample.total_return_pct, 1)} → OOS ${fmtPct(w.out_of_sample.total_return_pct, 1)}`} />)}
            </Card>
          )}
          <T v="tiny" color={t.faint}>Hypothetical results. Signals at bar close, fills at next open, 10 bps fees.</T>
        </>
      )}
    </Screen>
  );
}
