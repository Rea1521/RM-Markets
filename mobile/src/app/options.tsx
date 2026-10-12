import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { post } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtNum, fmtPrice } from "../lib/format";
import { useTheme } from "../lib/theme";
import { toast, useAccountSel } from "../lib/ui";
import { Card, Chip, KV, Loading, Row, Screen, T } from "../components/ui";

const UND = ["AAPL", "TSLA", "NVDA", "SPX", "BTCUSDT", "ETHUSDT"];

export default function Options() {
  const t = useTheme();
  const accountId = useAccountSel((s) => s.accountId);
  const [und, setUnd] = useState("AAPL");
  const [exp, setExp] = useState<string | undefined>();
  const [sel, setSel] = useState<any>(null);
  const { data: c, loading } = useApi<any>(`/api/analytics/options/chain/${und}`, { params: { expiry: exp, strikes: 7 }, poll: 15000 });
  const trade = async (type: "call" | "put", strike: number, contracts: number) => {
    try {
      const r = await post("/api/analytics/options/orders", { underlying: und, option_type: type, strike, expiry: c.expiry, contracts, account_id: accountId ?? undefined });
      toast({ kind: "success", title: `${contracts > 0 ? "Bought" : "Sold"} ${Math.abs(contracts)} ${und} ${strike} ${type}`, body: `Premium ${fmtPrice(r.avg_premium)}` });
    } catch (e) { toast({ kind: "error", title: "Rejected", body: (e as Error).message }); }
  };
  return (
    <Screen>
      <Row gap={6} style={{ flexWrap: "wrap" }}>{UND.map((u) => <Chip key={u} label={u} active={u === und} onPress={() => { setUnd(u); setExp(undefined); setSel(null); }} />)}</Row>
      {loading && !c && <Loading />}
      {c && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}><Row gap={6}>{c.expiries.map((e: string) => <Chip key={e} label={fmtDate(e, false)} active={e === c.expiry} onPress={() => setExp(e)} />)}</Row></ScrollView>
          <T v="small" color={t.muted}>Spot {fmtPrice(c.spot)} · HV {(c.hist_vol * 100).toFixed(1)}% · {c.days_to_expiry} days · ×{c.multiplier}</T>
          <Card pad={false}>
            <Row style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
              <T v="tiny" color={t.up} style={{ flex: 1 }}>CALL  Δ</T><T v="tiny" color={t.muted} style={{ width: 70, textAlign: "center" }}>STRIKE</T><T v="tiny" color={t.down} style={{ flex: 1, textAlign: "right" }}>Δ  PUT</T>
            </Row>
            {c.rows.map((r: any) => (
              <Row key={r.strike} style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: Math.abs(r.strike - c.spot) < (c.rows[1].strike - c.rows[0].strike) / 2 ? t.primarySoft : undefined }}>
                <Pressable style={{ flex: 1 }} onPress={() => setSel({ type: "call", strike: r.strike, g: r.call, iv: r.iv })}><T v="small" style={{ fontWeight: "700" }}>{fmtPrice(r.call.price)} <T v="tiny" color={t.muted}>{fmtNum(r.call.delta, 2)}</T></T></Pressable>
                <T v="small" style={{ width: 70, textAlign: "center", fontWeight: "700" }}>{fmtPrice(r.strike)}</T>
                <Pressable style={{ flex: 1, alignItems: "flex-end" }} onPress={() => setSel({ type: "put", strike: r.strike, g: r.put, iv: r.iv })}><T v="small" style={{ fontWeight: "700" }}><T v="tiny" color={t.muted}>{fmtNum(r.put.delta, 2)}</T> {fmtPrice(r.put.price)}</T></Pressable>
              </Row>
            ))}
          </Card>
          {sel && (
            <Card title={`${und} ${fmtPrice(sel.strike)} ${sel.type.toUpperCase()}`}>
              <KV k="Price" v={fmtPrice(sel.g.price)} /><KV k="Implied vol" v={`${(sel.iv * 100).toFixed(1)}%`} />
              <KV k="Delta" v={fmtNum(sel.g.delta, 4)} /><KV k="Gamma" v={fmtNum(sel.g.gamma, 5)} /><KV k="Theta / day" v={fmtNum(sel.g.theta, 4)} />
              <KV k="Vega (1%)" v={fmtNum(sel.g.vega, 4)} /><KV k="Rho (1%)" v={fmtNum(sel.g.rho, 4)} />
              <Row gap={10} style={{ marginTop: 10 }}>
                <View style={{ flex: 1 }}><Pressable onPress={() => trade(sel.type, sel.strike, 1)} style={{ backgroundColor: t.up, padding: 12, borderRadius: 10, alignItems: "center" }}><T v="h3" color="#fff">Buy 1</T></Pressable></View>
                <View style={{ flex: 1 }}><Pressable onPress={() => trade(sel.type, sel.strike, -1)} style={{ backgroundColor: t.down, padding: 12, borderRadius: 10, alignItems: "center" }}><T v="h3" color="#fff">Sell 1</T></Pressable></View>
              </Row>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
