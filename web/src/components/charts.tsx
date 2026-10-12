import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type LogicalRange, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { get } from "../api/client";
import { useUi } from "../store/ui";
import { useQuote } from "../lib/hooks";
import { fmtPrice, fmtCompact } from "../lib/format";
import type { Candle } from "../lib/types";
import { Skeleton } from "./ui";

const STEP: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400, "1W": 604800 };
export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1D", "1W"];

export type IndicatorKey = "ma20" | "ma50" | "ma200" | "ema21" | "bb" | "vwap" | "volume" | "rsi" | "macd";
export const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  ma20: "MA 20", ma50: "MA 50", ma200: "MA 200", ema21: "EMA 21", bb: "Bollinger Bands (20, 2)", vwap: "VWAP", volume: "Volume", rsi: "RSI (14)", macd: "MACD (12, 26, 9)",
};
const IND_COLORS = { ma20: "#f59e0b", ma50: "#3b82f6", ma200: "#a855f7", ema21: "#ec4899", bb: "#14b8a6", vwap: "#64748b" };

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function themeOptions() {
  return {
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
    grid: { vertLines: { color: css("--chart-grid") }, horzLines: { color: css("--chart-grid") } },
    rightPriceScale: { borderColor: css("--border") },
    timeScale: { borderColor: css("--border"), timeVisible: true, secondsVisible: false },
    crosshair: { mode: CrosshairMode.Normal },
    localization: { locale: "en-US", priceFormatter: (p: number) => fmtPrice(p) },
  };
}

type Line = (number | null)[];
interface IndData { t: number[]; [k: string]: any }

const toLine = (t: number[], vals: Line) => vals.map((v, i) => (v == null ? { time: t[i] as UTCTimestamp } : { time: t[i] as UTCTimestamp, value: v }));

