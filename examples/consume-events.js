// Example host-side worker: polls the events API, dedupes by uuid, and "awards points".
//   GAME_URL=http://localhost:3000 INTEGRATION_API_KEY=... node examples/consume-events.js
// Replace `awardPoints` and the cursor storage with your own system (DB / queue).
import fs from 'node:fs';

const GAME_URL = process.env.GAME_URL || 'http://localhost:3000';
const API_KEY = process.env.INTEGRATION_API_KEY;
const CURSOR_FILE = process.env.CURSOR_FILE || '.events-cursor';
const seen = new Set(); // in production: a unique index on event.uuid in your DB

const loadCursor = () => (fs.existsSync(CURSOR_FILE) ? Number(fs.readFileSync(CURSOR_FILE, 'utf8')) : 0);
const saveCursor = (c) => fs.writeFileSync(CURSOR_FILE, String(c));

// Example rules: 1 point per pipe, +20 for a personal best, +50 for a 25-pipe milestone.
function awardPoints(event) {
  const rules = {
    'run.pipe_passed': () => 1,
    'player.personal_best': () => 20,
    'run.milestone': (e) => (e.payload.score === 25 ? 50 : 0),
  };
  const points = rules[event.type]?.(event) ?? 0;
  if (points) console.log(`+${points} points -> ${event.playerId} (${event.type}, event ${event.id})`);
}

async function poll() {
  let cursor = loadCursor();
  for (;;) {
    const res = await fetch(`${GAME_URL}/api/v1/events?after=${cursor}&limit=200`, { headers: { 'X-API-Key': API_KEY } });
    if (!res.ok) throw new Error(`events API returned ${res.status}`);
    const { events, nextCursor } = await res.json();
    for (const e of events) {
      if (seen.has(e.uuid)) continue;
      seen.add(e.uuid);
      awardPoints(e);
    }
    if (nextCursor !== cursor) { cursor = nextCursor; saveCursor(cursor); }
    if (!events.length) await new Promise((r) => setTimeout(r, 5000));
  }
}

poll().catch((e) => { console.error(e); process.exit(1); });
