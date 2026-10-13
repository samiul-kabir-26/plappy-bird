# Deployment

Plappy Bird is a single Node.js process with an embedded SQLite database. Deploy it as one container with one persistent volume behind an HTTPS reverse proxy.

## 1. Prerequisites
- A host with Docker + Docker Compose (or Node.js 20+ and a C++ toolchain for bare metal).
- A domain with TLS (the admin cookie is `Secure`), e.g. `game.example.com`.
- The origin(s) of the host application that will embed the game, e.g. `https://app.example.com`.

## 2. Configure
```bash
cp .env.example .env
```
Set real values (generate with `openssl rand -hex 32`):

```dotenv
NODE_ENV=production
ADMIN_USERNAME=ops-admin
ADMIN_PASSWORD=<long random or passphrase, min 8 chars>
JWT_SECRET=<openssl rand -hex 32>
INTEGRATION_API_KEY=<openssl rand -hex 32>      # give to the host's backend only
PLAYER_TOKEN_SECRET=<openssl rand -hex 32>      # give to the host's backend only
ALLOW_GUESTS=false                               # recommended when always embedded
CORS_ORIGINS=https://app.example.com
FRAME_ANCESTORS=https://app.example.com          # who may <iframe> the game
TRUST_PROXY=1                                    # one proxy in front
```
In production the server **will not start** if any secret is missing, a placeholder (`change-me`, `replace-with...`) or too short. `docker-compose.yml` sets `NODE_ENV`, `PORT` and `DATA_DIR=/data` for you.

Keep secrets out of git: `.env` is gitignored. Use your platform's secret store in CI/CD.

## 3. Run with Docker Compose
```bash
docker compose up -d --build
docker compose logs -f plappy-bird
curl http://localhost:3000/api/health      # {"ok":true}
```
- The database and uploads live in the named volume `plappy-data` (mounted at `/data`).
- The container runs as the unprivileged `node` user and has a built-in health check.
- Change the published port with `HOST_PORT=8080 docker compose up -d`.

## 4. Reverse proxy + TLS
Terminate TLS in front of the container and forward to port 3000.

**Caddy** (automatic HTTPS):
```caddyfile
game.example.com {
    reverse_proxy localhost:3000
}
```

**nginx**:
```nginx
server {
    listen 443 ssl http2;
    server_name game.example.com;
    # ssl_certificate / ssl_certificate_key ...
    client_max_body_size 2m;            # asset uploads are capped at 1 MB by the app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Set `TRUST_PROXY=1` so rate limiting (login, runs) uses the real client IP instead of the proxy's. Without it every user shares one rate-limit bucket.

> Plain-HTTP testing of a production build: the `Secure` admin cookie only works over HTTPS or `http://localhost`. Over plain HTTP on another host, either add TLS or set `COOKIE_SECURE=false` (not for real deployments).

## 5. Verify after deploy
1. `https://game.example.com/` loads the game; `/admin` redirects to the login page.
2. Log in, publish a theme change, reload the game and confirm it applied.
3. From the host app, open the iframe with a signed token (see [docs/INTEGRATION.md](docs/INTEGRATION.md)) and play a round.
4. `curl -H "X-API-Key: $INTEGRATION_API_KEY" https://game.example.com/api/v1/events` shows the run's events.
5. Embedding from an unlisted origin must be blocked by the browser (CSP `frame-ancestors`).

## 6. Backups
Everything stateful is in `DATA_DIR` (`plappy.db` plus `uploads/`). SQLite runs in WAL mode, so don't just copy `plappy.db` while the app is writing. Use one of:

```bash
# consistent online backup of the database (sqlite3 CLI inside a throwaway container)
docker compose exec plappy-bird node -e "
  const D=require('better-sqlite3');
  new D('/data/plappy.db').backup('/data/backup-'+Date.now()+'.db').then(()=>console.log('ok'))"

# copy the consistent backup + uploads out of the volume (skip the live WAL-mode db files)
docker run --rm -v plappy_plappy-data:/data -v "$PWD":/out busybox \
  tar czf /out/plappy-data.tgz -C /data --exclude='plappy.db*' .
```
(The volume name is prefixed by the compose project, run `docker volume ls` to confirm.) Schedule it and copy the archive off the host. To restore, stop the container, unpack into the volume, start again.

