import { useState } from "react";
import { View } from "react-native";
import { useApi } from "../lib/hooks";
import { fmtNum, fmtPct, fmtPrice } from "../lib/format";
import { useTheme } from "../lib/theme";
import { Card, Chip, ErrorText, KV, Loading, Row, Screen, T } from "../components/ui";

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AAPL", "TSLA", "NVDA", "SPX", "EURUSD", "XAUUSD"];

export default function Predictions() {
  const t = useTheme();
  const [sym, setSym] = useState("BTCUSDT");
  const { data, loading, error } = useApi<any>(`/api/analytics/ml/predict/${sym}`);
  return (
    <Screen>
      <Row gap={6} style={{ flexWrap: "wrap" }}>{SYMS.map((s) => <Chip key={s} label={s} active={s === sym} onPress={() => setSym(s)} />)}</Row>
      <T v="tiny" color={t.muted}>Educational model. Compare accuracy with the baseline before trusting any signal.</T>
      {loading && <Loading />}
      <ErrorText error={error} />
      {data && !loading && (
        <>
          <Card>
            <T v="small" color={t.muted}>Probability next daily bar closes higher</T>
            <T v="big" color={data.prob_up >= 0.5 ? t.up : t.down}>{(data.prob_up * 100).toFixed(1)}%</T>
            <View style={{ height: 8, backgroundColor: t.surface3, borderRadius: 4, marginTop: 8 }}>
              <View style={{ height: 8, borderRadius: 4, width: `${data.prob_up * 100}%`, backgroundColor: data.prob_up >= 0.5 ? t.up : t.down }} />
            </View>
            <Row style={{ marginTop: 8, justifyContent: "space-between" }}>
              <Chip label={data.signal} color={data.signal === "bullish" ? "up" : data.signal === "bearish" ? "down" : undefined} />
              <T v="small">Target {fmtPrice(data.target_price)} ({fmtPct(data.expected_return_pct, 3)})</T>
            </Row>
          </Card>
          <Card title="Validation">
            <KV k="Walk-forward accuracy" v={`${(data.metrics.accuracy * 100).toFixed(2)}%`} />
            <KV k="Baseline" v={`${(data.metrics.baseline_accuracy * 100).toFixed(2)}%`} />
            <KV k="Information coefficient" v={fmtNum(data.metrics.information_coefficient, 4)} />
            <KV k="Samples" v={String(data.metrics.samples)} />
          </Card>
          <Card title="Top drivers">
            {data.top_drivers.map((d: any) => <KV key={d.feature} k={d.feature} v={`${d.impact >= 0 ? "+" : ""}${d.impact.toFixed(3)}`} vColor={d.impact >= 0 ? t.up : t.down} />)}
          </Card>
        </>
      )}
    </Screen>
  );
}
