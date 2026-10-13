import { randomInt, randomUUID } from 'node:crypto';
import { MILESTONES, medalFor, minFirstPassMs } from '../../shared/defaults.js';
import { emit } from '../events.js';
import { HttpError, nowIso } from '../util.js';
import { getCurrent, getVersion } from './gameConfig.js';
import * as leaderboard from './leaderboard.js';

export const LIMITS = {
  runsPerHour: 60,
  maxRunMs: 30 * 60 * 1000,
  maxTicksPerRequest: 50,
  clockSlackMs: 2000, // client game-time may lead the server's wall clock by network jitter
  intervalTolerance: 0.85, // consecutive pipe passes must be >= 85% of the spawn interval apart
  firstPassTolerance: 0.9,
};

const getRun = (db, player, id) => {
  const run = db.prepare('SELECT * FROM runs WHERE id = ? AND player_id = ?').get(id, player.id);
  if (!run) throw new HttpError(404, 'run_not_found', 'Run not found');
  return run;
};

const configFor = (db, run) => (getVersion(db, run.config_version) || getCurrent(db)).config;

export function startRun(db, player) {
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { n } = db.prepare('SELECT COUNT(*) n FROM runs WHERE player_id = ? AND started_at >= ?').get(player.id, since);
  if (n >= LIMITS.runsPerHour) throw new HttpError(429, 'rate_limited', 'Too many runs, try again later');

  const { version } = getCurrent(db);
  const id = randomUUID();
  const seed = randomInt(1, 2 ** 31);
  db.transaction(() => {
    db.prepare("INSERT INTO runs (id, player_id, seed, config_version, status, started_at) VALUES (?, ?, ?, ?, 'active', ?)")
      .run(id, player.id, seed, version, nowIso());
    emit(db, 'run.started', { playerId: player.external_user_id, runId: id, payload: { runId: id, configVersion: version } });
  })();
  return { runId: id, seed };
}

function reject(db, player, run, reason) {
  db.transaction(() => {
    db.prepare("UPDATE runs SET status = 'rejected', reject_reason = ?, ended_at = ? WHERE id = ?").run(reason, nowIso(), run.id);
    emit(db, 'run.rejected', { playerId: player.external_user_id, runId: run.id, payload: { reason } });
  })();
  throw new HttpError(422, 'run_rejected', `Run rejected: ${reason}`);
}

const requireActive = (run) => {
  if (run.status !== 'active') throw new HttpError(409, 'run_closed', `Run is already ${run.status}`);
};

export function addTicks(db, player, runId, input) {
  const run = getRun(db, player, runId);
  requireActive(run);
  if (!Array.isArray(input) || input.length === 0 || input.length > LIMITS.maxTicksPerRequest) {
    throw new HttpError(400, 'invalid_ticks', `ticks must be an array of 1-${LIMITS.maxTicksPerRequest} items`);
  }
  const cfg = configFor(db, run);
  const interval = cfg.pipes.spawnInterval;
  const elapsed = Date.now() - Date.parse(run.started_at);
  if (elapsed > LIMITS.maxRunMs) reject(db, player, run, 'run_expired');

  const ticks = JSON.parse(run.ticks);
  for (const item of input) {
    const t = item?.t;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) throw new HttpError(400, 'invalid_ticks', 'each tick needs a numeric t >= 0');
    if (t > elapsed + LIMITS.clockSlackMs) reject(db, player, run, 'tick_in_future');
    const prev = ticks.length ? ticks[ticks.length - 1] : null;
    if (prev === null) {
      if (t < minFirstPassMs(cfg) * LIMITS.firstPassTolerance) reject(db, player, run, 'first_pipe_too_fast');
    } else if (t - prev < interval * LIMITS.intervalTolerance) {
      reject(db, player, run, 'pipes_passed_too_fast');
    }
    ticks.push(t);
  }
  if (ticks.length > Math.floor((elapsed + LIMITS.clockSlackMs) / interval) + 1) reject(db, player, run, 'score_exceeds_elapsed_time');

  db.prepare('UPDATE runs SET ticks = ? WHERE id = ?').run(JSON.stringify(ticks), run.id);
  return { accepted: ticks.length };
}

export function endRun(db, player, runId, body) {
  const run = getRun(db, player, runId);
  requireActive(run);
  const cfg = configFor(db, run);
  const interval = cfg.pipes.spawnInterval;
  const elapsed = Date.now() - Date.parse(run.started_at);
  const ticks = JSON.parse(run.ticks);
  const score = body?.score;
  const flaps = Number.isInteger(body?.flaps) && body.flaps >= 0 && body.flaps < 100000 ? body.flaps : 0;

  if (elapsed > LIMITS.maxRunMs) reject(db, player, run, 'run_expired');
  if (!Number.isInteger(score) || score < 0) throw new HttpError(400, 'invalid_score', 'score must be a non-negative integer');
  if (score !== ticks.length) reject(db, player, run, 'score_mismatch');
  if (score > Math.floor((elapsed + LIMITS.clockSlackMs) / interval) + 1) reject(db, player, run, 'score_exceeds_elapsed_time');

  const endedAt = nowIso();
  const pid = player.external_user_id;

  return db.transaction(() => {
    db.prepare("UPDATE runs SET status = 'finished', score = ?, flaps = ?, ended_at = ?, duration_ms = ? WHERE id = ?")
      .run(score, flaps, endedAt, elapsed, run.id);

    // Reward-relevant events are only written once the whole run has been validated.
    ticks.forEach((t, i) => {
      emit(db, 'run.pipe_passed', { playerId: pid, runId: run.id, payload: { score: i + 1, t: Math.round(t) } });
    });
    for (const m of MILESTONES) {
      if (score >= m) emit(db, 'run.milestone', { playerId: pid, runId: run.id, payload: { score: m } });
    }
    const medal = medalFor(score, cfg.medals);
    emit(db, 'run.ended', { playerId: pid, runId: run.id, payload: { score, durationMs: elapsed, flaps, medal } });

    const previous = player.best_score;
    const isPersonalBest = score > previous;
    if (isPersonalBest) {
      db.prepare('UPDATE players SET best_score = ? WHERE id = ?').run(score, player.id);
      emit(db, 'player.personal_best', { playerId: pid, runId: run.id, payload: { score, previous } });
    }

    let rank = null;
    for (const period of ['all', 'weekly']) {
      const entry = leaderboard.entryFor(db, period, pid);
      if (period === 'all') rank = entry?.rank ?? null;
      if (entry && entry.runId === run.id && entry.rank <= 10) {
        emit(db, 'leaderboard.top_n', { playerId: pid, runId: run.id, payload: { rank: entry.rank, period } });
      }
    }
    return { score, best: Math.max(previous, score), rank, medal, isPersonalBest };
  })();
}
