import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Speech from "expo-speech";
import Svg, { Path, Rect } from "react-native-svg";
import { del, get, post } from "../lib/api";
import { fmtPrice, fmtUsd } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast, useAccountSel } from "../lib/ui";
import { Btn, Input, T } from "./ui";

/**
 * Hands-free trading. Uses expo-speech-recognition when the native module is present
 * (development / production builds). In Expo Go it falls back to a typed command box.
 */
let SR: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SR = require("expo-speech-recognition");
  if (!SR?.ExpoSpeechRecognitionModule?.start) SR = null;
} catch { SR = null; }

export function MicIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Rect x={9} y={3} width={6} height={11} rx={3} /><Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  );
}

export function VoiceButton() {
  const t = useTheme();
  const accountId = useAccountSel((s) => s.accountId);
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState("");
  const [showTyped, setShowTyped] = useState(false);
  const transcript = useRef("");

  useEffect(() => {
    if (!SR) return;
    const m = SR.ExpoSpeechRecognitionModule;
    const subs = [
      m.addListener("result", (e: any) => {
        transcript.current = e.results?.[0]?.transcript ?? "";
        if (e.isFinal) { setListening(false); handle(transcript.current); }
      }),
      m.addListener("end", () => setListening(false)),
      m.addListener("error", (e: any) => { setListening(false); if (e.error !== "no-speech") toast({ kind: "error", title: "Voice error", body: e.message }); }),
    ];
    return () => subs.forEach((s: any) => s?.remove?.());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (s?: string | null) => s && Speech.speak(s, { rate: 1.0 });

  const handle = async (text: string) => {
    if (!text.trim()) return;
    try {
      const it = await post("/api/voice/parse", { text });
      switch (it.intent) {
        case "navigate": {
          const map: Record<string, string> = { "/": "/", "/portfolio": "/portfolio", "/orders": "/orders", "/positions": "/portfolio", "/market": "/markets", "/watchlist": "/markets" };
          router.push((map[it.route] ?? `/${it.route.replace(/^\//, "")}`) as any);
          say(it.speech);
          break;
        }
        case "show_chart": router.push(`/symbol/${it.symbol}`); say(it.speech); break;
        case "get_quote": {
          const q = await get(`/api/market/quote/${it.symbol}`);
          toast({ kind: "info", title: `${q.display} ${fmtPrice(q.price)}`, body: `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}% today` });
          say(`${q.display} is at ${fmtPrice(q.price)}`);
          break;
        }
        case "account_summary": {
          const a = await get("/api/trading/account", { account_id: accountId ?? undefined });
          const msg = `Equity ${fmtUsd(a.equity, 0)}, profit and loss ${fmtUsd(a.total_pnl, 0)}`;
          toast({ kind: "info", title: "Account", body: msg }); say(msg);
          break;
        }
        case "create_alert":
          await post("/api/trading/alerts", { symbol: it.symbol, condition: it.condition, price: it.price });
          toast({ kind: "success", title: it.speech }); say(it.speech);
          break;
        case "place_order": case "close_position": case "close_all": case "cancel_orders":
          if (it.missing?.length) { toast({ kind: "error", title: it.speech }); say(it.speech); break; }
          say(`${it.speech}. Confirm?`);
          Alert.alert("Confirm voice command", `“${it.transcript}”\n\n${it.speech}`, [
            { text: "Cancel", style: "cancel" },
            { text: "Confirm", onPress: () => execute(it) },
          ]);
          break;
        default: toast({ kind: "info", title: "Didn't catch that", body: it.speech }); say(it.speech);
      }
    } catch (e) { toast({ kind: "error", title: "Voice command failed", body: (e as Error).message }); }
  };

  const execute = async (it: any) => {
    try {
      if (it.intent === "place_order") {
        const o = await post("/api/trading/orders", { ...it.order, source: "voice", account_id: accountId ?? undefined });
        toast({ kind: "success", title: `Order ${o.status}`, body: o.filled_price ? `@ ${fmtPrice(o.filled_price)}` : undefined });
        say(`Order ${o.status}`);
      } else if (it.intent === "close_position") await post(`/api/trading/positions/${it.symbol}/close`, { account_id: accountId ?? undefined });
      else if (it.intent === "close_all") await post("/api/trading/positions/close-all", {}, { account_id: accountId ?? undefined });
      else if (it.intent === "cancel_orders") await del("/api/trading/orders", { symbol: it.symbol ?? undefined, account_id: accountId ?? undefined });
      if (it.intent !== "place_order") toast({ kind: "success", title: "Done" });
    } catch (e) { toast({ kind: "error", title: "Rejected", body: (e as Error).message }); say("Rejected"); }
  };

  const start = async () => {
    if (!SR) { setShowTyped(true); return; }
    const m = SR.ExpoSpeechRecognitionModule;
    const perm = await m.requestPermissionsAsync();
    if (!perm.granted) { toast({ kind: "error", title: "Microphone permission denied" }); return; }
    transcript.current = "";
    setListening(true);
    m.start({ lang: "en-US", interimResults: true, continuous: false });
  };

  return (
    <>
      <Pressable onPress={listening ? () => SR?.ExpoSpeechRecognitionModule.stop() : start} hitSlop={10} accessibilityLabel="Voice command">
        <MicIcon color={listening ? t.down : t.text} />
      </Pressable>
      <Modal visible={showTyped} transparent animationType="fade" onRequestClose={() => setShowTyped(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: t.surface, borderRadius: 16, padding: 18, gap: 12 }}>
            <T v="h2">Voice command</T>
            <T v="small" color={t.muted}>Speech recognition needs a development or store build (it isn't included in Expo Go). Type the command instead:</T>
            <Input value={typed} onChangeText={setTyped} placeholder="buy 0.1 bitcoin" autoFocus onSubmitEditing={() => { setShowTyped(false); handle(typed); setTyped(""); }} />
            <Btn kind="primary" title="Run" onPress={() => { setShowTyped(false); handle(typed); setTyped(""); }} />
            <Btn kind="ghost" title="Cancel" onPress={() => setShowTyped(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
