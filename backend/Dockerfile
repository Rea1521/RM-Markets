# ---- RM Markets API (FastAPI) ----
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
RUN useradd -m rm && chown -R rm /app
USER rm
ENV PORT=8000 WEB_CONCURRENCY=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs http://localhost:${PORT}/health || exit 1
# One uvicorn worker per container: scale horizontally (replicas) rather than with workers,
# so the single market-feed instance stays single (RUN_MARKET_FEED=true on exactly one service).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --ws-ping-interval 20"]