export function CandleChart({ symbol, interval, indicators, height = 340, compact = false }: {
  symbol: string; interval: string; indicators: Set<IndicatorKey>; height?: number; compact?: boolean;
}) {
  const theme = useUi((s) => s.theme);
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const charts = useRef<IChartApi[]>([]);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastBar = useRef<Candle | null>(null);
  const [data, setData] = useState<{ candles: Candle[]; ind: IndData; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legend, setLegend] = useState<Candle | null>(null);
  const quote = useQuote(symbol);

  const showRsi = indicators.has("rsi");
  const showMacd = indicators.has("macd");
  const paneH = compact ? 70 : 90;

  // load data (and refresh periodically so indicators stay current)
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    const load = async () => {
      try {
        const names = "sma20,sma50,sma200,ema21,bollinger,vwap,rsi,macd";
        const [h, ind] = await Promise.all([
          get(`/api/market/history/${encodeURIComponent(symbol)}`, { interval, limit: 400 }),
          get(`/api/market/indicators/${encodeURIComponent(symbol)}`, { interval, limit: 400, names }),
        ]);
        if (alive) setData({ candles: h.candles, ind, source: h.source });
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, Math.max(30_000, Math.min(STEP[interval] * 1000, 300_000)));
    return () => { alive = false; clearInterval(id); };
  }, [symbol, interval]);

  // build charts
  useEffect(() => {
    if (!data || !mainRef.current) return;
    const opts = themeOptions();
    const up = css("--up"), down = css("--down");
    const main = createChart(mainRef.current, { ...opts, height, autoSize: true });
    const all: IChartApi[] = [main];
    const cs = main.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: "price", precision: decimals(data.candles), minMove: 1 / 10 ** decimals(data.candles) } });
    cs.setData(data.candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    candleSeries.current = cs;
    lastBar.current = data.candles[data.candles.length - 1] ?? null;
    const t = data.ind.t as number[];

    if (indicators.has("volume")) {
      const vs = main.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      main.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vs.setData(data.candles.map((c) => ({ time: c.t as UTCTimestamp, value: c.v, color: c.c >= c.o ? up + "55" : down + "55" })));
      volSeries.current = vs;
    } else volSeries.current = null;

    const line = (vals: Line, color: string, width = 1.5, style = LineStyle.Solid) => {
      const s = main.addLineSeries({ color, lineWidth: width as any, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(toLine(t, vals));
    };
    if (indicators.has("ma20")) line(data.ind.sma20, IND_COLORS.ma20);
    if (indicators.has("ma50")) line(data.ind.sma50, IND_COLORS.ma50);
    if (indicators.has("ma200")) line(data.ind.sma200, IND_COLORS.ma200);
    if (indicators.has("ema21")) line(data.ind.ema21, IND_COLORS.ema21);
    if (indicators.has("vwap")) line(data.ind.vwap, IND_COLORS.vwap, 1, LineStyle.Dashed);
    if (indicators.has("bb")) {
      line(data.ind.bollinger.upper, IND_COLORS.bb, 1);
      line(data.ind.bollinger.middle, IND_COLORS.bb + "99", 1, LineStyle.Dotted);
      line(data.ind.bollinger.lower, IND_COLORS.bb, 1);
    }

    const pane = (el: HTMLDivElement) => {
      const c = createChart(el, { ...opts, height: paneH, autoSize: true, timeScale: { ...opts.timeScale, visible: false } });
      all.push(c);
      return c;
    };
    if (showRsi && rsiRef.current) {
      const c = pane(rsiRef.current);
      const s = c.addLineSeries({ color: "#7c3aed", lineWidth: 1.5 as any, priceLineVisible: false });
      s.setData(toLine(t, data.ind.rsi));
      s.createPriceLine({ price: 70, color: css("--down"), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: 30, color: css("--up"), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      c.priceScale("right").applyOptions({ autoScale: false, scaleMargins: { top: 0.1, bottom: 0.1 } });
      s.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    }
    if (showMacd && macdRef.current) {
      const c = pane(macdRef.current);
      const m = data.ind.macd;
      const hs = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      hs.setData(m.hist.map((v: number | null, i: number) => (v == null ? { time: t[i] as UTCTimestamp } : { time: t[i] as UTCTimestamp, value: v, color: v >= 0 ? up + "aa" : down + "aa" })));
      c.addLineSeries({ color: "#2563eb", lineWidth: 1.5 as any, priceLineVisible: false, lastValueVisible: false }).setData(toLine(t, m.macd));
      c.addLineSeries({ color: "#f59e0b", lineWidth: 1.5 as any, priceLineVisible: false, lastValueVisible: false }).setData(toLine(t, m.signal));
    }

    // sync panes
    const sync = (src: IChartApi) => (r: LogicalRange | null) => r && all.forEach((c) => c !== src && c.timeScale().setVisibleLogicalRange(r));
    all.forEach((c) => c.timeScale().subscribeVisibleLogicalRangeChange(sync(c)));
    const visible = Math.min(data.candles.length, compact ? 90 : 140);
    main.timeScale().setVisibleLogicalRange({ from: data.candles.length - visible, to: data.candles.length + 3 });

    main.subscribeCrosshairMove((p) => {
      if (!p.time) { setLegend(null); return; }
      const bar = p.seriesData.get(cs) as any;
      if (bar) setLegend({ t: p.time as number, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: 0 });
    });
    charts.current = all;
    return () => { all.forEach((c) => c.remove()); charts.current = []; candleSeries.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, [...indicators].sort().join(), height, theme]);

  // live updates from websocket ticks
  useEffect(() => {
    const cs = candleSeries.current;
    const last = lastBar.current;
    if (!cs || !last || !quote) return;
    const step = STEP[interval];
    const now = Math.floor(quote.ts);
    let bar: Candle;
    if (step < 86400 && now >= last.t + step) {
      const t0 = now - (now % step);
      bar = { t: t0, o: last.c, h: Math.max(last.c, quote.price), l: Math.min(last.c, quote.price), c: quote.price, v: 0 };
    } else {
      bar = { ...last, c: quote.price, h: Math.max(last.h, quote.price), l: Math.min(last.l, quote.price) };
    }
    lastBar.current = bar;
    try {
      cs.update({ time: bar.t as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c });
    } catch { /* out-of-order tick, ignore */ }
  }, [quote?.price, quote?.ts, interval]);

  const shown = legend ?? lastBar.current;
  return (
    <div>
      {error && <div className="notice error" style={{ margin: 12 }}>{error}</div>}
      {!data && !error && <Skeleton h={height} style={{ margin: 12, width: "calc(100% - 24px)" }} />}
      <div className="chart-wrap" style={{ display: data ? "block" : "none" }}>
        {shown && (
          <div className="chart-legend">
            <span className="muted">O <b className="num">{fmtPrice(shown.o)}</b></span>
            <span className="muted">H <b className="num">{fmtPrice(shown.h)}</b></span>
            <span className="muted">L <b className="num">{fmtPrice(shown.l)}</b></span>
            <span className="muted">C <b className={`num ${shown.c >= shown.o ? "up" : "down"}`}>{fmtPrice(shown.c)}</b></span>
            {(["ma20", "ma50", "ma200", "ema21", "bb", "vwap"] as const).filter((k) => indicators.has(k)).map((k) => (
              <span key={k} style={{ color: IND_COLORS[k] }}>{INDICATOR_LABELS[k].split(" (")[0]}</span>
            ))}
            {data?.source === "sim" && <span className="chip warn" title="Live providers unreachable; showing simulated fallback data">Simulated</span>}
          </div>
        )}
        <div ref={mainRef} style={{ height }} />
        {showRsi && (
          <div className="chart-wrap" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="pane-label">RSI (14) <span style={{ color: "#7c3aed" }}>{lastValue(data?.ind.rsi)?.toFixed(2)}</span></div>
            <div ref={rsiRef} style={{ height: paneH }} />
          </div>
        )}
        {showMacd && (
          <div className="chart-wrap" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="pane-label">MACD (12, 26, 9) <span style={{ color: "#2563eb" }}>{lastValue(data?.ind.macd?.macd)?.toFixed(4)}</span></div>
            <div ref={macdRef} style={{ height: paneH }} />
          </div>
        )}
      </div>
    </div>
  );
}

function lastValue(a?: Line): number | undefined {
  if (!a) return undefined;
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i] as number;
  return undefined;
}

function decimals(c: Candle[]): number {
  const p = c.length ? c[c.length - 1].c : 1;
  return p >= 1000 ? 2 : p >= 10 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 8;
}

export function LineChart({ series, height = 220, area = true, percent = false }: {
  series: { name: string; color?: string; data: { t: number; v: number }[] }[]; height?: number; area?: boolean; percent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useUi((s) => s.theme);
  const key = useMemo(() => series.map((s) => s.name + s.data.length + (s.data[s.data.length - 1]?.v ?? "")).join("|"), [series]);
  useEffect(() => {
    if (!ref.current) return;
    const c = createChart(ref.current, { ...themeOptions(), height, autoSize: true });
    series.forEach((s, i) => {
      const color = s.color || ["#2563eb", "#94a3b8", "#f59e0b", "#16a34a"][i % 4];
      const pts = dedupe(s.data).map((p) => ({ time: p.t as UTCTimestamp, value: p.v }));
      const fmt = percent ? { type: "custom" as const, formatter: (v: number) => `${v.toFixed(2)}%` } : { type: "price" as const, precision: 2, minMove: 0.01 };
      const ser = area && i === 0
        ? c.addAreaSeries({ lineColor: color, topColor: color + "40", bottomColor: color + "05", lineWidth: 2, priceFormat: fmt })
        : c.addLineSeries({ color, lineWidth: (i === 0 ? 2 : 1.5) as any, priceFormat: fmt, lineStyle: i === 0 ? LineStyle.Solid : LineStyle.Dashed });
      ser.setData(pts);
    });
    c.timeScale().fitContent();
    return () => c.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, height, theme]);
  return <div ref={ref} style={{ height }} />;
}

function dedupe(d: { t: number; v: number }[]) {
  const m = new Map<number, number>();
  for (const p of d) m.set(Math.floor(p.t), p.v);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

export function Histogram({ bins, height = 140 }: { bins: { from: number; to: number; count: number }[]; height?: number }) {
  const max = Math.max(...bins.map((b) => b.count), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height }}>
        {bins.map((b, i) => (
          <div key={i} title={`${fmtCompact(b.from)} to ${fmtCompact(b.to)}: ${b.count}`}
            style={{ flex: 1, height: `${(b.count / max) * 100}%`, background: b.to <= 0 ? "var(--down)" : b.from >= 0 ? "var(--up)" : "var(--faint)", opacity: 0.8, borderRadius: "2px 2px 0 0" }} />
        ))}
      </div>
      <div className="row between tiny muted mt-8"><span>{fmtCompact(bins[0]?.from)}</span><span>0</span><span>{fmtCompact(bins[bins.length - 1]?.to)}</span></div>
    </div>
  );
}
