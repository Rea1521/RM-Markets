import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { post } from "../lib/api";
import { useQuote } from "../lib/hooks";
import { baseAsset, fmtPrice, fmtQty, fmtUsd } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast, useAccountSel } from "../lib/ui";
import type { AccountSummary } from "../lib/types";
import { Btn, Chip, Input, KV, Row, Seg, T } from "./ui";

const TYPES = [{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }, { value: "stop", label: "Stop" }, { value: "trailing_stop", label: "Trailing" }] as const;

export function OrderSheet({ symbol, side: initialSide, visible, onClose, account, onPlaced }: {
  symbol: string; side: "buy" | "sell"; visible: boolean; onClose: () => void; account?: AccountSummary | null; onPlaced?: () => void;
}) {
  const t = useTheme();
  const q = useQuote(symbol);
  const accountId = useAccountSel((s) => s.accountId);
  const [side, setSide] = useState(initialSide);
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("market");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [trail, setTrail] = useState("2");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSide(initialSide); }, [initialSide, visible]);

  const base = q ? baseAsset(q.display) : symbol;
  const ccy = q?.display.includes("/") ? q.display.split("/")[1] : "USD";
  const ref = type === "limit" || type === "stop" ? Number(price) || q?.price || 0 : side === "buy" ? q?.ask ?? 0 : q?.bid ?? 0;
  const qty = ref ? Number(amount || 0) / ref : 0;
  const bp = q && account ? account.buying_power_by_class[q.asset_class] ?? 0 : 0;
  const pos = account?.positions.find((p) => p.symbol === symbol);

  const pct = (p: number) => {
    if (side === "sell" && pos && pos.qty > 0) setAmount((pos.qty * p * ref).toFixed(2));
    else setAmount((bp * p * (p === 1 ? 0.995 : 1)).toFixed(2));
  };

  const submit = async () => {
    if (qty <= 0) { toast({ kind: "error", title: "Enter an amount" }); return; }
    setBusy(true);
    try {
      const body: any = { symbol, side, qty: Number(qty.toPrecision(10)), type, source: "mobile", account_id: accountId ?? undefined };
      if (type === "limit") body.limit_price = Number(price);
      if (type === "stop") body.stop_price = Number(price);
      if (type === "trailing_stop") body.trail_percent = Number(trail);
      if (tp) body.take_profit = Number(tp);
      if (sl) body.stop_loss = Number(sl);
      const o = await post("/api/trading/orders", body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast({ kind: "success", title: o.status === "filled" ? `${side === "buy" ? "Bought" : "Sold"} ${fmtQty(o.qty)} ${base}` : "Order placed", body: o.filled_price ? `@ ${fmtPrice(o.filled_price)}` : `#${o.id} working` });
      setAmount(""); setTp(""); setSl("");
      onPlaced?.();
      onClose();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast({ kind: "error", title: "Order rejected", body: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
            <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.border }} />
            <Row style={{ justifyContent: "space-between" }}>
              <T v="h2">{q?.display ?? symbol}</T>
              <T v="h2">{fmtPrice(q?.price)}</T>
            </Row>
            <Seg value={side} onChange={setSide} options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
            <Row gap={6} style={{ flexWrap: "wrap" }}>{TYPES.map((x) => <Chip key={x.value} label={x.label} active={type === x.value} onPress={() => setType(x.value)} />)}</Row>
            {(type === "limit" || type === "stop") && <Input label={type === "limit" ? "Limit price" : "Stop price"} keyboardType="decimal-pad" value={price} onChangeText={setPrice} placeholder={fmtPrice(q?.price)} suffix={ccy} />}
            {type === "trailing_stop" && <Input label="Trail %" keyboardType="decimal-pad" value={trail} onChangeText={setTrail} suffix="%" />}
            <Input label="Amount" keyboardType="decimal-pad" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))} placeholder="0.00" suffix={ccy} />
            <Row gap={6}>{[0.25, 0.5, 0.75, 1].map((p) => <Btn key={p} small title={`${p * 100}%`} onPress={() => pct(p)} style={{ flex: 1 }} />)}</Row>
            <Row gap={8}>
              <View style={{ flex: 1 }}><Input label="Take profit" keyboardType="decimal-pad" value={tp} onChangeText={setTp} placeholder="optional" /></View>
              <View style={{ flex: 1 }}><Input label="Stop loss" keyboardType="decimal-pad" value={sl} onChangeText={setSl} placeholder="optional" /></View>
            </Row>
            <View>
              <KV k="Estimated" v={`${fmtQty(qty)} ${base}`} />
              <KV k="Buying power" v={fmtUsd(bp)} />
              {pos && <KV k="Position" v={`${fmtQty(pos.qty)} ${base}`} />}
            </View>
            <Btn title={busy ? "Placing…" : `${side === "buy" ? "Buy" : "Sell"} ${base}`} kind={side} loading={busy} onPress={submit} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
