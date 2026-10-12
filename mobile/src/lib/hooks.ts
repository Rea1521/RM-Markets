import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api, ApiError, type Opts } from "./api";
import { onPrivateEvent, socket, useMarket } from "./market";
import { useAccountSel } from "./ui";
import type { AccountSummary, Quote } from "./types";

export function useApi<T>(path: string | null, opts: Opts & { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const ref = useRef(opts);
  ref.current = opts;
  const key = path + JSON.stringify(opts.params ?? {});
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    if (!silent) setLoading(true);
    try { setData(await api<T>(path, ref.current)); setError(null); }
    catch (e) { setError(e as ApiError); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    load();
    if (!opts.poll) return;
    const id = setInterval(() => AppState.currentState === "active" && load(true), opts.poll);
    return () => clearInterval(id);
  }, [load, opts.poll]);
  return { data, error, loading, reload: load };
}

export function useQuotes(symbols: string[]) {
  const key = symbols.join(",");
  useEffect(() => { if (symbols.length) socket.subscribe(symbols); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMarket((s) => s.quotes);
}

export function useQuote(symbol?: string): Quote | undefined {
  useEffect(() => { if (symbol) socket.subscribe([symbol]); }, [symbol]);
  return useMarket((s) => (symbol ? s.quotes[symbol] : undefined));
}

export function useAccount(poll = 6000) {
  const accountId = useAccountSel((s) => s.accountId);
  const r = useApi<AccountSummary>("/api/trading/account", { params: { account_id: accountId ?? undefined }, poll });
  useEffect(() => onPrivateEvent(() => r.reload(true)), [r.reload]);
  return r;
}
