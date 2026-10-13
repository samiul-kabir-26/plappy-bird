import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { HttpError, safeEqual } from '../util.js';
import { getById } from '../services/players.js';

// Host backends build a launch token as:  base64url(JSON{userId,displayName,exp}) + "." + base64url(HMAC_SHA256(secret, payload))
export function signLaunchToken(secret, { userId, displayName, exp }) {
  const payload = Buffer.from(JSON.stringify({ userId, displayName, exp })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verifyLaunchToken(secret, token, nowMs = Date.now()) {
  const invalid = (msg) => new HttpError(401, 'invalid_token', msg);
  if (typeof token !== 'string') throw invalid('Missing launch token');
  const parts = token.split('.');
  if (parts.length !== 2) throw invalid('Malformed launch token');
  const expected = createHmac('sha256', secret).update(parts[0]).digest('base64url');
  if (!safeEqual(expected, parts[1])) throw invalid('Bad launch token signature');
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw invalid('Malformed launch token'); }
  if (typeof p?.exp !== 'number' || p.exp * 1000 <= nowMs) throw invalid('Launch token expired');
  if (typeof p.userId !== 'string' || !p.userId || p.userId.length > 128 || p.userId.startsWith('guest:')) throw invalid('Invalid userId');
  const displayName = (typeof p.displayName === 'string' && p.displayName.trim() ? p.displayName : p.userId).trim().slice(0, 40);
  return { userId: p.userId, displayName };
}

export function issueSession(cfg, player) {
  const expiresIn = player.is_guest ? '30d' : '24h';
  return jwt.sign({ typ: 'player', pid: player.id }, cfg.jwtSecret, { expiresIn });
}

export const publicPlayer = (p) => ({ userId: p.external_user_id, displayName: p.display_name, isGuest: !!p.is_guest, best: p.best_score });

export function requirePlayer(db, cfg) {
  return (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    if (!m) return next(new HttpError(401, 'unauthorized', 'Missing player session'));
    try {
      const claims = jwt.verify(m[1], cfg.jwtSecret, { algorithms: ['HS256'] });
      if (claims.typ !== 'player') throw new Error('wrong type');
      const player = getById(db, claims.pid);
      if (!player) throw new Error('unknown player');
      req.player = player;
      next();
    } catch {
      next(new HttpError(401, 'unauthorized', 'Invalid or expired player session'));
    }
  };
}