## 7. Upgrades
```bash
git pull
docker compose up -d --build
```
Database migrations (`server/migrations/*.sql`) are applied automatically on start, in order, once. Take a backup first for any release that adds a migration. Rolling back to an older image after a migration ran is not supported, restore the backup instead.

## 8. Operational notes
- **Single instance only.** SQLite plus in-process rate limiting mean you should run exactly one replica. Vertical scaling is plenty for this workload (writes are tiny). If you need multiple instances, move to PostgreSQL first (PRD §16).
- **Events are never deleted.** They grow with play volume (about one row per pipe passed). Archive or prune old rows if the DB gets large; the host's cursor must never point past pruned data it hasn't read.
- **Admin password rotation:** change `ADMIN_PASSWORD` and restart. Changing `JWT_SECRET` also signs everyone out (admins and players; players re-establish sessions automatically on next launch).
- **Rotating `PLAYER_TOKEN_SECRET` / `INTEGRATION_API_KEY`:** update the host backend at the same time as the service.
- **Logs:** stdout/stderr (`docker compose logs`). Startup warnings are prefixed `[config]`.
- **Monitoring:** poll `GET /api/health` (used by the Docker health check). The admin dashboard shows `Rejected today`, a spike usually means a buggy client or cheating attempts.

## 9. Bare metal (no Docker)
```bash
git clone <repo> && cd plappy-bird
npm ci --omit=dev        # needs python3, make, g++ for better-sqlite3
npm install --no-save tailwindcss@3 && npm run build     # or build CSS elsewhere and copy public/css/app.css
NODE_ENV=production node server/index.js
```
Run it under systemd:
```ini
[Unit]
Description=Plappy Bird
After=network.target

[Service]
WorkingDirectory=/opt/plappy-bird
EnvironmentFile=/opt/plappy-bird/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
User=plappy

[Install]
WantedBy=multi-user.target
```

## 10. Security checklist
- [ ] All secrets are unique random values, not the examples.
- [ ] HTTPS everywhere; `TRUST_PROXY` set to the real hop count.
- [ ] `FRAME_ANCESTORS` and `CORS_ORIGINS` list only your host app(s).
- [ ] `INTEGRATION_API_KEY` and `PLAYER_TOKEN_SECRET` are only known to the host's **backend**, never shipped to browsers.
- [ ] `ALLOW_GUESTS=false` if players should only come from the host app.
- [ ] `/data` volume is backed up.
- [ ] Optionally restrict `/admin` at the proxy (IP allow-list / VPN) as a second layer.

## 11. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Container exits immediately with `must be set to a non-placeholder value` | A secret is missing/placeholder/too short in `.env` |
| Admin login "works" but you're bounced to the login page | `Secure` cookie over plain HTTP, use HTTPS or (testing only) `COOKIE_SECURE=false` |
| Game shows blank in the host's iframe | Host origin missing from `FRAME_ANCESTORS` (check the console for a CSP error) |
| Host's browser calls to `/api` fail with CORS errors | Add the origin to `CORS_ORIGINS` (server-to-server calls with the API key don't need CORS) |
| "This game link is invalid or has expired" | Launch token signed with the wrong secret, or expired (`exp` is unix **seconds**) |
| Everyone gets `429` on login/runs | `TRUST_PROXY` not set, so all clients share the proxy's IP |
| `npm ci` fails on `better-sqlite3` | Install `python3 make g++` (Docker image handles this in its build stage) |
| Scores "not counted" for real players | Check events for `run.rejected` reasons; large clock-skew/latency can trip `tick_in_future` (server allows 2 s of slack) |
