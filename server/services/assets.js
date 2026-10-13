import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, nowIso } from '../util.js';
import { assetIdsInUse, getCurrent } from './gameConfig.js';

export const MAX_ASSET_BYTES = 1024 * 1024;

// Type is decided from the file's magic bytes, never from the client-supplied mimetype.
export function sniff(buf) {
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', ext: '.png', kind: 'image' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg', kind: 'image' };
  if (ascii(0, 3) === 'GIF') return { mime: 'image/gif', ext: '.gif', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: '.wav', kind: 'audio' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: '.ogg', kind: 'audio' };
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: '.mp3', kind: 'audio' };
  return null;
}

const uploadsDir = (cfg) => path.join(cfg.dataDir, 'uploads');

export function create(db, cfg, { buffer, originalName }) {
  const type = sniff(buffer);
  if (!type) throw new HttpError(415, 'unsupported_type', 'Only PNG, JPEG, WEBP, GIF images and MP3, OGG, WAV audio are allowed');
  const id = randomBytes(16).toString('hex');
  const storedAs = id + type.ext;
  fs.mkdirSync(uploadsDir(cfg), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir(cfg), storedAs), buffer);
  const filename = String(originalName || 'upload').replace(/[^\w.\- ]/g, '_').slice(0, 100);
  db.prepare('INSERT INTO assets (id, filename, mime, size, kind, stored_as, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, filename, type.mime, buffer.length, type.kind, storedAs, nowIso());
  return get(db, id);
}

const toApi = (r) => r && { id: r.id, filename: r.filename, mime: r.mime, size: r.size, kind: r.kind, url: `/uploads/${r.id}`, createdAt: r.created_at };
export const get = (db, id) => toApi(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
export const list = (db) => db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all().map(toApi);

export function filePath(db, cfg, id) {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
  return row && { path: path.join(uploadsDir(cfg), row.stored_as), mime: row.mime };
}

export function remove(db, cfg, id) {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'not_found', 'Asset not found');
  if (assetIdsInUse(getCurrent(db).config).includes(id)) {
    throw new HttpError(409, 'asset_in_use', 'Asset is used by the current theme; change the theme first');
  }
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  fs.rmSync(path.join(uploadsDir(cfg), row.stored_as), { force: true });
}
