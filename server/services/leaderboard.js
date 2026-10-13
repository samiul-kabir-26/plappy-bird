import { HttpError } from '../util.js';

export const PERIODS = ['all', 'weekly', 'daily'];

export function cutoff(period) {
  if (period === 'all') return '';
  if (period === 'weekly') return new Date(Date.now() - 7 * 864e5).toISOString();
  if (period === 'daily') return new Date(Date.now() - 864e5).toISOString();
  throw new HttpError(400, 'invalid_period', `period must be one of ${PERIODS.join(', ')}`);
}

// Each player's best finished run in the period; ties go to whoever got there first.
const RANKED = `
  WITH best AS (
    SELECT r.player_id, r.id run_id, r.score, r.ended_at,
           ROW_NUMBER() OVER (PARTITION BY r.player_id ORDER BY r.score DESC, r.ended_at ASC) rn
    FROM runs r WHERE r.status = 'finished' AND r.score > 0 AND r.ended_at >= ?
  ), ranked AS (
    SELECT b.*, ROW_NUMBER() OVER (ORDER BY b.score DESC, b.ended_at ASC) rank FROM best b WHERE rn = 1
  )
  SELECT rk.rank, rk.score, rk.ended_at endedAt, rk.run_id runId,
         p.external_user_id userId, p.display_name displayName, p.is_guest isGuest
  FROM ranked rk JOIN players p ON p.id = rk.player_id`;

const shape = (r) => ({ ...r, isGuest: !!r.isGuest });

export function top(db, period = 'all', limit = 50) {
  return db.prepare(`${RANKED} ORDER BY rk.rank LIMIT ?`).all(cutoff(period), limit).map(shape);
}

export function entryFor(db, period, externalUserId) {
  const r = db.prepare(`${RANKED} WHERE p.external_user_id = ?`).get(cutoff(period), externalUserId);
  return r ? shape(r) : null;
}
