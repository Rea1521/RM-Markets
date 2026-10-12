import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { I } from "./Icons";
import { useMarket } from "../store/market";
import { useUi } from "../store/ui";
import { baseAsset, fmtPct, fmtPrice, pnlClass } from "../lib/format";
import type { Quote } from "../lib/types";

export function Card({ title, actions, children, className = "", pad = true, style }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; style?: React.CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

const COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#627eea", SOL: "#14f195", BNB: "#f3ba2f", XRP: "#23292f", ADA: "#0033ad", DOGE: "#c2a633", AVAX: "#e84142",
  LINK: "#2a5ada", DOT: "#e6007a", AAPL: "#111", TSLA: "#e31937", MSFT: "#00a4ef", NVDA: "#76b900", GOOGL: "#4285f4", AMZN: "#ff9900",
  META: "#0866ff", NFLX: "#e50914", AMD: "#ed1c24", XAU: "#d4a017", XAG: "#9ca3af", "NIFTY 50": "#ff6f00",
};

export function SymbolIcon({ symbol, display, size = 24 }: { symbol: string; display?: string; size?: number }) {
  const b = baseAsset(display || symbol);
  const color = COLORS[b] || COLORS[symbol] || `hsl(${[...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 55% 45%)`;
  const label = b.replace(/[^A-Z0-9]/gi, "").slice(0, b.length > 4 ? 3 : 4);
  return <span className="sym-icon" style={{ background: color, width: size, height: size, fontSize: size * 0.36 }}>{label}</span>;
}

export function SymbolCell({ q, symbol, display, name }: { q?: Quote; symbol: string; display?: string; name?: string }) {
  return (
    <div className="sym">
      <SymbolIcon symbol={symbol} display={display ?? q?.display} />
      <div className="col" style={{ gap: 0, minWidth: 0 }}>
        <span className="sym-name">{display ?? q?.display ?? symbol}</span>
        {(name ?? q?.name) && <span className="sym-sub truncate">{name ?? q?.name}</span>}
      </div>
    </div>
  );
}

export function LivePrice({ symbol, price, className = "" }: { symbol: string; price?: number; className?: string }) {
  const flash = useMarket((s) => s.flashes[symbol]);
  const [k, setK] = useState(0);
  const prev = useRef(price);
  useEffect(() => { if (price !== prev.current) { prev.current = price; setK((x) => x + 1); } }, [price]);
  return <span key={k} className={`num ${k ? (flash === "up" ? "flash-up" : "flash-down") : ""} ${className}`}>{fmtPrice(price)}</span>;
}

export function Change({ v, className = "" }: { v?: number | null; className?: string }) {
  return <span className={`num ${pnlClass(v)} ${className}`}>{fmtPct(v)}</span>;
}

export function Sparkline({ data, width = 90, height = 28, color }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  const c = color || (data[data.length - 1] >= data[0] ? "var(--up)" : "var(--down)");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export const PALETTE = ["#2563eb", "#7c3aed", "#f59e0b", "#14b8a6", "#ef4444", "#64748b", "#ec4899"];

export function Donut({ items, size = 120, thickness = 16, center }: { items: { label: string; value: number; color?: string }[]; size?: number; thickness?: number; center?: ReactNode }) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {items.map((it, i) => {
          const len = (Math.max(0, it.value) / total) * C;
          const el = (
            <circle key={it.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={it.color || PALETTE[i % PALETTE.length]}
              strokeWidth={thickness} strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} />
          );
          off += len;
          return el;
        })}
      </svg>
      {center && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{center}</div>}
    </div>
  );
}

export function Bars({ data, height = 120, color }: { data: { label: string; value: number }[]; height?: number; color?: (v: number) => string }) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1e-9);
  const hasNeg = data.some((d) => d.value < 0);
  return (
    <div style={{ display: "flex", alignItems: hasNeg ? "center" : "flex-end", gap: 2, height }}>
      {data.map((d, i) => {
        const h = (Math.abs(d.value) / max) * (hasNeg ? height / 2 : height);
        return (
          <div key={i} title={`${d.label}: ${d.value.toFixed(2)}`} style={{ flex: 1, height, display: "flex", flexDirection: "column", justifyContent: hasNeg ? (d.value >= 0 ? "flex-start" : "flex-end") : "flex-end" }}>
            {hasNeg && d.value < 0 && <div style={{ height: height / 2 }} />}
            <div style={{ height: Math.max(1, h), background: color ? color(d.value) : d.value >= 0 ? "var(--up)" : "var(--down)", borderRadius: 2, opacity: 0.85 }} />
            {hasNeg && d.value >= 0 && <div style={{ height: height / 2 }} />}
          </div>
        );
      })}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} role="dialog" aria-modal>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><I.x /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <div className="bold">{t.title}</div>
          {t.body && <div className="muted small">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon = "layers", children }: { icon?: keyof typeof I; children: ReactNode }) {
  const Ico = I[icon];
  return <div className="empty"><Ico /><div>{children}</div></div>;
}

export function Skeleton({ h = 16, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export function ErrorNote({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice error row between">
      <span>{error.message}</span>
      {onRetry && <button className="btn xs" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, blue }: { value: T; options: (T | { value: T; label: ReactNode })[]; onChange: (v: T) => void; blue?: boolean }) {
  return (
    <div className={`seg ${blue ? "blue" : ""}`}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return <button key={v} className={v === value ? "active" : ""} onClick={() => onChange(v)} type="button">{l}</button>;
      })}
    </div>
  );
}

export function useGoSymbol() {
  const nav = useNavigate();
  return (symbol: string) => nav(`/market/${encodeURIComponent(symbol)}`);
}

export function ConnPill() {
  const status = useMarket((s) => s.status);
  const retryIn = useMarket((s) => s.retryIn);
  const color = status === "open" ? "var(--up)" : status === "offline" ? "var(--down)" : "var(--warn)";
  const label = status === "open" ? "Live" : status === "offline" ? "Offline" : status === "reconnecting" ? `Reconnecting${retryIn ? ` in ${Math.ceil(retryIn / 1000)}s` : "…"}` : "Connecting…";
  return <span className="conn-pill" title="Real-time WebSocket connection"><span className="status-dot" style={{ background: color }} />{label}</span>;
}
