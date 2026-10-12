import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { get } from "../lib/api";
import { useQuote } from "../lib/hooks";
import { fmtPrice } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { Candle } from "../lib/types";
import { Loading, Row, T } from "./ui";

const STEP: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400, "1W": 604800 };

function rsi(closes: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function sma(c: number[], n: number) {
  return c.map((_, i) => (i < n - 1 ? null : c.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
}

/** Candlestick chart with MA20/MA50, volume and RSI pane. Touch & drag for crosshair. Live-updates from WS ticks. */
export function CandleChart({ symbol, interval, height = 260, showRsi = true, bars = 70 }: { symbol: string; interval: string; height?: number; showRsi?: boolean; bars?: number }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [source, setSource] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const q = useQuote(symbol);

  useEffect(() => {
    let alive = true;
    setCandles(null);
    const load = () => get(`/api/market/history/${symbol}`, { interval, limit: 300 })
      .then((d) => { if (alive) { setCandles(d.candles); setSource(d.source); setErr(null); } })
      .catch((e) => alive && setErr(e.message));
    load();
    const id = setInterval(load, Math.max(30000, Math.min(STEP[interval] * 1000, 300000)));
    return () => { alive = false; clearInterval(id); };
  }, [symbol, interval]);

  // live tick -> update/append last candle
  useEffect(() => {
    if (!q || !candles?.length) return;
    setCandles((cs) => {
      if (!cs?.length) return cs;
      const last = cs[cs.length - 1];
      const step = STEP[interval];
      const now = Math.floor(q.ts);
      if (step < 86400 && now >= last.t + step) {
        return [...cs.slice(-299), { t: now - (now % step), o: last.c, h: Math.max(last.c, q.price), l: Math.min(last.c, q.price), c: q.price, v: 0 }];
      }
      return [...cs.slice(0, -1), { ...last, c: q.price, h: Math.max(last.h, q.price), l: Math.min(last.l, q.price) }];
    });
  }, [q?.price]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => {
    if (!candles?.length) return null;
    const closesAll = candles.map((c) => c.c);
    const ma20 = sma(closesAll, 20), ma50 = sma(closesAll, 50), r = rsi(closesAll);
    const start = Math.max(0, candles.length - bars);
    return { cs: candles.slice(start), ma20: ma20.slice(start), ma50: ma50.slice(start), rsi: r.slice(start) };
  }, [candles, bars]);

  const axisW = 58;
  const pw = Math.max(0, w - axisW);
  const rsiH = showRsi ? 70 : 0;
  const mainH = height;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: (e) => setCursor(e.nativeEvent.locationX),
    onPanResponderMove: (e) => setCursor(e.nativeEvent.locationX),
    onPanResponderRelease: () => setCursor(null),
    onPanResponderTerminate: () => setCursor(null),
  })).current;

  if (err) return <T v="small" color={t.down} style={{ padding: 12 }}>{err}</T>;
  if (!view || !w) return <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height: mainH + rsiH }}><Loading /></View>;

  const { cs } = view;
  const hi = Math.max(...cs.map((c) => c.h)), lo = Math.min(...cs.map((c) => c.l));
  const pad = (hi - lo) * 0.06 || hi * 0.01;
  const top = hi + pad, bot = lo - pad;
  const volH = mainH * 0.18;
  const y = (p: number) => ((top - p) / (top - bot)) * (mainH - 16) + 4;
  const cw = pw / cs.length;
  const x = (i: number) => i * cw + cw / 2;
  const maxV = Math.max(...cs.map((c) => c.v), 1);
  const line = (vals: (number | null)[]) => vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const ci = cursor == null ? null : Math.max(0, Math.min(cs.length - 1, Math.floor(cursor / cw)));
  const shown = ci != null ? cs[ci] : cs[cs.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top - (top - bot) * f * 0.97);
  const last = cs[cs.length - 1];
  const rY = (v: number) => mainH + 6 + ((100 - v) / 100) * (rsiH - 12);
  const lastRsi = view.rsi[view.rsi.length - 1];

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Row gap={10} style={{ paddingHorizontal: 4, marginBottom: 4, flexWrap: "wrap" }}>
        <T v="tiny" color={t.muted}>O <T v="tiny">{fmtPrice(shown.o)}</T></T>
        <T v="tiny" color={t.muted}>H <T v="tiny">{fmtPrice(shown.h)}</T></T>
        <T v="tiny" color={t.muted}>L <T v="tiny">{fmtPrice(shown.l)}</T></T>
        <T v="tiny" color={t.muted}>C <T v="tiny" color={shown.c >= shown.o ? t.up : t.down}>{fmtPrice(shown.c)}</T></T>
        <T v="tiny" color="#f59e0b">MA20</T><T v="tiny" color="#3b82f6">MA50</T>
        {source === "sim" && <T v="tiny" color={t.warn}>SIMULATED</T>}
      </Row>
      <View {...responder.panHandlers}>
        <Svg width={w} height={mainH + rsiH}>
          {ticks.map((p, i) => (
            <Line key={i} x1={0} x2={pw} y1={y(p)} y2={y(p)} stroke={t.grid} strokeWidth={1} />
          ))}
          {ticks.map((p, i) => <SvgText key={`l${i}`} x={pw + 4} y={y(p) + 4} fontSize={9} fill={t.muted}>{fmtPrice(p)}</SvgText>)}
          {cs.map((c, i) => (
            <Rect key={`v${i}`} x={x(i) - cw * 0.35} y={mainH - (c.v / maxV) * volH} width={Math.max(1, cw * 0.7)} height={(c.v / maxV) * volH} fill={(c.c >= c.o ? t.up : t.down) + "40"} />
          ))}
          {cs.map((c, i) => (
            <Path key={i} d={`M${x(i)},${y(c.h)}L${x(i)},${y(c.l)}`} stroke={c.c >= c.o ? t.up : t.down} strokeWidth={1} />
          ))}
          {cs.map((c, i) => {
            const col = c.c >= c.o ? t.up : t.down;
            return <Rect key={`b${i}`} x={x(i) - cw * 0.35} y={y(Math.max(c.o, c.c))} width={Math.max(1, cw * 0.7)} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} fill={col} />;
          })}
          <Polyline points={line(view.ma20)} fill="none" stroke="#f59e0b" strokeWidth={1.3} />
          <Polyline points={line(view.ma50)} fill="none" stroke="#3b82f6" strokeWidth={1.3} />
          <Line x1={0} x2={pw} y1={y(last.c)} y2={y(last.c)} stroke={last.c >= last.o ? t.up : t.down} strokeDasharray="3,3" strokeWidth={1} />
          <Rect x={pw + 1} y={y(last.c) - 8} width={axisW - 2} height={16} rx={3} fill={last.c >= last.o ? t.up : t.down} />
          <SvgText x={pw + 4} y={y(last.c) + 4} fontSize={9.5} fill="#fff" fontWeight="bold">{fmtPrice(last.c)}</SvgText>
          {showRsi && (
            <>
              <Line x1={0} x2={pw} y1={mainH + 2} y2={mainH + 2} stroke={t.border} />
              <Line x1={0} x2={pw} y1={rY(70)} y2={rY(70)} stroke={t.down} strokeDasharray="3,3" strokeWidth={0.8} />
              <Line x1={0} x2={pw} y1={rY(30)} y2={rY(30)} stroke={t.up} strokeDasharray="3,3" strokeWidth={0.8} />
              <Polyline points={view.rsi.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${rY(v).toFixed(1)}`)).filter(Boolean).join(" ")} fill="none" stroke="#7c3aed" strokeWidth={1.3} />
              <SvgText x={4} y={mainH + 14} fontSize={9.5} fill={t.muted}>RSI (14) {lastRsi?.toFixed(2)}</SvgText>
              <SvgText x={pw + 4} y={rY(70) + 3} fontSize={9} fill={t.muted}>70</SvgText>
              <SvgText x={pw + 4} y={rY(30) + 3} fontSize={9} fill={t.muted}>30</SvgText>
            </>
          )}
          {ci != null && <Line x1={x(ci)} x2={x(ci)} y1={0} y2={mainH + rsiH} stroke={t.muted} strokeDasharray="2,3" />}
        </Svg>
      </View>
    </View>
  );
}

export function LineChartSimple({ data, height = 160, color }: { data: { t: number; v: number }[]; height?: number; color?: string }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  if (data.length < 2) return <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}><T v="small" color={t.muted}>Not enough data yet.</T></View>;
  const vs = data.map((d) => d.v);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * (w - 2) + 1},${height - 4 - ((v - min) / span) * (height - 8)}`).join(" ");
  const c = color ?? (vs[vs.length - 1] >= vs[0] ? t.up : t.down);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && <Svg width={w} height={height}><Polyline points={pts} fill="none" stroke={c} strokeWidth={2} /></Svg>}
      <Row style={{ justifyContent: "space-between" }}><T v="tiny" color={t.muted}>{fmtPrice(min, 2)}</T><T v="tiny" color={t.muted}>{fmtPrice(max, 2)}</T></Row>
    </View>
  );
}
