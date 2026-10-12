# Deploying RM Markets: Neon (database) + Railway (app)

You need a GitHub repo with this code, a [Neon](https://neon.tech) account and a [Railway](https://railway.com) account.

## 1. Database on Neon
1. Neon console → **New Project** (pick the region closest to your Railway region, e.g. AWS eu-central-1 / Frankfurt for South Africa + Railway EU).
2. **Connection Details** → choose **Pooled connection** and copy the URL. It looks like
   `postgresql://neondb_owner:****@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. That's it: the backend creates all tables on first start. (`sslmode=require` is added automatically if missing.)

## 1b. Redis on Railway
In your Railway project: **+ New → Database → Redis**. (Optional for a single instance, required if you run more than one backend instance.)

## 2. API service (`backend/`)
1. **+ New → GitHub Repo** (same repo). In the service **Settings → Root Directory** set `backend`. Railway picks up `backend/railway.json` and the Dockerfile.
2. **Variables**:
   * `DATABASE_URL` = your **Neon pooled connection string** (paste it as-is)
   * `REDIS_URL` = `${{Redis.REDIS_URL}}`
   * `JWT_SECRET` = a long random string (`python -c "import secrets;print(secrets.token_urlsafe(48))"`)
   * `APP_ENV` = `production`
   * `CORS_ORIGINS` = your web URL, e.g. `https://rm-markets-web.up.railway.app`
   * optional: `FINNHUB_API_KEY`, `POLYGON_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `NEWSAPI_KEY`, `GOOGLE_CLIENT_ID`
3. **Settings → Networking → Generate Domain**. Check `https://<api-domain>/health` returns `{"status":"ok"}`.

Tables are created automatically on first start.

## 3. Web service (`web/`)
1. **+ New → GitHub Repo**, Root Directory `web`.
2. Variables (used at build time): `VITE_API_URL=https://<api-domain>` (and optionally `VITE_GOOGLE_CLIENT_ID`).
3. Generate a domain and open it.

## 4. Mobile app
Set `EXPO_PUBLIC_API_URL=https://<api-domain>` in `mobile/.env` (local) or in `mobile/eas.json` (cloud builds), then
`npx eas-cli@latest build -p android --profile preview` for an installable APK.

## Scaling out (multiple backend instances)
Keep exactly one instance running the feed/matcher:
* Service **rm-markets-worker**: same repo/root `backend`, variables `SERVICE_MODE=market`, `RUN_MARKET_FEED=true`, replicas = 1.
* Service **rm-markets-api**: `SERVICE_MODE=trading,analytics`, `RUN_MARKET_FEED=false`, replicas = 2+ (Settings → Replicas).
Both share the same Neon database and Redis. On Neon's free tier keep `DB_POOL_SIZE` small (default 5 per instance) and use the pooled (`-pooler`) host. Point the web app at the API service; WebSockets work on any replica because each
replica subscribes to Redis pub/sub. To split further (trading vs analytics) use path routing as in `infra/nginx.conf`.

## CDN
Put Cloudflare (or any CDN) in front of the web domain: hashed files under `/assets/` are served with
`Cache-Control: public, max-age=31536000, immutable`. For a separate asset host build the web app with `VITE_CDN_URL`.
Historical candle endpoints send `s-maxage`, so a CDN in front of the API can cache them too.

## CI/CD
`.github/workflows/ci.yml` runs lint + tests (SQLite and Postgres/Redis), web typecheck/tests/build, mobile typecheck/tests/bundle,
pushes Docker images to GHCR, and, when the repo variable `RAILWAY_DEPLOY=true` and secret `RAILWAY_TOKEN` (a Railway project token)
are set, deploys `backend` and `web` with `railway up`. Railway's own GitHub auto-deploy also works, in which case leave `RAILWAY_DEPLOY` unset.

## Kubernetes / Docker
* `docker compose -f infra/docker-compose.yml up --build`: full microservice topology (nginx LB on :8080, web on :4173).
* `infra/k8s/`: namespace, config, deployments with HPAs, ingress with WebSocket timeouts, and dev-grade Postgres/Redis.
