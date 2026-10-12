import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["MARKET_PROVIDER_MODE"] = "sim"
os.environ["RUN_MARKET_FEED"] = "false"
os.environ.setdefault("APP_ENV", "test")
os.environ["JWT_SECRET"] = "test-secret-key-that-is-long-enough-123456"
os.environ.setdefault("RATE_LIMIT_PER_MINUTE", "100000")
os.environ.setdefault("ORDER_RATE_LIMIT_PER_MINUTE", "100000")

import uuid  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_rate_limits():
    from app.cache import get_cache

    c = get_cache()
    if hasattr(c, "_data"):
        for k in [k for k in c._data if k.startswith("rl:")]:
            c._data.pop(k, None)
    else:  # redis
        for k in c.r.scan_iter("rl:*"):
            c.r.delete(k)
    yield


def _register(client):
    tag = uuid.uuid4().hex[:8]
    r = client.post("/api/auth/register", json={"email": f"u{tag}@example.com", "username": f"user_{tag}", "password": "Passw0rd!x"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def auth(client):
    data = _register(client)
    return {"Authorization": f"Bearer {data['access_token']}"}, data


@pytest.fixture
def headers(auth):
    return auth[0]
