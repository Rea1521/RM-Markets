"""News aggregation + economic calendar.

News sources (merged, de-duplicated, tagged with symbols and a lexicon sentiment):
  * RSS: Yahoo Finance, CNBC, MarketWatch, CoinDesk, Cointelegraph, FXStreet, Investing.com
  * Finnhub general/company news (FINNHUB_API_KEY)
  * NewsAPI.org business headlines (NEWSAPI_KEY)
Economic calendar: ForexFactory weekly feed (public JSON), optionally Finnhub.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from .cache import cached
from .config import get_settings
from .market.providers import http
from .market.universe import INSTRUMENTS

log = logging.getLogger("rm.news")

RSS_FEEDS = {
    "Yahoo Finance": "https://finance.yahoo.com/news/rssindex",
    "CNBC": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    "MarketWatch": "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "Cointelegraph": "https://cointelegraph.com/rss",
    "FXStreet": "https://www.fxstreet.com/rss/news",
    "Investing.com": "https://www.investing.com/rss/news.rss",
}
SYMBOL_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"

POS = {"surge", "surges", "soar", "soars", "rally", "rallies", "gain", "gains", "beat", "beats", "record", "jump", "jumps",
       "rise", "rises", "bullish", "upgrade", "upgraded", "growth", "strong", "profit", "boost", "optimism", "cut rates", "rate cut", "rebound"}
NEG = {"fall", "falls", "drop", "drops", "plunge", "plunges", "slump", "crash", "miss", "misses", "loss", "losses", "bearish",
       "downgrade", "downgraded", "weak", "fear", "fears", "recession", "inflation", "lawsuit", "probe", "selloff", "sell-off", "tumble", "warns"}

_TAG_RE = re.compile(r"<[^>]+>")


def _clean(s: str | None) -> str:
    return html.unescape(_TAG_RE.sub("", s or "")).strip()


def sentiment(text: str) -> tuple[str, float]:
    t = text.lower()
    words = set(re.findall(r"[a-z\-]+", t))
    p = len(words & POS) + sum(1 for ph in POS if " " in ph and ph in t)
    n = len(words & NEG)
    score = (p - n) / max(1, p + n)
    return ("bullish" if score > 0.2 else "bearish" if score < -0.2 else "neutral"), round(score, 2)


def tag_symbols(text: str) -> list[str]:
    t = f" {text.lower()} "
    out = []
    for i in INSTRUMENTS:
        for kw in i.keywords:
            if len(kw) <= 3 and i.asset_class == "stock":
                if re.search(rf"(\$|\b){re.escape(kw.upper())}\b", text):
                    out.append(i.symbol)
                    break
            elif len(kw) > 2 and re.search(rf"\b{re.escape(kw)}\b", t):
                out.append(i.symbol)
                break
    return out[:6]


def _item(source: str, title: str, url: str, published: float, summary: str = "", image: str | None = None) -> dict:
    title, summary = _clean(title), _clean(summary)[:400]
    label, score = sentiment(f"{title} {summary}")
    return {
        "id": hashlib.sha1((url or title).encode()).hexdigest()[:16], "title": title, "url": url, "source": source,
        "summary": summary, "image": image, "published_at": published, "symbols": tag_symbols(f"{title} {summary}"),
        "sentiment": label, "sentiment_score": score,
    }


def _parse_rss(source: str, url: str) -> list[dict]:
    import feedparser

    r = http().get(url)
    r.raise_for_status()
    feed = feedparser.parse(r.content)
    out = []
    for e in feed.entries[:30]:
        ts = time.time()
        for k in ("published", "updated"):
            if e.get(k):
                try:
                    ts = parsedate_to_datetime(e[k]).timestamp()
                    break
                except Exception:
                    pass
        img = None
        for m in e.get("media_content", []) or e.get("media_thumbnail", []) or []:
            if m.get("url"):
                img = m["url"]
                break
        out.append(_item(source, e.get("title", ""), e.get("link", ""), ts, e.get("summary", ""), img))
    return out


def _finnhub_news(category: str = "general") -> list[dict]:
    key = get_settings().finnhub_key
    if not key:
        return []
    r = http().get("https://finnhub.io/api/v1/news", params={"category": category, "token": key})
    r.raise_for_status()
    return [_item(f"Finnhub/{n.get('source', '')}", n["headline"], n["url"], n["datetime"], n.get("summary", ""), n.get("image") or None) for n in r.json()[:40]]


def _newsapi() -> list[dict]:
    key = get_settings().newsapi_key
    if not key:
        return []
    r = http().get("https://newsapi.org/v2/top-headlines", params={"category": "business", "language": "en", "pageSize": 40, "apiKey": key})
    r.raise_for_status()
    out = []
    for a in r.json().get("articles", []):
        try:
            ts = datetime.fromisoformat(a["publishedAt"].replace("Z", "+00:00")).timestamp()
        except Exception:
            ts = time.time()
        out.append(_item(a.get("source", {}).get("name", "NewsAPI"), a["title"], a["url"], ts, a.get("description") or "", a.get("urlToImage")))
    return out


def _gather() -> dict:
    jobs = {name: (lambda n=name, u=url: _parse_rss(n, u)) for name, url in RSS_FEEDS.items()}
    jobs["finnhub"] = _finnhub_news
    jobs["newsapi"] = _newsapi
    items: list[dict] = []
    status = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {name: ex.submit(fn) for name, fn in jobs.items()}
        for name, f in futs.items():
            try:
                res = f.result(timeout=12)
                items += res
                status[name] = {"ok": True, "items": len(res)}
            except Exception as e:
                status[name] = {"ok": False, "error": str(e)[:160]}
    seen, uniq = set(), []
    for it in sorted(items, key=lambda x: -x["published_at"]):
        key = re.sub(r"\W+", "", it["title"].lower())[:80]
        if key in seen or not it["title"]:
            continue
        seen.add(key)
        uniq.append(it)
    return {"items": uniq[:200], "sources": status, "fetched_at": time.time()}


def get_news(symbol: str | None = None, category: str | None = None, q: str | None = None, limit: int = 50) -> dict:
    data = cached("news:all", 300, _gather)
    items = data["items"]
    if symbol:
        from .market.universe import resolve

        inst = resolve(symbol)
        if inst:
            extra = []
            if inst.yahoo:
                try:
                    extra = cached(f"news:sym:{inst.symbol}", 600, lambda: _parse_rss("Yahoo Finance", SYMBOL_RSS.format(ticker=inst.yahoo)))
                except Exception as e:
                    log.info("symbol news failed: %s", e)
            items = [i for i in items if inst.symbol in i["symbols"]] + [dict(e, symbols=list({*e["symbols"], inst.symbol})) for e in (extra or [])]
    if category:
        cls = {"crypto", "stock", "forex", "commodity", "index"}
        if category in cls:
            from .market.universe import BY_SYMBOL

            items = [i for i in items if any(BY_SYMBOL[s].asset_class == category for s in i["symbols"])]
    if q:
        ql = q.lower()
        items = [i for i in items if ql in i["title"].lower() or ql in i["summary"].lower()]
    seen, out = set(), []
    for i in sorted(items, key=lambda x: -x["published_at"]):
        if i["id"] not in seen:
            seen.add(i["id"])
            out.append(i)
    return {"items": out[:limit], "sources": data["sources"], "fetched_at": data["fetched_at"]}


# ---------------------------------------------------------------- economic calendar
FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
CCY_KEYWORDS = {"USD": ["fed", "fomc", "powell", "us ", "u.s.", "treasury", "dollar", "cpi", "payrolls"],
                "EUR": ["ecb", "euro", "lagarde", "eurozone"], "GBP": ["boe", "bank of england", "sterling", "uk "],
                "JPY": ["boj", "yen", "japan"], "CNY": ["china", "pboc", "yuan"], "AUD": ["rba", "australia"],
                "CAD": ["boc", "canada"], "CHF": ["snb", "franc", "swiss"], "NZD": ["rbnz", "new zealand"],
                "ZAR": ["sarb", "rand", "south africa"]}
CCY_SYMBOLS = {"USD": ["EURUSD", "USDJPY", "XAUUSD", "SPX"], "EUR": ["EURUSD"], "GBP": ["GBPUSD", "FTSE"], "JPY": ["USDJPY"],
               "AUD": ["AUDUSD"], "CHF": ["USDCHF"], "ZAR": ["USDZAR", "JSE40"], "CNY": ["AUDUSD", "XAUUSD"]}


def _ff_calendar() -> list[dict]:
    r = http().get(FF_URL)
    r.raise_for_status()
    out = []
    for e in r.json():
        try:
            ts = datetime.fromisoformat(e["date"]).astimezone(timezone.utc).timestamp()
        except Exception:
            continue
        out.append({"id": hashlib.sha1(f"{e['title']}{e['date']}{e['country']}".encode()).hexdigest()[:14],
                    "title": e["title"], "country": e["country"], "time": ts, "impact": (e.get("impact") or "").lower(),
                    "forecast": e.get("forecast") or None, "previous": e.get("previous") or None, "actual": e.get("actual") or None,
                    "source": "ForexFactory"})
    return out


def _finnhub_calendar() -> list[dict]:
    key = get_settings().finnhub_key
    if not key:
        return []
    r = http().get("https://finnhub.io/api/v1/calendar/economic", params={"token": key})
    r.raise_for_status()
    out = []
    for e in (r.json().get("economicCalendar") or [])[:300]:
        try:
            ts = datetime.fromisoformat(e["time"]).replace(tzinfo=timezone.utc).timestamp()
        except Exception:
            continue
        out.append({"id": hashlib.sha1(f"{e['event']}{e['time']}".encode()).hexdigest()[:14], "title": e["event"],
                    "country": e.get("country", ""), "time": ts, "impact": e.get("impact", ""), "forecast": e.get("estimate"),
                    "previous": e.get("prev"), "actual": e.get("actual"), "source": "Finnhub"})
    return out


def get_calendar(impact: str | None = None, country: str | None = None, with_news: bool = True) -> dict:
    def load():
        events, errors = [], {}
        for name, fn in (("forexfactory", _ff_calendar), ("finnhub", _finnhub_calendar)):
            try:
                events += fn()
            except Exception as e:
                errors[name] = str(e)[:160]
        seen, uniq = set(), []
        for e in sorted(events, key=lambda x: x["time"]):
            k = (e["title"].lower(), int(e["time"] // 3600), e["country"])
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        return {"events": uniq, "errors": errors, "fetched_at": time.time()}

    data = cached("calendar", 900, load)
    events = data["events"]
    if impact:
        events = [e for e in events if e["impact"] == impact.lower()]
    if country:
        events = [e for e in events if e["country"].upper() == country.upper()]
    if with_news:
        news = get_news(limit=200)["items"]
        enriched = []
        for e in events:
            kws = [w for w in re.findall(r"[a-z]{4,}", e["title"].lower()) if w not in {"final", "flash", "change", "index", "rate", "data"}]
            kws += CCY_KEYWORDS.get(e["country"].upper(), [])
            related = [n for n in news if any(k in n["title"].lower() for k in kws)][:3]
            enriched.append({**e, "symbols": CCY_SYMBOLS.get(e["country"].upper(), []),
                             "related_news": [{"title": n["title"], "url": n["url"], "source": n["source"]} for n in related]})
        events = enriched
    return {"events": events, "errors": data["errors"], "fetched_at": data["fetched_at"]}
