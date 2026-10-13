import { Router } from 'express';
import { HttpError } from '../util.js';
import { createGuest, upsertPlayer } from '../services/players.js';
import { issueSession, publicPlayer, requirePlayer, verifyLaunchToken } from '../auth/player.js';
import { getCurrent } from '../services/gameConfig.js';
import * as runs from '../services/runs.js';
import * as leaderboard from '../services/leaderboard.js';

export function publicRoutes(db, cfg) {
  const r = Router();
  const auth = requirePlayer(db, cfg);

  r.get('/health', (req, res) => res.json({ ok: true }));

  r.get('/config', (req, res) => {
    const { version, config } = getCurrent(db);
    res.set('Cache-Control', 'no-store').json({ version, config, allowGuests: cfg.allowGuests });
  });

  r.post('/session', (req, res) => {
    const { token, nickname } = req.body || {};
    let player;
    if (token !== undefined) {
      const { userId, displayName } = verifyLaunchToken(cfg.playerTokenSecret, token);
      player = upsertPlayer(db, { externalUserId: userId, displayName, isGuest: false });
    } else {
      if (!cfg.allowGuests) throw new HttpError(403, 'guests_disabled', 'Guest play is disabled; launch the game from the host application');
      const name = typeof nickname === 'string' ? nickname.trim().replace(/\s+/g, ' ') : '';
      if (name.length < 1 || name.length > 16) throw new HttpError(400, 'invalid_nickname', 'Nickname must be 1-16 characters');
      player = createGuest(db, name);
    }
    res.json({ session: issueSession(cfg, player), player: publicPlayer(player) });
  });

  r.get('/session/me', auth, (req, res) => res.json({ player: publicPlayer(req.player) }));

  r.post('/runs', auth, (req, res) => res.status(201).json(runs.startRun(db, req.player)));
  r.post('/runs/:id/ticks', auth, (req, res) => res.json(runs.addTicks(db, req.player, req.params.id, req.body?.ticks)));
  r.post('/runs/:id/end', auth, (req, res) => res.json(runs.endRun(db, req.player, req.params.id, req.body)));

  const limitOf = (q) => Math.min(Math.max(parseInt(q, 10) || 50, 1), 100);

  r.get('/leaderboard', (req, res) => {
    const period = req.query.period || 'all';
    const entries = leaderboard.top(db, period, limitOf(req.query.limit)).map((e) => ({
      rank: e.rank, displayName: e.displayName, score: e.score, isGuest: e.isGuest, endedAt: e.endedAt,
    }));
    res.json({ period, entries });
  });

  r.get('/leaderboard/me', auth, (req, res) => {
    const out = {};
    for (const p of leaderboard.PERIODS) {
      const e = leaderboard.entryFor(db, p, req.player.external_user_id);
      out[p] = e ? { rank: e.rank, score: e.score } : null;
    }
    res.json(out);
  });

  return r;
}
