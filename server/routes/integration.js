import { Router } from 'express';
import { HttpError } from '../util.js';
import { requireApiKey } from '../auth/apiKey.js';
import { queryEvents } from '../events.js';
import * as players from '../services/players.js';
import * as leaderboard from '../services/leaderboard.js';

export function integrationRoutes(db, cfg) {
  const r = Router();
  r.use(requireApiKey(cfg));

  r.get('/events', (req, res) => {
    const after = req.query.after === undefined || req.query.after === '' ? 0 : Number(req.query.after);
    if (!Number.isInteger(after) || after < 0) throw new HttpError(400, 'invalid_cursor', 'after must be a non-negative integer');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
    const events = queryEvents(db, {
      after, type: req.query.type || undefined, playerId: req.query.userId || undefined, limit, order: 'asc',
    });
    // With a type/user filter the cursor must still advance past non-matching rows, so
    // it's the last returned id (consumers re-poll from there; rows in between never match).
    res.json({ events, nextCursor: events.length ? events[events.length - 1].id : after });
  });

  r.get('/players/:userId', (req, res) => {
    const s = players.stats(db, req.params.userId);
    if (!s) throw new HttpError(404, 'not_found', 'Player not found');
    res.json(s);
  });

  r.get('/leaderboard', (req, res) => {
    const period = req.query.period || 'all';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
    res.json({ period, entries: leaderboard.top(db, period, limit) });
  });

  return r;
}
