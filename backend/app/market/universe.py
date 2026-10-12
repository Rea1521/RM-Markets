"""Tradable instrument catalogue.

`ref_price` / `vol` are ONLY used by the simulated fallback provider when no live
source is reachable (offline dev, CI). Live prices come from the providers.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Instrument:
    symbol: str  # internal id, e.g. BTCUSDT
    display: str  # BTC/USDT
    name: str
    asset_class: str  # crypto | stock | forex | commodity | index
    sector: str = ""
    exchange: str = ""
    binance: str | None = None
    yahoo: str | None = None
    polygon: str | None = None
    alpha: str | None = None
    finnhub: str | None = None
    ref_price: float = 100.0
    vol: float = 0.3  # annualised, sim only
    keywords: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_24_7(self) -> bool:
        return self.asset_class == "crypto"

    @property
    def option_multiplier(self) -> float:
        return 1.0 if self.asset_class in ("crypto", "forex") else 100.0

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "display": self.display,
            "name": self.name,
            "asset_class": self.asset_class,
            "sector": self.sector,
            "exchange": self.exchange,
        }


def _crypto(base: str, name: str, ref: float, vol: float = 0.65) -> Instrument:
    return Instrument(
        symbol=f"{base}USDT", display=f"{base}/USDT", name=name, asset_class="crypto", sector="Crypto",
        exchange="Binance", binance=f"{base}USDT", yahoo=f"{base}-USD", polygon=f"X:{base}USD",
        finnhub=f"BINANCE:{base}USDT", ref_price=ref, vol=vol, keywords=(base.lower(), name.lower()),
    )


def _stock(t: str, name: str, sector: str, ref: float, vol: float = 0.3, exch: str = "NASDAQ", kw: tuple = ()) -> Instrument:
    return Instrument(
        symbol=t, display=t, name=name, asset_class="stock", sector=sector, exchange=exch,
        yahoo=t, polygon=t, alpha=t, finnhub=t, ref_price=ref, vol=vol,
        keywords=(t.lower(), name.lower().split()[0]) + kw,
    )


def _fx(a: str, b: str, ref: float, vol: float = 0.08) -> Instrument:
    return Instrument(
        symbol=f"{a}{b}", display=f"{a}/{b}", name=f"{a} / {b}", asset_class="forex", sector="Currencies",
        exchange="FX", yahoo=f"{a}{b}=X", polygon=f"C:{a}{b}", alpha=f"{a}{b}", finnhub=f"OANDA:{a}_{b}",
        ref_price=ref, vol=vol, keywords=(a.lower(), b.lower()),
    )


INSTRUMENTS: list[Instrument] = [
    # Crypto (live via Binance websocket)
    _crypto("BTC", "Bitcoin", 67284.45, 0.55),
    _crypto("ETH", "Ethereum", 3650.21, 0.65),
    _crypto("SOL", "Solana", 165.0, 0.85),
    _crypto("BNB", "BNB", 590.0, 0.55),
    _crypto("XRP", "XRP", 0.55, 0.8),
    _crypto("ADA", "Cardano", 0.45, 0.85),
    _crypto("DOGE", "Dogecoin", 0.15, 0.95),
    _crypto("AVAX", "Avalanche", 35.0, 0.9),
    _crypto("LINK", "Chainlink", 15.0, 0.85),
    _crypto("DOT", "Polkadot", 7.0, 0.85),
    # US stocks
    _stock("AAPL", "Apple Inc.", "Technology", 193.42, 0.25, kw=("iphone",)),
    _stock("MSFT", "Microsoft Corp.", "Technology", 420.0, 0.24),
    _stock("NVDA", "NVIDIA Corp.", "Technology", 120.0, 0.5),
    _stock("GOOGL", "Alphabet Inc.", "Communication", 170.0, 0.28, kw=("google",)),
    _stock("AMZN", "Amazon.com Inc.", "Consumer Discretionary", 185.0, 0.3),
    _stock("META", "Meta Platforms", "Communication", 500.0, 0.35, kw=("facebook",)),
    _stock("TSLA", "Tesla Inc.", "Consumer Discretionary", 248.35, 0.55),
    _stock("NFLX", "Netflix Inc.", "Communication", 650.0, 0.35),
    _stock("AMD", "Advanced Micro Devices", "Technology", 160.0, 0.5),
    _stock("INTC", "Intel Corp.", "Technology", 30.0, 0.4),
    _stock("JPM", "JPMorgan Chase", "Financials", 200.0, 0.22, "NYSE"),
    _stock("V", "Visa Inc.", "Financials", 275.0, 0.2, "NYSE"),
    _stock("KO", "Coca-Cola Co.", "Consumer Staples", 62.0, 0.15, "NYSE"),
    _stock("DIS", "Walt Disney Co.", "Communication", 100.0, 0.3, "NYSE"),
    _stock("NKE", "Nike Inc.", "Consumer Discretionary", 90.0, 0.3, "NYSE"),
    _stock("BA", "Boeing Co.", "Industrials", 180.0, 0.35, "NYSE"),
    _stock("XOM", "Exxon Mobil", "Energy", 115.0, 0.25, "NYSE"),
    _stock("WMT", "Walmart Inc.", "Consumer Staples", 68.0, 0.18, "NYSE"),
    _stock("PFE", "Pfizer Inc.", "Health Care", 28.0, 0.25, "NYSE"),
    _stock("UNH", "UnitedHealth Group", "Health Care", 500.0, 0.25, "NYSE"),
    # Forex
    _fx("EUR", "USD", 1.08),
    _fx("GBP", "USD", 1.27),
    _fx("USD", "JPY", 155.0, 0.1),
    _fx("USD", "ZAR", 18.3, 0.15),
    _fx("AUD", "USD", 0.66),
    _fx("USD", "CHF", 0.9),
    # Commodities
    Instrument("XAUUSD", "XAU/USD", "Gold Spot", "commodity", "Metals", "COMEX", yahoo="GC=F", polygon="C:XAUUSD",
               finnhub="OANDA:XAU_USD", ref_price=2344.11, vol=0.15, keywords=("gold", "xau")),
    Instrument("XAGUSD", "XAG/USD", "Silver Spot", "commodity", "Metals", "COMEX", yahoo="SI=F", polygon="C:XAGUSD",
               finnhub="OANDA:XAG_USD", ref_price=29.0, vol=0.25, keywords=("silver", "xag")),
    Instrument("WTI", "WTI", "Crude Oil WTI", "commodity", "Energy", "NYMEX", yahoo="CL=F", ref_price=78.0, vol=0.35,
               keywords=("oil", "crude", "wti", "opec")),
    # Indices
    Instrument("SPX", "S&P 500", "S&P 500 Index", "index", "US Large Cap", "INDEX", yahoo="^GSPC", polygon="I:SPX",
               alpha="SPY", ref_price=5300.0, vol=0.16, keywords=("s&p", "spx", "s&p 500")),
    Instrument("NDX", "NASDAQ 100", "Nasdaq 100 Index", "index", "US Tech", "INDEX", yahoo="^NDX", polygon="I:NDX",
               alpha="QQQ", ref_price=18500.0, vol=0.2, keywords=("nasdaq",)),
    Instrument("DJI", "DOW 30", "Dow Jones Industrial Avg", "index", "US Blue Chip", "INDEX", yahoo="^DJI",
               polygon="I:DJI", alpha="DIA", ref_price=39000.0, vol=0.14, keywords=("dow",)),
    Instrument("NIFTY50", "NIFTY 50", "NIFTY 50 Index", "index", "India", "NSE", yahoo="^NSEI", ref_price=22957.10,
               vol=0.15, keywords=("nifty", "india", "sensex")),
    Instrument("JSE40", "JSE TOP 40", "FTSE/JSE Top 40", "index", "South Africa", "JSE", yahoo="^J200.JO",
               ref_price=72000.0, vol=0.17, keywords=("jse", "south africa", "rand")),
    Instrument("FTSE", "FTSE 100", "FTSE 100 Index", "index", "UK", "LSE", yahoo="^FTSE", ref_price=8200.0, vol=0.13,
               keywords=("ftse", "uk", "london")),
]

BY_SYMBOL: dict[str, Instrument] = {i.symbol: i for i in INSTRUMENTS}
ASSET_CLASSES = ["crypto", "stock", "forex", "commodity", "index"]

_ALIASES = {
    "BTC/USDT": "BTCUSDT", "BTCUSD": "BTCUSDT", "BITCOIN": "BTCUSDT", "ETHUSD": "ETHUSDT", "ETHEREUM": "ETHUSDT",
    "GOLD": "XAUUSD", "XAU/USD": "XAUUSD", "SILVER": "XAGUSD", "OIL": "WTI", "NIFTY": "NIFTY50", "NIFTY 50": "NIFTY50",
    "S&P": "SPX", "S&P500": "SPX", "SP500": "SPX", "NASDAQ": "NDX", "DOW": "DJI", "APPLE": "AAPL", "TESLA": "TSLA",
    "MICROSOFT": "MSFT", "NVIDIA": "NVDA", "AMAZON": "AMZN", "GOOGLE": "GOOGL", "META": "META", "FACEBOOK": "META",
    "NETFLIX": "NFLX", "SOLANA": "SOLUSDT", "DOGECOIN": "DOGEUSDT", "RAND": "USDZAR", "EURO": "EURUSD",
}


def resolve(symbol: str) -> Instrument | None:
    if not symbol:
        return None
    s = symbol.strip().upper()
    if s in BY_SYMBOL:
        return BY_SYMBOL[s]
    s2 = s.replace("/", "").replace("-", "").replace(" ", "")
    if s2 in BY_SYMBOL:
        return BY_SYMBOL[s2]
    alias = _ALIASES.get(s) or _ALIASES.get(s2)
    if alias:
        return BY_SYMBOL[alias]
    if s2 + "USDT" in BY_SYMBOL:  # $BTC, ETH, SOL ...
        return BY_SYMBOL[s2 + "USDT"]
    for i in INSTRUMENTS:  # display names like "BTC/USDT"
        if i.display.upper() == s:
            return i
    return None
