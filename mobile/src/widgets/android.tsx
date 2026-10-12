/**
 * Android home-screen widget ("RM Markets Quotes"): watchlist prices, tap to open the app.
 * Runs as headless JS, so it fetches quotes straight from the public API.
 * Requires a development/production build (not Expo Go).
 */
import { FlexWidget, TextWidget, type WidgetTaskHandlerProps } from "react-native-android-widget";
import { API_URL } from "../lib/config";

export interface WidgetQuote { symbol: string; display: string; price: number; change_pct: number }
const DEFAULT = ["BTCUSDT", "ETHUSDT", "AAPL", "TSLA", "XAUUSD"];

function fmt(p: number) {
  const d = p >= 10 ? 2 : p >= 1 ? 4 : 5;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function QuotesWidget({ quotes, updated }: { quotes: WidgetQuote[]; updated: string }) {
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: "match_parent", width: "match_parent", backgroundColor: "#111722", borderRadius: 18, padding: 14, flexDirection: "column" }}>
      <FlexWidget style={{ flexDirection: "row", justifyContent: "space-between", width: "match_parent", marginBottom: 6 }}>
        <TextWidget text="RM Markets" style={{ fontSize: 14, color: "#e6ebf3", fontWeight: "700" }} />
        <TextWidget text={updated} style={{ fontSize: 11, color: "#8b97a8" }} />
      </FlexWidget>
      {quotes.slice(0, 5).map((q) => (
        <FlexWidget key={q.symbol} clickAction="OPEN_URI" clickActionData={{ uri: `rmmarkets://symbol/${q.symbol}` }}
          style={{ flexDirection: "row", justifyContent: "space-between", width: "match_parent", paddingVertical: 3 }}>
          <TextWidget text={q.display} style={{ fontSize: 13, color: "#e6ebf3", fontWeight: "600" }} />
          <FlexWidget style={{ flexDirection: "row" }}>
            <TextWidget text={fmt(q.price)} style={{ fontSize: 13, color: "#e6ebf3", marginRight: 8 }} />
            <TextWidget text={`${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`} style={{ fontSize: 13, color: q.change_pct >= 0 ? "#22c55e" : "#f05252" }} />
          </FlexWidget>
        </FlexWidget>
      ))}
      {!quotes.length && <TextWidget text="Open RM Markets to load prices" style={{ fontSize: 12, color: "#8b97a8" }} />}
    </FlexWidget>
  );
}

export async function fetchWidgetQuotes(symbols: string[] = DEFAULT): Promise<WidgetQuote[]> {
  try {
    const r = await fetch(`${API_URL}/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    if (!r.ok) return [];
    return (await r.json()).map((q: any) => ({ symbol: q.symbol, display: q.display, price: q.price, change_pct: q.change_pct }));
  } catch {
    return [];
  }
}

const now = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
    case "WIDGET_CLICK": {
      const quotes = await fetchWidgetQuotes();
      props.renderWidget(<QuotesWidget quotes={quotes} updated={now()} />);
      break;
    }
    default:
      break;
  }
}

export async function refreshAndroidWidget(quotes: WidgetQuote[]) {
  const { requestWidgetUpdate } = await import("react-native-android-widget");
  await requestWidgetUpdate({ widgetName: "Quotes", renderWidget: () => <QuotesWidget quotes={quotes} updated={now()} />, widgetNotFound: () => {} });
}
