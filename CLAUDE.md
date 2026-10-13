# CLAUDE.md

Guidance for working on this repo. Read `PRD.md` for the product spec and `README.md` for usage.

## What this is
An embeddable Flappy Bird microservice: Node/Express + SQLite (`better-sqlite3`) backend, vanilla-JS canvas game, Tailwind-styled UI, admin SPA. ES modules everywhere (`"type": "module"`).

## Commands
```bash
npm install && npm run build   # build Tailwind CSS (public/css/app.css is gitignored, rebuild after editing any class names or src/tailwind.css)
npm run dev                    # server --watch + tailwind --watch
npm test                       # vitest run (API, anti-cheat, headless engine)
npx vitest run tests/api.test.js -t "leaderboard"   # a single test
npm run launch-url -- user_1 "Name"                 # signed launch URL
```
Tailwind is **v3** (`tailwind.config.cjs`, scans `public/**` and `admin/**` for classes). New utility classes in HTML/JS need a rebuild.

## Architecture
- `server/app.js` builds the Express app (`createApp({cfg, db})`, used by tests with an in-memory DB). `server/index.js` only boots it.
- **Layering**: `routes/*` (HTTP, thin) → `services/*` (logic, synchronous better-sqlite3) → `db.js`. Auth middleware lives in `auth/`.
- **Events**: `server/events.js` `emit()` is the **only** writer of the `events` table. Never `INSERT INTO events` anywhere else. Future webhooks hook into `bus.on('event')`.
- **Runs / anti-cheat** (`services/runs.js`): ticks are validated and *staged* in `runs.ticks`; reward-relevant events (`run.pipe_passed`, `run.milestone`, `run.ended`, `player.personal_best`, `leaderboard.top_n`) are emitted in one transaction only when the run ends validly. Keep it that way, otherwise rejected runs leak reward events.
- **`shared/defaults.js` is the single source of truth** for world constants, the default theme, the `FIELDS` schema (server validation *and* admin form generation), event types, medals, and `minFirstPassMs`. Adding a theme option = add to `DEFAULT_CONFIG` + `FIELDS` (+ use it in the renderer/engine). No server code change needed.
- **Game engine** (`public/js/game/engine.js`) is canvas-only and reused by the admin live preview (`preview: true`). Fixed 60 Hz timestep (`STEP_MS`); physics values are per-frame. Default art is procedural (`sprites.js`); uploads override it (`assets.js`).
- **Client/server timing contract**: the engine's pipe timing must stay consistent with `LIMITS`/`minFirstPassMs` in the server. `tests/engine.test.js` runs the real engine headlessly and submits to the real API; keep it green when changing physics, spawning or scoring.

## Conventions & gotchas
- **CSP is strict** (`script-src 'self'`): no inline `<script>` or inline event handlers. Put JS in files. Inline `style=` attributes are allowed.
- **Game UI units**: `#stage` sets `font-size` to the canvas scale in px, so `1em` = 1 virtual game pixel. Use `em` for overlay sizes. An element's own `font-size: 14em` changes what its own `em` means, so put positions on elements that keep the stage font size (see `.pb-icon` / `.pb-glyph` in `src/tailwind.css`).
- **Always escape** user-controlled strings in `innerHTML` (`esc()` in `admin/js/lib.js`, `public/js/main.js`). Player names and filenames are user input.
- **Uploads**: type is decided by magic bytes (`services/assets.js` `sniff`), never by client mimetype; SVG is deliberately unsupported.
- **Admin**: JWT in an httpOnly `SameSite=Strict` cookie + Origin check on state-changing requests. Admin HTML is only served to a logged-in admin (`app.js`).
- Leaderboard `daily`/`weekly` are rolling 24 h / 7 d windows; ties go to the earliest `ended_at`.
- `window.__pb` (the engine) is exposed on `localhost` only, as a test/debug handle.
- Browser testing tip: background tabs get no `requestAnimationFrame`; drive the engine manually with `__pb.update()` / `__pb.draw()`. The server compares tick timestamps with wall-clock time, so a bot stepped faster than real time is (correctly) rejected; backdate `runs.started_at` in the dev DB to simulate.
- `better-sqlite3` v13 compiles from source: Docker uses a separate `deps` stage with build tools.

## Testing
Vitest + Supertest (`tests/`). API tests use `makeApp()` from `tests/helpers.js` (in-memory SQLite, fresh app per test). Add a test for any new endpoint, validation rule or event.

## Don'ts
- Don't commit `.env`, `data/`, or `public/css/app.css`.
- Don't add reward-relevant events outside the validated end-of-run path.
- Don't loosen the CSP or the upload type checks without a reason.
