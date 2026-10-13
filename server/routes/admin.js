import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { EVENT_TYPES } from '../../shared/defaults.js';
import { HttpError } from '../util.js';
import { emit, queryEvents } from '../events.js';
import { checkCredentials, clearSession, requireAdmin, sameOrigin, setSession } from '../auth/admin.js';
import * as gameConfig from '../services/gameConfig.js';
import * as assets from '../services/assets.js';
import * as leaderboard from '../services/leaderboard.js';
import { recomputeBest } from '../services/players.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: assets.MAX_ASSET_BYTES, files: 1 } });

// Neutralise spreadsheet formula injection (player names are user-controlled).
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function adminRoutes(db, cfg, { loginMax = 5 } = {}) {
  const r = Router();
  r.use(sameOrigin);

  const loginLimiter = rateLimit({
    windowMs: 60_000, limit: loginMax, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
    handler: (req, res, next) => next(new HttpError(429, 'rate_limited', 'Too many login attempts, wait a minute')),
  });

  r.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (!checkCredentials(cfg, username, password)) throw new HttpError(401, 'invalid_credentials', 'Invalid username or password');
    setSession(cfg, res);
    res.json({ ok: true, username: cfg.adminUsername });
  });
  r.post('/logout', (req, res) => { clearSession(cfg, res); res.json({ ok: true }); });

  r.use(requireAdmin(cfg));

  r.get('/me', (req, res) => res.json({ username: req.admin, eventTypes: EVENT_TYPES }));

  // Theme
  r.get('/config', (req, res) => res.json(gameConfig.getCurrent(db)));
  r.put('/config', (req, res) => res.json(gameConfig.save(db, req.body, req.admin)));
  r.get('/config/history', (req, res) => res.json({ versions: gameConfig.history(db, 10) }));
  r.post('/config/rollback/:version', (req, res) => res.json(gameConfig.rollback(db, Number(req.params.version), req.admin)));

  // Assets
  r.get('/assets', (req, res) => res.json({ assets: assets.list(db) }));
  r.post('/assets', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return next(err.code === 'LIMIT_FILE_SIZE' ? new HttpError(413, 'too_large', 'File exceeds 1 MB') : new HttpError(400, 'upload_failed', err.message));
      if (!req.file) return next(new HttpError(400, 'no_file', 'Send the file in a multipart field named "file"'));
      try {
        res.status(201).json(assets.create(db, cfg, { buffer: req.file.buffer, originalName: req.file.originalname }));
      } catch (e) { next(e); }
    });
  });
  r.delete('/assets/:id', (req, res) => { assets.remove(db, cfg, req.params.id); res.json({ ok: true }); });

  // Events
  r.get('/events', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const csv = req.query.format === 'csv';
    const before = req.query.before ? Number(req.query.before) : undefined;
    if (before !== undefined && !Number.isInteger(before)) throw new HttpError(400, 'invalid_cursor', 'before must be an integer');
    const dateOk = (d) => (d && !Number.isNaN(Date.parse(d)) ? new Date(d).toISOString() : undefined);
    const events = queryEvents(db, {
      before, type: req.query.type || undefined, playerId: req.query.player || undefined,
      from: dateOk(req.query.from), to: dateOk(req.query.to), limit: csv ? 10000 : limit, order: 'desc',
    });
    if (!csv) return res.json({ events, nextBefore: events.length === limit ? events[events.length - 1].id : null });
    const lines = ['id,uuid,type,player_id,run_id,created_at,payload'];
    for (const e of events) {
      lines.push([e.id, e.uuid, e.type, e.playerId, e.runId, e.createdAt, JSON.stringify(e.payload)].map(csvCell).join(','));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="events.csv"').send(lines.join('\n'));
  });

  // Leaderboard moderation
  r.get('/leaderboard', (req, res) => {
    const period = req.query.period || 'all';
    res.json({ period, entries: leaderboard.top(db, period, 200) });
  });
  r.delete('/runs/:id', (req, res) => {
    const run = db.prepare('SELECT r.*, p.external_user_id uid FROM runs r JOIN players p ON p.id = r.player_id WHERE r.id = ?').get(req.params.id);
    if (!run) throw new HttpError(404, 'not_found', 'Run not found');
    db.transaction(() => {
      db.prepare("UPDATE runs SET status = 'removed' WHERE id = ?").run(run.id);
      recomputeBest(db, run.player_id);
      emit(db, 'admin.run_removed', { playerId: run.uid, runId: run.id, payload: { score: run.score, by: req.admin } });
    })();
    res.json({ ok: true });
  });
  r.post('/leaderboard/reset', (req, res) => {
    const period = req.query.period || 'all';
    const since = leaderboard.cutoff(period);
    const removed = db.transaction(() => {
      const n = db.prepare("UPDATE runs SET status = 'removed' WHERE status = 'finished' AND ended_at >= ?").run(since).changes;
      recomputeBest(db);
      emit(db, 'admin.leaderboard_reset', { payload: { period, removedRuns: n, by: req.admin } });
      return n;
    })();
    res.json({ ok: true, removedRuns: removed });
  });

  r.get('/stats', (req, res) => {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const since = dayStart.toISOString();
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    res.json({
      runsToday: one('SELECT COUNT(*) n FROM runs WHERE started_at >= ?', since).n,
      activePlayersToday: one('SELECT COUNT(DISTINCT player_id) n FROM runs WHERE started_at >= ?', since).n,
      totalPlayers: one('SELECT COUNT(*) n FROM players').n,
      averageScore: Math.round((one("SELECT AVG(score) a FROM runs WHERE status = 'finished'").a || 0) * 10) / 10,
      topScore: one("SELECT COALESCE(MAX(score),0) m FROM runs WHERE status = 'finished'").m,
      rejectedToday: one("SELECT COUNT(*) n FROM runs WHERE status = 'rejected' AND started_at >= ?", since).n,
    });
  });

  return r;
}
