# Plappy Bird

An embeddable **Flappy Bird** game packaged as a self-contained **microservice**: the game, an admin panel to re-skin it, an event log for awarding points, and a leaderboard. One Docker image, one port, configured entirely through environment variables.

- **Game**: HTML5 canvas + vanilla JS, UI styled with Tailwind CSS.
- **Admin panel** (`/admin`): fixed credentials from `.env`. Change the bird, pipes, background, ground, logo, sounds, colors, text and physics with a live preview. Browse events, manage the leaderboard.
- **Events**: an append-only log (`run.started`, `run.pipe_passed`, `run.ended`, `player.personal_best`, ...) that a host system polls to award points.
- **Leaderboard**: daily / weekly / all-time.
- **Embeddable**: host systems launch the game in an `<iframe>` with an HMAC-signed player identity.

> Product spec: [PRD.md](PRD.md) · Integration: [docs/INTEGRATION.md](docs/INTEGRATION.md) · Deploy: [DEPLOYMENT.md](DEPLOYMENT.md) · Contributor notes: [CLAUDE.md](CLAUDE.md)

## Quick start

Requires Node.js 20+ (and a C++ toolchain the first time, because `better-sqlite3` compiles from source).

```bash
npm install
cp .env.example .env        # then edit the secrets, at minimum ADMIN_PASSWORD
npm run build               # compiles Tailwind CSS -> public/css/app.css
npm start                   # http://localhost:3000
```

Development with auto-reload (server + Tailwind watch): `npm run dev`.

| URL | What |
|---|---|
| `http://localhost:3000/` | The game (guest nickname prompt unless launched with a token) |
| `http://localhost:3000/admin` | Admin panel (redirects to the login page) |

In development (`NODE_ENV` not `production`) missing secrets fall back to insecure defaults with a console warning. In production the server **refuses to start** with missing, placeholder or too-short secrets.

### With Docker

```bash
cp .env.example .env        # fill in real secrets (see DEPLOYMENT.md)
docker compose up -d --build
```

## Configuration

All configuration is via environment variables (`.env` is loaded automatically).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database + uploaded assets. **Persist this.** |
| `ADMIN_USERNAME` | `admin` | Admin login |
| `ADMIN_PASSWORD` | dev: `admin` | Admin password (min 8 chars in production) |
| `JWT_SECRET` | random per boot (dev) | Signs admin cookies and player sessions (min 16 chars) |
| `INTEGRATION_API_KEY` | dev default | `X-API-Key` for the host system's `/api/v1/*` calls |
| `PLAYER_TOKEN_SECRET` | dev default | Shared secret the host uses to sign launch tokens |
| `ALLOW_GUESTS` | `true` | Allow nickname-only players when there is no launch token |
| `CORS_ORIGINS` | none | Comma-separated origins allowed to call `/api` from a browser |
| `FRAME_ANCESTORS` | `'self'` | Comma-separated origins allowed to iframe the game (admin is never frameable) |
| `TRUST_PROXY` | off | Number of proxy hops, so rate limits see real client IPs |
| `COOKIE_SECURE` | `true` in production | `Secure` flag on the admin cookie. Needs HTTPS (or `localhost`) |

Generate secrets with `openssl rand -hex 32`.

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Production server |
| `npm run dev` | Server with `--watch` plus Tailwind watch |
| `npm run build` | Build minified Tailwind CSS |
| `npm test` | Run the Vitest + Supertest suite |
| `npm run launch-url -- user_42 "Jane"` | Print a signed launch URL for testing embedded play |

## Testing it by hand

Use this checklist to verify everything.

**Game**
1. Open `/`, enter a nickname, tap/click/press Space to start. Bird flaps, pipes scroll, score counts when you pass a pipe.
2. Hit a pipe or the ground: white flash, bird drops, **Game Over** panel with score, best and a medal (bronze at 10, silver 20, gold 30, platinum 40).
3. `P` pauses; switching tabs pauses; the 🔊 button mutes; 🏆 opens the leaderboard.
4. After a game the panel shows `Rank #N all-time` (the server accepted your run).

**Admin** (`/admin`)
1. Wrong password is rejected; 5 failed attempts per minute are rate-limited.
2. **Dashboard**: stat cards and the latest events.
3. **Assets**: upload a PNG (bird, pipe, ...) or a sound.
4. **Theme editor**: pick the uploaded bird (set *frames* to match a sprite strip), change title/colors/gravity, watch the live preview, **Save & publish**, then reload `/`: the game uses the new theme. **Rollback** restores an older version.
5. **Events**: play a round and watch `run.started` → `run.pipe_passed` × score → `run.ended` appear; filter, open the JSON drawer, export CSV.
6. **Leaderboard**: remove an entry; reset a period.

**Integration**
```bash
npm run launch-url -- user_42 "Jane Doe"          # open the printed URL: you play as user_42
curl -H "X-API-Key: $INTEGRATION_API_KEY" "http://localhost:3000/api/v1/events?after=0"
node examples/consume-events.js                    # example points-awarding worker
```

## How score integrity works

The browser can never be fully trusted, so the server validates each run: it issues a run id when play starts, receives timestamped pipe-pass ticks, and rejects runs whose ticks are impossible (too fast, in the future, wrong total, run too long). Rejected runs produce a `run.rejected` event and **no** reward events: `run.pipe_passed`, `run.milestone`, `run.ended` and friends are only emitted after a run is fully validated. This stops casual tampering; it does not stop a determined bot. See PRD §7.

## Project layout

```
server/        Express app, SQLite, auth, routes, services (runs, leaderboard, theme config, assets)
shared/        defaults.js: world constants, theme schema, helpers shared by server + both frontends
public/        Game client (canvas engine in js/game/)
admin/         Admin panel (static SPA, JS modules per page)
src/           Tailwind source
tests/         Vitest: API, anti-cheat, and the headless engine
scripts/       launch-url helper
examples/      host page + points-awarding worker
docs/          Integration guide
```

## Art & licensing

The game ships with **original, procedurally drawn** placeholder art and synthesized sounds. The original Flappy Bird assets are copyrighted and are not included; upload your own through the admin panel.
