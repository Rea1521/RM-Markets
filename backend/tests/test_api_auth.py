from tests.conftest import _register


def test_register_login_refresh_logout(client):
    data = _register(client)
    assert data["user"]["username"].startswith("user_")
    u = data["user"]
    r = client.post("/api/auth/login", json={"identifier": u["email"], "password": "Passw0rd!x"})
    assert r.status_code == 200
    tokens = r.json()
    h = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert client.get("/api/auth/me", headers=h).json()["id"] == u["id"]
    r = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    # access token cannot be used as refresh token
    assert client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]}).status_code == 401
    new_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.post("/api/auth/logout", headers=new_h).status_code == 200
    assert client.get("/api/auth/me", headers=new_h).status_code == 401  # revoked


def test_bad_credentials_and_duplicates(client):
    data = _register(client)
    assert client.post("/api/auth/login", json={"identifier": data["user"]["username"], "password": "wrongpass1"}).status_code == 401
    r = client.post("/api/auth/register", json={"email": data["user"]["email"], "username": "someone_else", "password": "Passw0rd!x"})
    assert r.status_code == 409


def test_validation(client):
    r = client.post("/api/auth/register", json={"email": "not-an-email", "username": "a", "password": "short"})
    assert r.status_code == 422 and r.json()["error"] == "validation_error"
    r = client.post("/api/auth/register", json={"email": "x@example.com", "username": "robert'); DROP TABLE users;--", "password": "Passw0rd1"})
    assert r.status_code == 422
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_demo_login(client):
    r = client.post("/api/auth/demo")
    assert r.status_code == 200 and r.json()["user"]["is_demo"]


def test_rate_limit_auth(client, monkeypatch):
    from app.config import get_settings
    from app.middleware import RateLimitMiddleware

    monkeypatch.setattr(RateLimitMiddleware, "WINDOW", 3600)  # avoid a minute rollover mid-test
    s = get_settings()
    old = s.auth_rate_limit_per_minute
    object.__setattr__(s, "auth_rate_limit_per_minute", 5)
    try:
        codes = [client.post("/api/auth/login", json={"identifier": "nobody@example.com", "password": "x"}).status_code for _ in range(8)]
    finally:
        object.__setattr__(s, "auth_rate_limit_per_minute", old)
    assert codes[:5] == [401] * 5 and codes[5:] == [429] * 3
