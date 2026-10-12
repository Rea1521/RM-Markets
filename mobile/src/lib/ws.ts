/**
 * Resilient WebSocket client:
 *  - exponential backoff with jitter (1s -> 30s cap), resets after a healthy connection
 *  - heartbeat watchdog: if nothing arrives for 2.5x the server heartbeat, force reconnect
 *  - re-authenticates and re-subscribes automatically after every reconnect
 *  - reacts to browser online/offline and tab visibility
 *  - token is sent in the first message, never in the URL
 */
export type WsStatus = "connecting" | "open" | "reconnecting" | "offline" | "closed";
type Listener = (msg: any) => void;

export interface WsOptions {
  url: string;
  getToken?: () => string | null | undefined;
  maxBackoffMs?: number;
  socketFactory?: (url: string) => WebSocket;
  onStatus?: (s: WsStatus, info: { attempt: number; nextRetryMs?: number }) => void;
}

export class MarketSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private symbols = new Set<string>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private heartbeatMs = 25_000;
  private stopped = false;
  private openedAt = 0;
  status: WsStatus = "closed";

  constructor(private opts: WsOptions) {}

  start() {
    this.stopped = false;
    if (hasDom()) {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (hasDom()) {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.ws?.close(1000, "client stop");
    this.ws = null;
    this.setStatus("closed");
  }

  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  subscribe(symbols: string[]) {
    const fresh = symbols.filter((s) => !this.symbols.has(s));
    symbols.forEach((s) => this.symbols.add(s));
    if (fresh.length) this.send({ op: "subscribe", symbols: fresh });
  }

  unsubscribe(symbols: string[]) {
    symbols.forEach((s) => this.symbols.delete(s));
    this.send({ op: "unsubscribe", symbols });
  }

  /** call after login/logout so private events follow the current user */
  reauth() { const t = this.opts.getToken?.(); if (t) this.send({ op: "auth", token: t }); }

  private send(msg: unknown) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    if (this.stopped) return;
    if (hasDom() && typeof navigator !== "undefined" && navigator.onLine === false) { this.setStatus("offline"); return; }
    this.setStatus(this.attempt ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try {
      ws = this.opts.socketFactory ? this.opts.socketFactory(this.opts.url) : new WebSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.openedAt = Date.now();
      this.setStatus("open");
      const t = this.opts.getToken?.();
      if (t) this.send({ op: "auth", token: t });
      if (this.symbols.size) this.send({ op: "subscribe", symbols: [...this.symbols] });
      this.armWatchdog();
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch { this.armWatchdog(); return; }
      if (msg.type === "welcome" && msg.heartbeat) this.heartbeatMs = msg.heartbeat * 1000;
      this.armWatchdog();
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      // a connection that stayed up > 10s counts as healthy: restart backoff from scratch
      if (Date.now() - this.openedAt > 10_000) this.attempt = 0;
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  nextDelay(attempt: number): number {
    const cap = this.opts.maxBackoffMs ?? 30_000;
    const base = Math.min(cap, 1000 * 2 ** Math.min(attempt, 10));
    return Math.round(base / 2 + Math.random() * (base / 2)); // "equal jitter"
  }

  private scheduleReconnect() {
    this.clearTimers();
    if (this.stopped) return;
    const delay = this.nextDelay(this.attempt);
    this.attempt += 1;
    this.setStatus("reconnecting", delay);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private armWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      // server went silent (half-open TCP, sleeping laptop...) -> recycle the socket
      this.ws?.close(4000, "heartbeat timeout");
    }, this.heartbeatMs * 2.5);
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.retryTimer = this.watchdog = null;
  }

  private setStatus(s: WsStatus, nextRetryMs?: number) {
    this.status = s;
    this.opts.onStatus?.(s, { attempt: this.attempt, nextRetryMs });
  }

  private onOnline = () => { this.attempt = 0; if (!this.ws) { this.clearTimers(); this.connect(); } };
  private onOffline = () => { this.setStatus("offline"); this.ws?.close(); };
  private onVisible = () => { if (document.visibilityState === "visible") this.wake(); };

  /** App returned to the foreground / network came back: reconnect immediately instead of waiting for backoff. */
  wake() {
    if (!this.ws && !this.stopped) { this.clearTimers(); this.attempt = 0; this.connect(); }
  }
}

function hasDom(): boolean {
  return typeof window !== "undefined" && typeof window.addEventListener === "function" && typeof document !== "undefined";
}
