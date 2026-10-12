import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { del, get, post } from "../api/client";
import { fmtPct, fmtPrice, fmtQty, fmtUsd } from "../lib/format";
import { toast, useUi } from "../store/ui";
import { I } from "./Icons";
import { Modal } from "./ui";

type Intent = any;

function speak(text?: string | null) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/** Hands-free trading: Web Speech API -> /api/voice/parse -> confirm -> execute. */
export function VoiceButton() {
  const nav = useNavigate();
  const accountId = useUi((s) => s.accountId);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [pending, setPending] = useState<Intent | null>(null);
  const [typed, setTyped] = useState("");
  const [showTyped, setShowTyped] = useState(false);
  const recRef = useRef<any>(null);

  const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

  const handle = async (text: string) => {
    if (!text.trim()) return;
    let intent: Intent;
    try {
      intent = await post("/api/voice/parse", { text });
    } catch (e) {
      toast({ kind: "error", title: "Voice command failed", body: (e as Error).message });
      return;
    }
    switch (intent.intent) {
      case "navigate": nav(intent.route); speak(intent.speech); break;
      case "show_chart": nav(`/market/${intent.symbol}`); speak(intent.speech); break;
      case "get_quote": {
        const q = await get(`/api/market/quote/${intent.symbol}`);
        const msg = `${q.display} is at ${fmtPrice(q.price)}, ${q.change_pct >= 0 ? "up" : "down"} ${Math.abs(q.change_pct).toFixed(2)} percent today`;
        toast({ kind: "info", title: `${q.display} ${fmtPrice(q.price)}`, body: fmtPct(q.change_pct) });
        speak(msg);
        break;
      }
      case "account_summary": {
        const a = await get("/api/trading/account", { account_id: accountId ?? undefined });
        const msg = `Equity ${fmtUsd(a.equity, 0)}. Total profit and loss ${fmtUsd(a.total_pnl, 0)}. Buying power ${fmtUsd(a.buying_power, 0)}.`;
        toast({ kind: "info", title: "Account", body: msg });
        speak(msg);
        break;
      }
      case "create_alert":
        await post("/api/trading/alerts", { symbol: intent.symbol, condition: intent.condition, price: intent.price });
        toast({ kind: "success", title: intent.speech });
        speak(intent.speech);
        break;
      case "place_order": case "close_position": case "close_all": case "cancel_orders":
        if (intent.missing?.length) { toast({ kind: "error", title: "Need more details", body: intent.speech }); speak(intent.speech); break; }
        setPending(intent);
        speak(intent.speech + ". Please confirm.");
        break;
      default:
        toast({ kind: "info", title: "Didn't catch that", body: intent.speech });
        speak(intent.speech);
    }
  };

  const start = () => {
    if (!SR) { setShowTyped(true); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const t = Array.from(e.results).map((r: any) => r[0].transcript).join(" ");
      setTranscript(t);
      if (e.results[e.results.length - 1].isFinal) handle(t);
    };
    rec.onerror = (e: any) => { setListening(false); if (e.error !== "no-speech") toast({ kind: "error", title: "Microphone error", body: e.error }); };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setTranscript("");
    setListening(true);
    rec.start();
  };

  const confirm = async () => {
    const it = pending;
    setPending(null);
    try {
      if (it.intent === "place_order") {
        const o = await post("/api/trading/orders", { ...it.order, source: "voice", account_id: accountId ?? undefined });
        toast({ kind: "success", title: `Voice order ${o.status}`, body: `${o.side} ${fmtQty(o.qty)} ${o.display}${o.filled_price ? ` @ ${fmtPrice(o.filled_price)}` : ""}` });
        speak(`Order ${o.status}`);
      } else if (it.intent === "close_position") {
        await post(`/api/trading/positions/${it.symbol}/close`, { account_id: accountId ?? undefined });
        toast({ kind: "success", title: "Position closed" });
      } else if (it.intent === "close_all") {
        await post("/api/trading/positions/close-all", {}, { account_id: accountId ?? undefined });
        toast({ kind: "success", title: "All positions closed" });
      } else if (it.intent === "cancel_orders") {
        const r = await del("/api/trading/orders", { symbol: it.symbol ?? undefined, account_id: accountId ?? undefined });
        toast({ kind: "success", title: `Cancelled ${r.cancelled} orders` });
      }
    } catch (e) {
      toast({ kind: "error", title: "Voice order rejected", body: (e as Error).message });
      speak("The order was rejected");
    }
  };

  return (
    <>
      <button className="icon-btn" onClick={listening ? () => recRef.current?.stop() : start} title="Voice commands (try “buy 2 Apple”)" aria-label="Voice command">
        <I.mic style={{ color: listening ? "var(--down)" : undefined }} />
      </button>
      {listening && (
        <div className="voice-live"><span className="pulse" /><span>{transcript || "Listening… try “buy 0.1 bitcoin” or “show Tesla chart”"}</span></div>
      )}
      <Modal open={showTyped} onClose={() => setShowTyped(false)} title="Voice commands">
        <p className="muted small">Speech recognition isn't available in this browser (Chrome, Edge and Safari support it). You can type the same command:</p>
        <form onSubmit={(e) => { e.preventDefault(); setShowTyped(false); handle(typed); setTyped(""); }} className="row">
          <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="buy 10 tesla at 240" />
          <button className="btn primary">Run</button>
        </form>
      </Modal>
      <Modal open={!!pending} onClose={() => setPending(null)} title="Confirm voice command">
        {pending?.intent === "place_order" && (
          <div className="col gap-12">
            <div className="notice">“{pending.transcript}”</div>
            <dl className="kv">
              <dt>Action</dt><dd className={pending.order.side === "buy" ? "up" : "down"}>{pending.order.side.toUpperCase()}</dd>
              <dt>Symbol</dt><dd>{pending.order.symbol}</dd>
              <dt>Quantity</dt><dd>{pending.order.qty}</dd>
              <dt>Type</dt><dd>{pending.order.type}{pending.order.limit_price ? ` @ ${pending.order.limit_price}` : ""}</dd>
              {pending.order.stop_loss && <><dt>Stop loss</dt><dd>{pending.order.stop_loss}</dd></>}
              {pending.order.take_profit && <><dt>Take profit</dt><dd>{pending.order.take_profit}</dd></>}
            </dl>
          </div>
        )}
        {pending && pending.intent !== "place_order" && <p>{pending.speech}</p>}
        <div className="row mt-16" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setPending(null)}>Cancel</button>
          <button className="btn primary" onClick={confirm}>Confirm</button>
        </div>
      </Modal>
    </>
  );
}
