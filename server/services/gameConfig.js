import { DEFAULT_CONFIG, FIELDS, getPath, setPath } from '../../shared/defaults.js';
import { emit } from '../events.js';
import { HttpError, nowIso } from '../util.js';

const COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[\w\s,"'-]+$/;
const ASSET_ID = /^[0-9a-f]{32}$/;

export function ensureDefault(db) {
  const has = db.prepare('SELECT 1 FROM game_config LIMIT 1').get();
  if (!has) {
    db.prepare('INSERT INTO game_config (version, data, created_at, created_by) VALUES (1, ?, ?, ?)')
      .run(JSON.stringify(DEFAULT_CONFIG), nowIso(), 'system');
  }
}

const parse = (row) => row && { version: row.version, config: JSON.parse(row.data), createdAt: row.created_at, createdBy: row.created_by };

export const getCurrent = (db) => parse(db.prepare('SELECT * FROM game_config ORDER BY version DESC LIMIT 1').get());
export const getVersion = (db, v) => parse(db.prepare('SELECT * FROM game_config WHERE version = ?').get(v));
export const history = (db, n = 10) => db.prepare('SELECT * FROM game_config ORDER BY version DESC LIMIT ?').all(n).map(parse);

// Builds a clean config from untrusted input: unknown keys are dropped, missing
// ones fall back to defaults, every value is range/type checked.
export function validate(db, raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'invalid_config', 'Config must be an object');
  const out = structuredClone(DEFAULT_CONFIG);
  const errors = [];
  const assetStmt = db.prepare('SELECT kind FROM assets WHERE id = ?');

  for (const f of FIELDS) {
    const v = getPath(raw, f.path);
    if (v === undefined) continue;
    const bad = (msg) => errors.push(`${f.path}: ${msg}`);
    switch (f.type) {
      case 'string':
        if (typeof v !== 'string' || !v.trim() || v.length > f.max) bad(`must be 1-${f.max} characters`);
        else setPath(out, f.path, v);
        break;
      case 'font':
        if (typeof v !== 'string' || !FONT.test(v) || v.length > f.max) bad('invalid font family');
        else setPath(out, f.path, v);
        break;
      case 'color':
        if (typeof v !== 'string' || !COLOR.test(v)) bad('must be a #rrggbb color');
        else setPath(out, f.path, v.toLowerCase());
        break;
      case 'number':
      case 'int':
        if (typeof v !== 'number' || !Number.isFinite(v) || v < f.min || v > f.max || (f.type === 'int' && !Number.isInteger(v))) {
          bad(`must be ${f.type === 'int' ? 'an integer' : 'a number'} between ${f.min} and ${f.max}`);
        } else setPath(out, f.path, v);
        break;
      case 'asset':
        if (v === null) setPath(out, f.path, null);
        else if (typeof v !== 'string' || !ASSET_ID.test(v)) bad('invalid asset id');
        else {
          const row = assetStmt.get(v);
          if (!row) bad('asset does not exist');
          else if (row.kind !== f.kind) bad(`asset must be of kind ${f.kind}`);
          else setPath(out, f.path, v);
        }
        break;
    }
  }

  const m = out.medals;
  if (!(m.bronze < m.silver && m.silver < m.gold && m.gold < m.platinum)) {
    errors.push('medals: thresholds must increase bronze < silver < gold < platinum');
  }
  if (errors.length) throw new HttpError(400, 'invalid_config', 'Config validation failed', errors);
  return out;
}

function insert(db, config, by) {
  const next = (db.prepare('SELECT MAX(version) v FROM game_config').get().v || 0) + 1;
  db.prepare('INSERT INTO game_config (version, data, created_at, created_by) VALUES (?, ?, ?, ?)')
    .run(next, JSON.stringify(config), nowIso(), by);
  return next;
}

export function save(db, raw, by) {
  const config = validate(db, raw);
  return db.transaction(() => {
    const version = insert(db, config, by);
    emit(db, 'admin.config_updated', { payload: { version, by } });
    return { version, config };
  })();
}

export function rollback(db, version, by) {
  const target = getVersion(db, version);
  if (!target) throw new HttpError(404, 'not_found', 'Config version not found');
  const config = validate(db, target.config); // assets may have been deleted since
  return db.transaction(() => {
    const newVersion = insert(db, config, by);
    emit(db, 'admin.config_updated', { payload: { version: newVersion, rolledBackTo: version, by } });
    return { version: newVersion, config };
  })();
}

export function assetIdsInUse(config) {
  return Object.values(config.assets).filter((v) => typeof v === 'string');
}
