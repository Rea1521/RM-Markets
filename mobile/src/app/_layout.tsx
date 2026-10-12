import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { useAuth } from "../lib/auth";
import { onPrivateEvent, socket } from "../lib/market";
import { useTheme } from "../lib/theme";
import { toast } from "../lib/ui";
import { Loading, ToastHost } from "../components/ui";

export default function RootLayout() {
  const t = useTheme();
  const { ready, hydrate } = useAuth();
  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => { socket.start(); return () => socket.stop(); }, []);
  useEffect(() => onPrivateEvent((m) => toast({ kind: m.type === "order_rejected" || m.type === "margin_call" ? "error" : "success", title: m.title, body: m.body })), []);
  if (!ready) return <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center" }}><Loading /></View>;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: t.surface }, headerTintColor: t.text, headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: t.bg }, headerShadowVisible: false, headerBackButtonDisplayMode: "minimal",
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="symbol/[symbol]" options={{ title: "" }} />
        <Stack.Screen name="analytics" options={{ title: "Analytics" }} />
        <Stack.Screen name="news" options={{ title: "News" }} />
        <Stack.Screen name="calendar" options={{ title: "Economic Calendar" }} />
        <Stack.Screen name="social" options={{ title: "Social Feed" }} />
        <Stack.Screen name="screener" options={{ title: "Screener" }} />
        <Stack.Screen name="options" options={{ title: "Options Simulator" }} />
        <Stack.Screen name="backtest" options={{ title: "Backtester" }} />
        <Stack.Screen name="stress" options={{ title: "Stress Test" }} />
        <Stack.Screen name="predictions" options={{ title: "ML Predictions" }} />
        <Stack.Screen name="journal" options={{ title: "Trading Journal" }} />
        <Stack.Screen name="competitions" options={{ title: "Competitions" }} />
        <Stack.Screen name="history" options={{ title: "Account Activity" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
      <ToastHost />
    </View>
  );
}
