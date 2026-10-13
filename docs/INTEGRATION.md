# Integration guide

How a host system (your main app) embeds Plappy Bird, identifies its users, and consumes events to award points. The service never talks to your system: your backend **signs** launch tokens and **polls** events.

```
 Host backend ──signs token──▶ Host frontend ──<iframe ?token=>──▶ Plappy Bird
      ▲                                                                │
      └────────── polls GET /api/v1/events (X-API-Key) ◀───────────────┘
```

## 1. Secrets to exchange
| Secret | Used by | Purpose |
|---|---|---|
| `PLAYER_TOKEN_SECRET` | host **backend** | HMAC-sign launch tokens |
| `INTEGRATION_API_KEY` | host **backend** | Call `/api/v1/*` |

Never expose either to browsers.

## 2. Launch a player (signed token)
Token format: `base64url(JSON payload) + "." + base64url(HMAC_SHA256(PLAYER_TOKEN_SECRET, base64url(payload)))`

Payload: `{ "userId": "<your stable user id>", "displayName": "<shown on leaderboard, ≤40 chars>", "exp": <unix seconds> }`

- `userId` is the stable id your system uses (≤128 chars). It appears as `playerId` in every event. It must not start with `guest:`.
- Use a short expiry (a few minutes). The token is only used to open a session; the game strips it from the URL immediately.
- base64url = URL-safe alphabet (`-` `_`), **no padding**.

**Node.js**
```js
import { createHmac } from 'node:crypto';
const b64 = (s) => Buffer.from(s).toString('base64url');
export function launchToken(secret, userId, displayName, ttl = 300) {
  const payload = b64(JSON.stringify({ userId, displayName, exp: Math.floor(Date.now() / 1000) + ttl }));
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
```

**Python**
```python
import base64, hashlib, hmac, json, time
def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def launch_token(secret, user_id, display_name, ttl=300):
    payload = b64url(json.dumps({"userId": user_id, "displayName": display_name, "exp": int(time.time()) + ttl}).encode())
    return payload + "." + b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
```

**PHP**
```php
function b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function launch_token(string $secret, string $userId, string $name, int $ttl = 300): string {
    $payload = b64url(json_encode(['userId' => $userId, 'displayName' => $name, 'exp' => time() + $ttl], JSON_UNESCAPED_UNICODE));
    return $payload . '.' . b64url(hash_hmac('sha256', $payload, $secret, true));
}
```

## 3. Embed
```html
<iframe src="https://game.example.com/?token=<token>" width="432" height="768"
        allow="autoplay" style="border:0" title="Plappy Bird"></iframe>
```
- Add your origin to the service's `FRAME_ANCESTORS` (and `CORS_ORIGINS` if your *browser* code calls its API).
- The game scales to fit its container, keeping a 9:16 portrait ratio. Give the iframe a portrait box.
- Invalid or expired tokens show a "link is invalid or has expired" screen, so generate a fresh token on each page view.
- For local testing: `npm run launch-url -- user_42 "Jane"` and `examples/host-page.html`.

Without a token the game falls back to guest play (nickname prompt) if `ALLOW_GUESTS=true`, otherwise it asks players to launch from the host app.

## 4. Consume events (award points)
```
GET /api/v1/events?after=<cursor>&limit=100[&type=run.ended][&userId=user_42]
X-API-Key: <INTEGRATION_API_KEY>
→ { "events": [ ... ascending by id ... ], "nextCursor": 1042 }
```
Algorithm for your worker:
1. Load your stored cursor (start at `0`).
2. Request `after=<cursor>`. For each event: **skip if its `uuid` is already processed**, then apply your rules.
3. Persist `nextCursor` (ideally in the same DB transaction as the points you awarded).
4. If `events` was empty, sleep a few seconds, otherwise loop immediately.

Delivery is **at-least-once and ordered**: ids are monotonic and gap-free, so a stored cursor never skips events. Dedupe on `uuid` (a unique index in your DB is the simplest way). A runnable example is in `examples/consume-events.js`.

### Event shape
```json
{ "id": 1042, "uuid": "6f1c2a9e-...", "type": "run.ended", "playerId": "user_42",
  "runId": "b3e0...", "payload": { "score": 27, "durationMs": 41250, "flaps": 96, "medal": "silver" },
  "createdAt": "2026-10-13T10:22:31.512Z" }
```

### Event catalogue
| Type | When | Payload |
|---|---|---|
| `player.joined` | First time a player is seen | `{ displayName, isGuest }` |
| `run.started` | Player starts a round | `{ runId, configVersion }` |
| `run.pipe_passed` | One per point, **emitted when the run ends validly** | `{ score, t }` (`t` = ms into the run) |
| `run.milestone` | Score reaches 10, 25, 50, 100, 250, 500, 1000 | `{ score }` |
| `run.ended` | Run finished and validated | `{ score, durationMs, flaps, medal }` |
| `run.rejected` | Run failed validation (no reward events follow) | `{ reason }` |
| `player.personal_best` | New personal best | `{ score, previous }` |
| `leaderboard.top_n` | Player's best run is in the top 10 (`all` / `weekly`) | `{ rank, period }` |
| `admin.config_updated` | Theme saved / rolled back | `{ version, by }` |
| `admin.run_removed` | Admin removed a run | `{ score, by }` |
| `admin.leaderboard_reset` | Admin reset a leaderboard period | `{ period, removedRuns, by }` |

Notes for point rules:
- **Pick one primary rule to avoid double counting**, e.g. 1 point per `run.pipe_passed`, *or* points from `run.ended.score`, not both.
- Reward events (`run.pipe_passed`, `run.milestone`, `run.ended`, `player.personal_best`, `leaderboard.top_n`) appear only after the whole run is validated. A player who closes the tab mid-run only produces `run.started`.
- Ignore `admin.*` events for rewards. If an admin removes a run (`admin.run_removed`) and you want to claw back points, match it by `runId`.
- `run.rejected` is useful for fraud monitoring.

## 5. Other endpoints (all with `X-API-Key`)
| Endpoint | Returns |
|---|---|
| `GET /api/v1/players/:userId` | `{ userId, displayName, isGuest, bestScore, totalRuns, totalPipes, lastPlayedAt }` (404 if never played) |
| `GET /api/v1/leaderboard?period=all\|weekly\|daily&limit=100` | `{ period, entries: [{ rank, userId, displayName, score, isGuest, endedAt, runId }] }` |

`weekly` = last 7 days and `daily` = last 24 hours (rolling windows). Each player appears once with their best run in the period.

## 6. Errors
JSON: `{ "error": { "code": "...", "message": "..." } }`. Common: `401 unauthorized` (bad/missing API key), `400 invalid_cursor`, `400 invalid_period`, `404 not_found`, `429 rate_limited`.

## 7. Limits
- 60 runs per player per hour; a run is invalid after 30 minutes.
- General API rate limit: 600 requests/min per IP (poll every few seconds, not in a tight loop).
- Anti-cheat deters casual tampering only. Treat points as low-stakes, or add your own caps (e.g. max points per user per day).
