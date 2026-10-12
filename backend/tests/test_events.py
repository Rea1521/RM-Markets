from app.events import apply_fill


def test_open_add_reduce_flip():
    pos = {}
    assert apply_fill(pos, "X", "buy", 10, 100) == 0
    apply_fill(pos, "X", "buy", 10, 110)
    assert pos["X"]["qty"] == 20 and pos["X"]["avg_price"] == 105
    r = apply_fill(pos, "X", "sell", 5, 115)
    assert r == 50 and pos["X"]["qty"] == 15 and pos["X"]["avg_price"] == 105
    r = apply_fill(pos, "X", "sell", 25, 100)  # close 15 at -5 each, open short 10 @100
    assert r == -75 and pos["X"]["qty"] == -10 and pos["X"]["avg_price"] == 100
    r = apply_fill(pos, "X", "buy", 10, 90)  # cover short for +100
    assert r == 100 and pos["X"]["qty"] == 0
