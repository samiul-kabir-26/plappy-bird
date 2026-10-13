import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { nowIso } from './util.js';

// The single writer of the events table. Future webhook / queue publishers
// subscribe via `bus.on('event', fn)`; nothing else should INSERT into events.
export const bus = new EventEmitter();

export function emit(db, type, { playerId = null, runId = null, payload = {}, at } = {}) {
  const createdAt = at || nowIso();
  const uuid = randomUUID();
  const info = db
    .prepare('INSERT INTO events (uuid, type, player_id, run_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid, type, playerId, runId, JSON.stringify(payload), createdAt);
  const event = { id: Number(info.lastInsertRowid), uuid, type, playerId, runId, payload, createdAt };
  bus.emit('event', event);
  return event;
}

export function formatEvent(row) {
  return {
    id: row.id,
    uuid: row.uuid,
    type: row.type,
    playerId: row.player_id,
    runId: row.run_id,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  };
}

// Cursor-paginated query. `order` is 'asc' (integration consumers) or 'desc' (admin UI).
export function queryEvents(db, { after, before, type, playerId, from, to, limit = 100, order = 'asc' } = {}) {
  const where = [];
  const args = [];
  if (after != null) { where.push('id > ?'); args.push(after); }
  if (before != null) { where.push('id < ?'); args.push(before); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (playerId) { where.push('player_id = ?'); args.push(playerId); }
  if (from) { where.push('created_at >= ?'); args.push(from); }
  if (to) { where.push('created_at <= ?'); args.push(to); }
  const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ${order === 'desc' ? 'DESC' : 'ASC'} LIMIT ?`;
  return db.prepare(sql).all(...args, limit).map(formatEvent);
}
