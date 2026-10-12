import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type RequestOpts } from "../api/client";
import { socket, useMarket, onPrivateEvent } from "../store/market";
import { useUi } from "../store/ui";
import type { AccountSummary, Quote } from "./types";

export function useApi<T>(path: string | null, opts: RequestOpts & { poll?: number; deps?: unknown[] } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const key = path + JSON.stringify(opts.params ?? {}) + JSON.stringify(opts.body ?? null);

  const load = useCallback(async (silent = false) => {
    if (!path) return;
    if (!silent) setLoading(true);
    try {
      const d = await api<T>(path, optsRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e as ApiError);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
    if (!opts.poll) return;
    const id = setInterval(() => document.visibilityState === "visible" && load(true), opts.poll);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, opts.poll, ...(opts.deps ?? [])]);

  return { data, error, loading, reload: load, setData };
}

/** Subscribe to live quotes for the given symbols (via the shared websocket). */
export function useQuotes(symbols: string[]): Record<string, Quote> {
  const key = symbols.join(",");
  useEffect(() => {
    if (symbols.length) socket.subscribe(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMarket((s) => s.quotes);
}

export function useQuote(symbol: string | undefined): Quote | undefined {
  useEffect(() => { if (symbol) socket.subscribe([symbol]); }, [symbol]);
  return useMarket((s) => (symbol ? s.quotes[symbol] : undefined));
}

/** Account summary for the active account; refreshes on fills and every few seconds. */
export function useAccount(poll = 5000) {
  const accountId = useUi((s) => s.accountId);
  const res = useApi<AccountSummary>("/api/trading/account", { params: { account_id: accountId ?? undefined }, poll });
  useEffect(() => onPrivateEvent(() => res.reload(true)), [res.reload]);
  return res;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [q]);
  return m;
}
