# Plappy Bird — Product Requirements Document

| | |
|---|---|
| **Product** | Plappy Bird — embeddable Flappy Bird game microservice |
| **Status** | v1.0 implemented (see §17 for deviations from this spec) |
| **Date** | 2026-10-13 |
| **Owner** | Samiul Kabir |

---

## 1. Overview

Plappy Bird is a faithful recreation of the classic *Flappy Bird* gameplay, packaged as a **self-contained microservice** that any host system can embed (iframe / direct URL) and integrate with via a REST API.

It ships with:

1. **The game** — HTML5 canvas + vanilla JavaScript, UI chrome styled with Tailwind CSS.
2. **An admin panel** — protected by fixed credentials from environment variables; lets an operator re-skin the game (bird, pipes, background, colors, text, sounds, physics) and inspect all events.
3. **An event log** — an append-only stream of gameplay events that an external system will consume to award points to users (the point-awarding feature itself is out of scope and will be integrated later).
4. **A leaderboard** — all-time, weekly and daily rankings.

### 1.1 Goals

- Gameplay, pacing and screens that feel *exactly* like Flappy Bird.
- Zero coupling to any host: one Docker image, one port, configured entirely via `.env`.
- Clean integration surfaces: signed player identity in, events + leaderboard out.
- Non-technical operators can re-theme the game without a redeploy.

### 1.2 Non-goals (v1)

