import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { MarketSocket } from "../lib/ws";

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

describe("MarketSocket", () => {
  beforeEach(() => { FakeWS.instances = []; jest.useFakeTimers(); return undefined; });
  afterEach(() => { jest.useRealTimers(); });

  const make = () => new MarketSocket({ url: "ws://x/ws", getToken: () => "tok", socketFactory: (u) => new FakeWS(u) as any });

  it("authenticates and resubscribes after reconnect", () => {
    const s = make();
    s.subscribe(["BTCUSDT"]);
    s.start();
    const a = FakeWS.instances[0];
    a.open();
    expect(a.sent).toEqual([{ op: "auth", token: "tok" }, { op: "subscribe", symbols: ["BTCUSDT"] }]);
    s.subscribe(["AAPL"]);
    expect(a.sent[a.sent.length - 1]).toEqual({ op: "subscribe", symbols: ["AAPL"] });
    a.close();
    expect(s.status).toBe("reconnecting");
    jest.advanceTimersByTime(1100);
    const b = FakeWS.instances[1];
    expect(b).toBeDefined();
    b.open();
    expect(b.sent[1]).toEqual({ op: "subscribe", symbols: ["BTCUSDT", "AAPL"] });
    s.stop();
  });

  it("backs off exponentially with a cap", () => {
    const s = new MarketSocket({ url: "x", maxBackoffMs: 30000 });
    for (let i = 0; i < 20; i++) {
      const d = s.nextDelay(i);
      const base = Math.min(30000, 1000 * 2 ** Math.min(i, 10));
      expect(d).toBeGreaterThanOrEqual(base / 2);
      expect(d).toBeLessThanOrEqual(base);
    }
  });

  it("recycles a silent connection via the heartbeat watchdog", () => {
    const s = make();
    s.start();
    const a = FakeWS.instances[0];
    a.open();
    a.msg({ type: "welcome", heartbeat: 2 });
    jest.advanceTimersByTime(4000);
    expect(a.readyState).toBe(1);
    jest.advanceTimersByTime(1500);
    expect(a.readyState).toBe(3);
    s.stop();
  });

  it("delivers messages to listeners", () => {
    const s = make();
    const got: any[] = [];
    s.on((m) => got.push(m));
    s.start();
    FakeWS.instances[0].open();
    FakeWS.instances[0].msg({ type: "tick", symbol: "BTCUSDT", price: 1 });
    expect(got[0].symbol).toBe("BTCUSDT");
    s.stop();
  });
});
