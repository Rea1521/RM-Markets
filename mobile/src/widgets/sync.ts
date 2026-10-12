import { Platform } from "react-native";
import type { Quote } from "../lib/types";
import { fmtPrice } from "../lib/format";

let last = 0;

/** Push the latest watchlist quotes to the home-screen widget (throttled to once a minute). */
export async function syncWidgets(quotes: Quote[]) {
  if (!quotes.length || Date.now() - last < 60_000) return;
  last = Date.now();
  const updated = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  try {
    if (Platform.OS === "android") {
      const { refreshAndroidWidget } = await import("./android");
      await refreshAndroidWidget(quotes.map((q) => ({ symbol: q.symbol, display: q.display, price: q.price, change_pct: q.change_pct })));
    } else if (Platform.OS === "ios") {
      const W = (await import("./QuotesWidget")).default;
      W.updateSnapshot({
        updated,
        rows: quotes.slice(0, 5).map((q) => ({ display: q.display, price: fmtPrice(q.price), change: `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`, up: q.change_pct >= 0 })),
      });
    }
  } catch {
    // Widgets need a native build; silently skip in Expo Go.
  }
}
