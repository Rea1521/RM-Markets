import { AppState } from "react-native";
import { create } from "zustand";
import { WS_URL } from "./config";
import { useAuth } from "./auth";
import { MarketSocket, type WsStatus } from "./ws";
import type { Quote } from "./types";

interface MarketState { quotes: Record<string, Quote>; status: WsStatus; upsert: (q: Quote[]) => void }

export const useMarket = create<MarketState>((set) => ({
  quotes: {},
  status: "closed",
  upsert: (qs) => set((s) => {
    const quotes = { ...s.quotes };
    for (const q of qs) quotes[q.symbol] = q;
    return { quotes };
  }),
}));

type Handler = (m: any) => void;
const handlers = new Set<Handler>();
export const onPrivateEvent = (h: Handler) => { handlers.add(h); return () => { handlers.delete(h); }; };

let pending: Quote[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const flush = () => { timer = null; const b = pending; pending = []; useMarket.getState().upsert(b); };

export const socket = new MarketSocket({
  url: WS_URL,
  getToken: () => useAuth.getState().accessToken,
  onStatus: (status) => useMarket.setState({ status }),
});

socket.on((m) => {
  if (m.type === "tick") { pending.push(m); if (!timer) timer = setTimeout(flush, 250); } // batch to 4 renders/s on mobile
  else if (m.type === "snapshot") useMarket.getState().upsert(m.quotes);
  else if (["order_filled", "order_rejected", "price_alert", "margin_call", "competition"].includes(m.type)) handlers.forEach((h) => h(m));
});

useAuth.subscribe((s, p) => { if (s.accessToken !== p.accessToken) socket.reauth(); });

// reconnect immediately when the app comes back to the foreground
AppState.addEventListener("change", (st) => { if (st === "active") socket.wake(); });
