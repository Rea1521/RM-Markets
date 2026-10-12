import { create } from "zustand";
import { MarketSocket, type WsStatus } from "../api/ws";
import { WS_URL } from "../api/config";
import { useAuth } from "./auth";
import type { Quote } from "../lib/types";

interface MarketState {
  quotes: Record<string, Quote>;
  flashes: Record<string, "up" | "down">;
  status: WsStatus;
  retryIn?: number;
  upsert: (q: Quote[]) => void;
}

export const useMarket = create<MarketState>((set) => ({
  quotes: {},
  flashes: {},
  status: "closed",
  upsert: (qs) =>
    set((s) => {
      const quotes = { ...s.quotes };
      const flashes = { ...s.flashes };
      for (const q of qs) {
        const prev = quotes[q.symbol];
        if (prev && prev.price !== q.price) flashes[q.symbol] = q.price > prev.price ? "up" : "down";
        quotes[q.symbol] = q;
      }
      return { quotes, flashes };
    }),
}));

type EventHandler = (msg: any) => void;
const privateHandlers = new Set<EventHandler>();
export const onPrivateEvent = (fn: EventHandler) => { privateHandlers.add(fn); return () => { privateHandlers.delete(fn); }; };

// batch ticks into one state update per animation frame
let pending: Quote[] = [];
let scheduled = false;
function queue(q: Quote) {
  pending.push(q);
  if (!scheduled) {
    scheduled = true;
    const flush = () => { scheduled = false; const b = pending; pending = []; useMarket.getState().upsert(b); };
    typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(flush) : setTimeout(flush, 16);
  }
}

export const socket = new MarketSocket({
  url: WS_URL,
  getToken: () => useAuth.getState().accessToken,
  onStatus: (status, info) => useMarket.setState({ status, retryIn: info.nextRetryMs }),
});

socket.on((msg) => {
  if (msg.type === "tick") queue(msg as Quote);
  else if (msg.type === "snapshot") useMarket.getState().upsert(msg.quotes);
  else if (["order_filled", "order_rejected", "price_alert", "margin_call", "competition"].includes(msg.type)) privateHandlers.forEach((h) => h(msg));
});

useAuth.subscribe((s, prev) => { if (s.accessToken !== prev.accessToken) socket.reauth(); });
