export type AssetClass = "crypto" | "stock" | "forex" | "commodity" | "index";

export interface Quote {
  symbol: string; display: string; name: string; asset_class: AssetClass;
  price: number; bid: number; ask: number; open: number; high: number; low: number; prev_close: number;
  change: number; change_pct: number; volume: number; ts: number; source: string; market_open?: boolean;
}
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface User { id: number; username: string; display_name: string; title: string; bio: string; email?: string; role?: string; is_demo?: boolean; oauth_provider?: string | null }
export interface Session { access_token: string; refresh_token: string; user: User; expires_in: number }

export interface PositionRow {
  id: number; symbol: string; display: string; asset_class: AssetClass; qty: number; side: "long" | "short";
  avg_price: number; price: number; market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number; realized_pnl: number; day_change_pct: number;
}
export interface OptionPositionRow {
  id: number; underlying: string; option_type: "call" | "put"; strike: number; expiry: string; contracts: number;
  avg_premium: number; mark: number; market_value: number; unrealized_pnl: number;
}
export interface AccountSummary {
  account_id: number; name: string; competition_id: number | null; cash: number; equity: number; starting_balance: number;
  net_deposits: number; market_value: number; options_value: number; unrealized_pnl: number; total_pnl: number; total_pnl_pct: number;
  day_pnl: number; day_pnl_pct: number; margin_used: number; available_margin: number; buying_power: number;
  buying_power_by_class: Record<AssetClass, number>; margin_level_pct: number | null;
  allocation: { asset_class: string; value: number; pct: number }[];
  positions: PositionRow[]; option_positions: OptionPositionRow[]; win_rate?: number; closed_trades?: number;
}
export interface Order {
  id: number; account_id: number; symbol: string; display: string; side: "buy" | "sell"; type: string; qty: number;
  limit_price: number | null; stop_price: number | null; trail_percent: number | null; time_in_force: string; status: string;
  take_profit: number | null; stop_loss: number | null; parent_id: number | null; oco_group: string | null;
  filled_price: number | null; filled_at: string | null; fee: number; reason: string | null; source: string; created_at: string;
}
export interface Trade {
  id: number; order_id: number | null; symbol: string; display: string; asset_class: string; side: string; qty: number; price: number;
  fee: number; realized_pnl: number; net_pnl: number | null; closes_position: boolean; created_at: string;
}
export interface NewsItem {
  id: string; title: string; url: string; source: string; summary: string; image: string | null; published_at: number;
  symbols: string[]; sentiment: "bullish" | "bearish" | "neutral"; sentiment_score: number;
}
export interface Instrument { symbol: string; display: string; name: string; asset_class: AssetClass; sector: string; exchange: string; open: boolean; session: string }
