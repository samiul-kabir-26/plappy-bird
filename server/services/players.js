import { randomUUID } from 'node:crypto';
import { emit } from '../events.js';
import { nowIso } from '../util.js';

export function upsertPlayer(db, { externalUserId, displayName, isGuest }) {
  return db.transaction(() => {
    let p = db.prepare('SELECT * FROM players WHERE external_user_id = ?').get(externalUserId);
    if (p) {
      if (p.display_name !== displayName) {
        db.prepare('UPDATE players SET display_name = ? WHERE id = ?').run(displayName, p.id);
        p.display_name = displayName;
      }
      return p;
    }
    const info = db
      .prepare('INSERT INTO players (external_user_id, display_name, is_guest, created_at) VALUES (?, ?, ?, ?)')
      .run(externalUserId, displayName, isGuest ? 1 : 0, nowIso());
    p = db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
    emit(db, 'player.joined', { playerId: externalUserId, payload: { displayName, isGuest: !!isGuest } });
    return p;
  })();
}

export const createGuest = (db, nickname) =>
  upsertPlayer(db, { externalUserId: `guest:${randomUUID()}`, displayName: nickname, isGuest: true });

export const getById = (db, id) => db.prepare('SELECT * FROM players WHERE id = ?').get(id);

export function stats(db, externalUserId) {
  const p = db.prepare('SELECT * FROM players WHERE external_user_id = ?').get(externalUserId);
  if (!p) return null;
  const agg = db
    .prepare("SELECT COUNT(*) runs, COALESCE(SUM(score),0) pipes, MAX(ended_at) last FROM runs WHERE player_id = ? AND status = 'finished'")
    .get(p.id);
  return {
    userId: p.external_user_id,
    displayName: p.display_name,
    isGuest: !!p.is_guest,
    bestScore: p.best_score,
    totalRuns: agg.runs,
    totalPipes: agg.pipes,
    lastPlayedAt: agg.last,
  };
}

export function recomputeBest(db, playerId) {
  db.prepare(
    "UPDATE players SET best_score = COALESCE((SELECT MAX(score) FROM runs WHERE player_id = players.id AND status = 'finished'), 0)" +
      (playerId ? ' WHERE id = ?' : '')
  ).run(...(playerId ? [playerId] : []));
}
