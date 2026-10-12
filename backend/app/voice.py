"""Voice-command intent parser. The client turns speech into text (Web Speech API
on web, expo-speech-recognition on mobile); this module turns the transcript into
a structured intent. Trade intents are NEVER executed directly: the client must
show a confirmation and then call the normal order endpoint."""
from __future__ import annotations

import re

from .market.universe import INSTRUMENTS, resolve

NUM_WORDS = {"zero": 0, "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
             "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40,
             "fifty": 50, "hundred": 100, "half": 0.5, "quarter": 0.25}
NAV = {"portfolio": "/portfolio", "positions": "/positions", "orders": "/orders", "watchlist": "/watchlist", "news": "/news",
       "calendar": "/calendar", "analytics": "/analytics", "screener": "/screener", "journal": "/journal", "social": "/social",
       "feed": "/social", "competitions": "/competitions", "competition": "/competitions", "backtest": "/backtester",
       "backtester": "/backtester", "options": "/options", "stress": "/stress-test", "settings": "/settings", "dashboard": "/",
       "home": "/", "market": "/market", "markets": "/market"}


def _num(tok: str) -> float | None:
    tok = tok.replace(",", "")
    try:
        return float(tok)
    except ValueError:
        return NUM_WORDS.get(tok)


def _find_symbol(text: str) -> str | None:
    t = text.lower()
    # longest keyword match wins ("bitcoin" over "bit")
    best, best_len = None, 0
    for i in INSTRUMENTS:
        for kw in (*i.keywords, i.symbol.lower(), i.display.lower()):
            if len(kw) >= 2 and re.search(rf"(?<![a-z]){re.escape(kw)}(?![a-z])", t) and len(kw) > best_len:
                best, best_len = i.symbol, len(kw)
    if best:
        return best
    for tok in re.findall(r"[a-z&/]+", t):
        inst = resolve(tok)
        if inst:
            return inst.symbol
    return None


def parse(text: str) -> dict:
    raw = text.strip()
    t = raw.lower().replace("dollars", "").replace("$", "")
    t = re.sub(r"\s+", " ", t)
    toks = t.split()
    symbol = _find_symbol(t)

    m = re.search(r"\b(buy|sell|short|long|purchase|go long|go short)\b", t)
    if m:
        verb = m.group(1)
        side = "sell" if verb in ("sell", "short", "go short") else "buy"
        qty = None
        after = t[m.end():].split()
        for tok in after[:4]:
            n = _num(tok)
            if n is not None:
                qty = n
                break
        if qty is not None and "half" in after[:3] and qty != 0.5:
            qty += 0.5
        order: dict = {"symbol": symbol, "side": side, "qty": qty, "type": "market"}
        lm = re.search(r"\b(?:at|limit(?: price)?(?: of)?)\s+([\d,.]+)", t)
        if lm and "market" not in t[lm.start() - 8 : lm.start()]:
            order.update(type="limit", limit_price=float(lm.group(1).replace(",", "")))
        sm = re.search(r"stop(?: loss)?(?: at)?\s+([\d,.]+)", t)
        if sm:
            order["stop_loss"] = float(sm.group(1).replace(",", ""))
        tp = re.search(r"(?:take profit|target)(?: at)?\s+([\d,.]+)", t)
        if tp:
            order["take_profit"] = float(tp.group(1).replace(",", ""))
        missing = [k for k in ("symbol", "qty") if not order.get(k)]
        return {"intent": "place_order", "order": order, "requires_confirmation": True, "missing": missing, "transcript": raw,
                "speech": (f"{side.capitalize()} {order['qty']:g} {resolve(symbol).display}" if not missing else
                           f"I need the {' and '.join(missing)} to place that order.")}

    if re.search(r"\b(close|exit|flatten)\b", t):
        if "all" in toks:
            return {"intent": "close_all", "requires_confirmation": True, "transcript": raw, "speech": "Close all positions?"}
        return {"intent": "close_position", "symbol": symbol, "requires_confirmation": True, "transcript": raw,
                "missing": [] if symbol else ["symbol"], "speech": f"Close {resolve(symbol).display}?" if symbol else "Which position?"}

    if re.search(r"\b(cancel)\b", t) and "order" in t:
        return {"intent": "cancel_orders", "symbol": symbol, "requires_confirmation": True, "transcript": raw,
                "speech": "Cancel open orders" + (f" for {resolve(symbol).display}" if symbol else "") + "?"}

    if re.search(r"\b(alert|notify|tell me)\b", t):
        pm = re.search(r"(above|over|below|under)\s+([\d,.]+)", t)
        if symbol and pm:
            cond = "above" if pm.group(1) in ("above", "over") else "below"
            return {"intent": "create_alert", "symbol": symbol, "condition": cond, "price": float(pm.group(2).replace(",", "")),
                    "requires_confirmation": False, "transcript": raw, "speech": f"Alert set for {resolve(symbol).display} {cond} {pm.group(2)}"}

    if re.search(r"\b(chart|show|open|go to|navigate)\b", t) and symbol and not any(k in toks for k in NAV):
        return {"intent": "show_chart", "symbol": symbol, "transcript": raw, "speech": f"Showing {resolve(symbol).display}"}

    if re.search(r"\b(price|quote|how much|trading at|what is|what's)\b", t) and symbol:
        return {"intent": "get_quote", "symbol": symbol, "transcript": raw, "speech": None}

    if re.search(r"\b(balance|equity|buying power|how am i doing|p&l|profit)\b", t):
        return {"intent": "account_summary", "transcript": raw, "speech": None}

    for word, route in NAV.items():
        if re.search(rf"\b{word}\b", t):
            return {"intent": "navigate", "route": route, "transcript": raw, "speech": f"Opening {word}"}

    if symbol:
        return {"intent": "show_chart", "symbol": symbol, "transcript": raw, "speech": f"Showing {resolve(symbol).display}"}
    return {"intent": "unknown", "transcript": raw,
            "speech": "Sorry, I didn't catch that. Try 'buy 2 Apple', 'price of bitcoin' or 'open portfolio'."}
