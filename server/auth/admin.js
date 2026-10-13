import jwt from 'jsonwebtoken';
import { HttpError, safeEqual } from '../util.js';

export const COOKIE = 'pb_admin';

export function checkCredentials(cfg, username, password) {
  // Evaluate both so timing doesn't reveal which one was wrong.
  const u = safeEqual(String(username ?? ''), cfg.adminUsername);
  const p = safeEqual(String(password ?? ''), cfg.adminPassword);
  return u && p;
}

export function setSession(cfg, res) {
  const token = jwt.sign({ typ: 'admin', sub: cfg.adminUsername }, cfg.jwtSecret, { expiresIn: '8h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, maxAge: 8 * 3600e3, path: '/' });
}

export const clearSession = (cfg, res) =>
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, path: '/' });

export function adminFromRequest(cfg, req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const c = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] });
    return c.typ === 'admin' ? c.sub : null;
  } catch {
    return null;
  }
}

export const requireAdmin = (cfg) => (req, res, next) => {
  const admin = adminFromRequest(cfg, req);
  if (!admin) return next(new HttpError(401, 'unauthorized', 'Admin login required'));
  req.admin = admin;
  next();
};

// CSRF defence in depth on top of SameSite=Strict: state-changing requests must come from our own origin.
export const sameOrigin = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return next(new HttpError(403, 'bad_origin', 'Cross-origin request blocked'));
  }
  next();
};
