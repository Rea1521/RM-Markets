export function decimalsFor(price: number): number {
  const a = Math.abs(price);
  if (a >= 1000) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  return 8;
}

export const fmtPrice = (p: number | null | undefined, d?: number) =>
  p == null || !isFinite(p) ? "—" : p.toLocaleString("en-US", { minimumFractionDigits: d ?? decimalsFor(p), maximumFractionDigits: d ?? decimalsFor(p) });

export const fmtUsd = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtSignedUsd = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPct = (v: number | null | undefined, d = 2, signed = true) =>
  v == null || !isFinite(v) ? "—" : `${signed && v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

export const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? "—" : (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toLocaleString("en-US", { maximumFractionDigits: d });

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

export const fmtQty = (q: number) => (Math.abs(q) >= 1000 ? fmtNum(q, 0) : Number(q.toPrecision(8)).toString());

export function timeAgo(ts: number | string): string {
  const t = typeof ts === "string" ? Date.parse(ts) : ts * 1000;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const fmtDate = (ts: number | string, withTime = true) => {
  const d = typeof ts === "string" ? new Date(ts) : new Date(ts * 1000);
  return d.toLocaleString("en-US", withTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
};

export const pnlClass = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");

export function baseAsset(display: string): string {
  return display.includes("/") ? display.split("/")[0] : display;
}