- Awarding points / rewards logic (host system's responsibility).
- Multiplayer, native mobile apps, multi-tenancy.
- Webhooks and iframe `postMessage` events (planned for v2 — see §16).

### 1.3 Legal note

Original Flappy Bird art and sounds are copyrighted. Plappy Bird ships with **original/placeholder default assets**; operators may upload their own via the admin panel.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Game rendering | HTML5 `<canvas>`, vanilla ES modules, fixed 60 Hz timestep |
| UI chrome (menus, overlays, admin) | Tailwind CSS, compiled with the Tailwind CLI (no CDN in production) |
| Server | Node.js 20+, Express |
| Database | SQLite via `better-sqlite3`; plain SQL migration files |
| Auth | Admin: env creds → JWT in httpOnly cookie · Integration: `X-API-Key` header · Players: HMAC-signed launch token |
| File uploads | `multer` → `${DATA_DIR}/uploads`; PNG/JPEG/WEBP/GIF only, ≤ 1 MB (SVG rejected — XSS risk) |
| Security headers | `helmet`, CSP with configurable `frame-ancestors`, CORS allow-list, `express-rate-limit` |
| Tests | Vitest (unit) + Supertest (API) |
| Packaging | `Dockerfile` + `docker-compose.yml` with a persistent volume for `/data` |

---

## 3. Configuration (`.env`)

```dotenv
PORT=3000

# Admin panel (fixed credentials)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
JWT_SECRET=replace-with-long-random-string

# Integration (host system reads events / leaderboard)
INTEGRATION_API_KEY=replace-with-long-random-string

# Player identity (shared with host system to sign launch tokens)
PLAYER_TOKEN_SECRET=replace-with-long-random-string
ALLOW_GUESTS=true

# Embedding
CORS_ORIGINS=https://host.example.com
FRAME_ANCESTORS=https://host.example.com

# Storage
DATA_DIR=./data
```

- The server refuses to start if any secret is missing or left at a default placeholder in `NODE_ENV=production`.
- Admin credential comparison uses `crypto.timingSafeEqual`; login is rate-limited (5 attempts / minute / IP).

---

## 4. Game Specification (Flappy Bird parity)

### 4.1 States

```
READY ──tap──▶ PLAYING ──collision──▶ DYING ──bird hits ground──▶ GAME_OVER ──restart──▶ READY
```

| State | Behaviour |
|---|---|
| `READY` | "Get Ready" title + tap hint, bird bobs in place, ground scrolls, no pipes, no gravity |
| `PLAYING` | Gravity active, pipes spawn and scroll, score shown top-centre |
| `DYING` | White flash + hit sound, pipes/ground stop, bird nose-dives to the ground |
| `GAME_OVER` | Slide-in panel: score, best, medal; **Restart** and **Leaderboard** buttons |

### 4.2 Physics & world (defaults; all admin-tunable)

| Parameter | Default | Notes |
|---|---|---|
| Virtual resolution | 288 × 512 | Scaled to fit the viewport, integer scaling where possible, letterboxed |
| Gravity | 0.25 px/frame² | |
| Flap impulse | −4.6 px/frame | Sets velocity (does not add) |
| Terminal velocity | 8 px/frame | |
| Rotation | −25° on flap → +90° when falling fast | |
| Pipe speed | 2 px/frame | Ground scrolls at the same speed |
| Pipe gap | 100 px | |
| Pipe spawn interval | 1500 ms | Gap centre randomised within safe bounds (seeded PRNG) |

- Fixed-timestep loop (accumulator) so gameplay is identical at 60/120/144 Hz.
- Collision: bird hitbox (slightly inset circle/AABB) vs pipes and ground. The top of the screen is **not** lethal (bird can fly above pipes), matching the original.
- Scoring: +1 when the bird's x passes a pipe's centre.

### 4.3 Medals (thresholds admin-tunable)

| Medal | Score |
|---|---|
| Bronze | 10 |
| Silver | 20 |
| Gold | 30 |
| Platinum | 40 |

### 4.4 Input, audio, misc

- Input: `Space`, `↑`, mouse click, touch tap. `P` or tab blur → pause.
- Audio: flap, point, hit, die (Web Audio API). Mute toggle persisted in `localStorage`.
- Sprites: bird supports a single image **or** a horizontal sprite strip with configurable frame count (default 3-frame wing flap). Any asset that fails to load falls back to the bundled default.
- Personal best cached locally and reconciled with the server.
- Works offline as a pure game if the API is unreachable (scores simply aren't submitted).

---

## 5. Admin-Configurable Theme

Stored as a single versioned JSON document in `game_config`.

| Group | Fields |
|---|---|
| **Assets** | bird sprite + frame count, pipe (top & bottom, or one image auto-mirrored), background (day/night), ground, logo, sounds (flap/point/hit/die) |
| **Colors & text** | sky color (when no bg image), font family, title text, "Get Ready" text, button colors, score color |
| **Gameplay tuning** | gravity, flap strength, terminal velocity, pipe speed, gap, spawn interval, medal thresholds |

Behaviour:

- Admin edits in a form with a **live preview canvas** (the real engine in preview mode).
- **Save** bumps `version`, persists the document and emits `admin.config_updated`.
- Clients load `GET /api/config` at startup; new games pick up changes without redeploy.
- Last 10 versions kept; one-click **rollback**.
- Server validates the document against a schema (numeric ranges, asset IDs must exist).

---

## 6. Player Identity

### 6.1 Embedded launch (primary)

The host system's **backend** signs a launch token:

```
payload = base64url(JSON.stringify({ userId, displayName, exp }))
token   = payload + "." + base64url(HMAC_SHA256(PLAYER_TOKEN_SECRET, payload))
```

Host embeds: `<iframe src="https://game.example.com/?token=<token>">`

The game calls `POST /api/session` with the token; the server verifies signature and `exp`, upserts the player by `external_user_id`, and returns a short-lived player session (bearer token, kept in memory / `sessionStorage`).

### 6.2 Standalone (guest)

If `ALLOW_GUESTS=true` and no token is present, the player enters a nickname; the server creates a player with id `guest:<uuid>`. Guests appear on the leaderboard with a "guest" badge.

---

## 7. Score Integrity (Anti-Cheat)

Because the game runs client-side, scores can never be made fully tamper-proof. v1 targets **casual tampering**:

1. `POST /api/runs` → server creates a run with `runId` and a random `seed` (pipe layout derives from the seed).
2. Client sends batched `pipe_passed` ticks (with client timestamps) to `POST /api/runs/:id/ticks`, then `POST /api/runs/:id/end`.
3. Server **rejects** the run if:
   - score > `floor(elapsedMs / spawnInterval) + 1`
   - ticks arrive faster than physically possible (interval < spawnInterval × tolerance)
   - run already ended, or older than 30 minutes
   - final score ≠ number of accepted ticks
4. Rejected runs are stored with `status = rejected`, emit `run.rejected`, and produce **no** reward-relevant events.
5. Rate limit: max 60 runs / hour / player.

Admins can additionally delete suspicious runs from the leaderboard.

---

## 8. Event System

The core integration feature. Every meaningful action is recorded as an immutable event that a host system can consume to award points.

### 8.1 Storage

`events` table — append-only:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | Monotonic; used as the consumer **cursor** |
| `uuid` | TEXT UNIQUE | Idempotency / dedupe key for consumers |
| `type` | TEXT | See catalogue below |
| `player_id` | TEXT NULL | `external_user_id` of the player |
| `run_id` | TEXT NULL | |
| `payload` | JSON | |
| `created_at` | TEXT (ISO 8601) | |

### 8.2 Event catalogue

| Type | Emitted when | Payload |
|---|---|---|
| `player.joined` | Player seen for the first time | `{ displayName, isGuest }` |
| `run.started` | Run created | `{ runId, configVersion }` |
| `run.pipe_passed` | Each validated point | `{ score }` |
| `run.milestone` | Score reaches 10, 25, 50, 100, … | `{ score }` |
| `run.ended` | Run finished and validated | `{ score, durationMs, flaps, medal }` |
| `run.rejected` | Run failed validation | `{ reason }` |
| `player.personal_best` | New personal best | `{ score, previous }` |
| `leaderboard.top_n` | Player enters top 10 (all-time / weekly) | `{ rank, period }` |
| `admin.config_updated` | Theme saved / rolled back | `{ version }` |

Individual flaps are **not** stored as events (too noisy); the count is summarised in `run.ended`.

### 8.3 Single writer

All events go through `server/events.js` → `emit(type, { playerId, runId, payload })`. This is the single extension point where webhooks / message-queue publishing will be added in v2.

### 8.4 Example event

```json
{
  "id": 1042,
  "uuid": "6f1c2a9e-4b7d-4c1e-9f0a-2d3b5e8c7a11",
  "type": "run.ended",
  "playerId": "user_8812",
  "runId": "b3e0…",
  "payload": { "score": 27, "durationMs": 41250, "flaps": 96, "medal": "silver" },
  "createdAt": "2026-10-13T10:22:31.512Z"
}
```

---

## 9. API

All responses are JSON. Errors: `{ "error": { "code": "...", "message": "..." } }`.

### 9.1 Public — game client

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Current theme + tuning |
| POST | `/api/session` | `{ token }` or `{ nickname }` → player session |
| POST | `/api/runs` | Start run → `{ runId, seed }` |
| POST | `/api/runs/:id/ticks` | `{ ticks: [{ t }] }` batched pipe passes |
| POST | `/api/runs/:id/end` | `{ flaps }` → `{ score, best, rank, medal }` |
| GET | `/api/leaderboard?period=all\|weekly\|daily&limit=50` | Rankings |
| GET | `/api/leaderboard/me` | Current player's rank and best |

### 9.2 Integration — host systems (`X-API-Key`, versioned)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/events?after=<cursor>&type=&userId=&limit=100` | `{ events, nextCursor }` — ascending by `id` |
| GET | `/api/v1/players/:userId` | `{ bestScore, totalRuns, totalPipes, lastPlayedAt }` |
| GET | `/api/v1/leaderboard?period=` | Rankings with `userId`s |

Consumption model: the consumer persists `nextCursor` and polls. Delivery is **at-least-once**; consumers dedupe by `uuid`.

### 9.3 Admin (`/admin/api/*`, JWT cookie)

Cookie: `httpOnly`, `Secure`, `SameSite=Strict`; state-changing requests also check `Origin`.

| Method | Path | Description |
|---|---|---|
| POST | `/admin/api/login` | `{ username, password }` |
| POST | `/admin/api/logout` | |
| GET / PUT | `/admin/api/config` | Read / save theme |
| GET | `/admin/api/config/history` | Last 10 versions |
| POST | `/admin/api/config/rollback/:version` | Restore a version |
| GET / POST | `/admin/api/assets` | List / upload |
| DELETE | `/admin/api/assets/:id` | Delete (blocked if in use by current config) |
| GET | `/admin/api/events` | Filter by type, player, date range; paginated; `?format=csv` export |
| GET | `/admin/api/leaderboard` | Rankings incl. guests and run IDs |
| DELETE | `/admin/api/runs/:id` | Remove a run (e.g. cheated score) |
| POST | `/admin/api/leaderboard/reset?period=` | Reset rankings |
| GET | `/admin/api/stats` | Runs today, active players, average score, top score |

---

## 10. Database Schema

```sql
CREATE TABLE players (
  id               INTEGER PRIMARY KEY,
  external_user_id TEXT UNIQUE NOT NULL,
  display_name     TEXT NOT NULL,
  is_guest         INTEGER NOT NULL DEFAULT 0,
  best_score       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE runs (
  id             TEXT PRIMARY KEY,          -- uuid
  player_id      INTEGER NOT NULL REFERENCES players(id),
  seed           INTEGER NOT NULL,
  config_version INTEGER NOT NULL,
  score          INTEGER NOT NULL DEFAULT 0,
  flaps          INTEGER,
  status         TEXT NOT NULL,             -- active | finished | rejected | removed
  reject_reason  TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  duration_ms    INTEGER
);
CREATE INDEX idx_runs_board ON runs(status, score DESC, ended_at);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT UNIQUE NOT NULL,
  type       TEXT NOT NULL,
  player_id  TEXT,
  run_id     TEXT,
  payload    TEXT NOT NULL,                 -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_type   ON events(type, id);
CREATE INDEX idx_events_player ON events(player_id, id);

CREATE TABLE game_config (
  version    INTEGER PRIMARY KEY,
  data       TEXT NOT NULL,                 -- JSON
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  kind       TEXT NOT NULL,                 -- image | audio
  created_at TEXT NOT NULL
);
```

**Leaderboard rule:** each player's best `finished` run within the period; ties broken by earliest `ended_at`. SQLite runs in WAL mode.

---

## 11. Admin Panel UI (`/admin`, Tailwind)

| Page | Contents |
|---|---|
| Login | Username / password form |
| Dashboard | Stat cards (runs today, active players, avg / top score) + latest events feed |
| Theme Editor | Tabs: Assets · Colors & Text · Gameplay. Live preview canvas on the right. **Save** / **Rollback** |
| Assets | Upload grid with previews, delete |
| Events | Filterable table (type, player, date), auto-refresh every 5 s, JSON detail drawer, CSV export |
| Leaderboard | All-time / weekly / daily tabs, remove entry, reset |

Responsive down to tablet width; uploaded asset URLs are served from `/uploads/<id>` with correct `Content-Type` and `X-Content-Type-Options: nosniff`.

---

## 12. Project Structure

```
.
├── server/
│   ├── index.js              # Express app, helmet/CSP, CORS, static serving
│   ├── config.js             # env loading + validation
│   ├── db.js                 # better-sqlite3 + migration runner
│   ├── migrations/           # 001_init.sql, ...
│   ├── events.js             # event bus (single writer)
│   ├── auth/
│   │   ├── admin.js          # login, JWT cookie middleware
│   │   ├── player.js         # launch-token verify, player session
│   │   └── apiKey.js         # X-API-Key middleware
│   ├── routes/
│   │   ├── public.js
│   │   ├── integration.js
│   │   └── admin.js
│   └── services/
│       ├── runs.js           # run lifecycle + validation
│       ├── leaderboard.js
│       ├── gameConfig.js
│       └── assets.js
├── public/                   # game client
│   ├── index.html
│   └── js/
│       ├── main.js
│       ├── api.js
│       └── game/
│           ├── engine.js     # loop, state machine (canvas-only, reusable in admin preview)
│           ├── physics.js
│           ├── pipes.js      # seeded PRNG layout
│           ├── renderer.js
│           ├── input.js
│           ├── audio.js
│           └── assets.js     # loader with default fallback
├── admin/
│   ├── index.html
│   ├── login.html
│   └── js/  dashboard.js  theme.js  assets.js  events.js  leaderboard.js
├── assets/default/           # bundled original sprites + sounds
├── src/tailwind.css
├── tailwind.config.js
├── tests/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── README.md
└── PRD.md
```

`engine.js` depends only on a `<canvas>` and a config object, so the admin Theme Editor reuses it for the live preview.

### npm scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Server with `--watch` + Tailwind in watch mode |
| `npm run build` | Compile Tailwind CSS (minified) |
| `npm start` | Production server |
| `npm test` | Vitest + Supertest |

---

## 13. Integration Guide (for host systems)

1. **Deploy** the service and set `.env` secrets; add the host origin to `CORS_ORIGINS` and `FRAME_ANCESTORS`.
2. **Launch** — host backend signs a player token (§6.1) using `PLAYER_TOKEN_SECRET`; host frontend renders
   `<iframe src="https://game.example.com/?token=…" allow="autoplay">`.
3. **Consume events** — a host worker polls:
   ```
   GET /api/v1/events?after=<lastCursor>&limit=100
   X-API-Key: <INTEGRATION_API_KEY>
   ```
   Dedupe by `uuid`, apply your own point rules (e.g. 1 point per `run.pipe_passed`, bonus on `player.personal_best` or `run.milestone`), then store `nextCursor`.
4. **Show rankings** — use `/api/v1/leaderboard` or let users see it inside the game.

---

## 14. Milestones

| # | Milestone | Deliverables |
|---|---|---|
| M1 | Scaffold | Express server, env validation, SQLite + migrations, Tailwind build, default assets |
| M2 | Game engine | Full Flappy Bird parity offline: states, physics, pipes, scoring, medals, audio, scaling |
| M3 | Players & runs | Launch tokens, guests, run lifecycle, anti-cheat validation, leaderboard |
| M4 | Events & integration API | Event bus, catalogue, `/api/v1/*` with API key + cursor |
| M5 | Admin panel | Auth, dashboard, theme editor with live preview, assets, events, leaderboard management |
| M6 | Ship | Dockerfile, compose, README + integration guide, test suite green |

---

## 15. Acceptance Criteria

- [ ] Game runs at a stable 60 fps on modern desktop and mobile browsers; controls, physics and pacing match Flappy Bird.
- [ ] Admin uploads a new bird image, saves → a freshly loaded game shows the new bird, no redeploy.
- [ ] Theme changes are visible in the live preview before saving; rollback restores the previous version.
- [ ] Every finished valid run produces `run.started`, `run.pipe_passed` × score, and `run.ended`, retrievable via `/api/v1/events` with gap-free cursor pagination.
- [ ] A run with a forged score (e.g. 500 points in 5 s) is rejected, emits `run.rejected`, and does not appear on the leaderboard.
- [ ] Leaderboard returns correct rankings for all-time, weekly and daily periods.
- [ ] Wrong admin credentials → `401`; missing/invalid API key → `401`; invalid/expired player token → `401`.
- [ ] Game can be embedded only from origins listed in `FRAME_ANCESTORS`.
- [ ] `docker compose up` with a filled `.env` brings up a fully working service; data persists across restarts.

---

## 16. Future Work (v2+)

- Webhooks (HMAC-signed, retries with backoff) via the event bus.
- `window.postMessage` events to the iframe parent for real-time host UI updates.
- Multi-tenancy (multiple host systems, per-tenant themes and leaderboards).
- Swap SQLite → PostgreSQL behind the same service layer.
- Seasonal leaderboards and scheduled resets.
- Server-side replay verification (input log + deterministic simulation) for stronger anti-cheat.

---

## 17. Implementation notes (deviations & additions)

What the implementation does differently from, or adds to, the spec above:

- **Default art is procedural.** Sprites are drawn in code (`public/js/game/sprites.js`) and sounds are synthesized, so there is no `assets/default/` folder.
- **Reward events are emitted when a run ends** (after full validation), not as each tick arrives. Ticks are staged on the run row. This guarantees a rejected run never produced `run.pipe_passed`, `run.milestone` or `run.ended` events (§7.4). A run abandoned mid-play only has `run.started`.
- **Extra event types:** `admin.run_removed` and `admin.leaderboard_reset` (audit trail). `run.pipe_passed` payload also carries `t` (ms into the run).
- **Rolling periods:** `daily` = last 24 h, `weekly` = last 7 days.
- **Audio uploads** (MP3 / OGG / WAV) are supported in addition to images, since sounds are themeable. File type is determined from magic bytes.
- **Extra endpoints:** `GET /api/health`, `GET /api/session/me` (resume a guest session), `GET /admin/api/me`.
- **Config history:** versions are never deleted; the history endpoint returns the latest 10. Rollback publishes a *new* version with the old content.
- **Tailwind v3** is used (CLI build, `public/css/app.css`, gitignored; built in the Docker image).
- **Leaderboard moderation:** removing a run or resetting a period marks runs `removed` (kept for audit) and recomputes personal bests.
- `window.__pb` exposes the engine on `localhost` only, as a testing handle.
