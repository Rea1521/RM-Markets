import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { post } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { Card, Row, Screen, T, styles } from "../../components/ui";
import { Icons } from "../../components/icons";

const ITEMS: { section: string; items: [string, string, Href][] }[] = [
  { section: "Insights", items: [["Performance Analytics", "Equity curve, win rate, risk metrics", "/analytics"], ["News", "Aggregated market headlines", "/news"], ["Economic Calendar", "Macro events with related news", "/calendar"], ["ML Predictions", "Model-based next-bar probabilities", "/predictions"]] },
  { section: "Tools", items: [["Screener", "100+ preset filters", "/screener"], ["Options Simulator", "Chains, Greeks, paper trading", "/options"], ["Strategy Backtester", "Backtest & walk-forward", "/backtest"], ["Stress Test", "Crisis scenarios & Monte Carlo VaR", "/stress"]] },
  { section: "Community", items: [["Social Feed", "Share and discuss trade ideas", "/social"], ["Competitions", "Paper trading contests & accounts", "/competitions"], ["Trading Journal", "Reflect on trades, learn patterns", "/journal"]] },
  { section: "Account", items: [["Account Activity", "Event-sourced audit trail", "/history"], ["Settings", "Profile, theme, status", "/settings"]] },
];

export default function More() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Screen>
        <Row gap={12}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: t.primary, alignItems: "center", justifyContent: "center" }}>
            <T v="h2" color="#fff">{(user?.display_name ?? "?").slice(0, 2).toUpperCase()}</T>
          </View>
          <View style={{ flex: 1 }}><T v="h2">{user?.display_name}</T><T v="small" color={t.muted}>@{user?.username} · {user?.title}</T></View>
        </Row>
        {ITEMS.map((s) => (
          <Card key={s.section} title={s.section}>
            {s.items.map(([title, sub, href]) => (
              <Pressable key={title} onPress={() => router.push(href)} style={styles(t).listRow}>
                <View style={{ flex: 1 }}><T v="h3">{title}</T><T v="tiny" color={t.muted}>{sub}</T></View>
                <Icons.chevron color={t.faint} size={18} />
              </Pressable>
            ))}
          </Card>
        ))}
        <Pressable onPress={async () => { try { await post("/api/auth/logout"); } catch { /* ignore */ } logout(); router.replace("/login"); }}>
          <T v="h3" color={t.down} style={{ textAlign: "center", padding: 12 }}>Sign out</T>
        </Pressable>
      </Screen>
    </View>
  );
}
