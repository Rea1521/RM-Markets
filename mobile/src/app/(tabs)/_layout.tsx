import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { Icons } from "../../components/icons";

export default function TabsLayout() {
  const t = useTheme();
  const token = useAuth((s) => s.accessToken);
  if (!token) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: t.primary, tabBarInactiveTintColor: t.faint,
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border }, tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
    }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <Icons.home color={color as string} /> }} />
      <Tabs.Screen name="markets" options={{ title: "Markets", tabBarIcon: ({ color }) => <Icons.markets color={color as string} /> }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portfolio", tabBarIcon: ({ color }) => <Icons.portfolio color={color as string} /> }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: ({ color }) => <Icons.orders color={color as string} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color }) => <Icons.more color={color as string} /> }} />
    </Tabs>
  );
}
