import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminFromRequest } from './auth/admin.js';
import { adminRoutes } from './routes/admin.js';
import { integrationRoutes } from './routes/integration.js';
import { publicRoutes } from './routes/public.js';
import * as assets from './services/assets.js';
import { ensureDefault } from './services/gameConfig.js';
import { HttpError } from './util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function securityHeaders(cfg) {
  const base = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    mediaSrc: ["'self'", 'blob:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  };
  // The game may be framed by the configured host origins; the admin panel never.
  const game = helmet({
    frameguard: false,
    contentSecurityPolicy: { useDefaults: false, directives: { ...base, frameAncestors: cfg.frameAncestors.length ? cfg.frameAncestors : ["'self'"] } },
    crossOriginEmbedderPolicy: false,
  });
  const admin = helmet({
    frameguard: { action: 'deny' },
    contentSecurityPolicy: { useDefaults: false, directives: { ...base, frameAncestors: ["'none'"] } },
  });
  return (req, res, next) => (req.path.startsWith('/admin') ? admin : game)(req, res, next);
}

export function createApp({ cfg, db, loginMax }) {
  ensureDefault(db);
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);

  app.use(securityHeaders(cfg));
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));

  app.use('/api', cors({ origin: cfg.corsOrigins, allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'], maxAge: 600 }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/v1', integrationRoutes(db, cfg));
  app.use('/api', publicRoutes(db, cfg));
  app.use('/admin/api', adminRoutes(db, cfg, { loginMax }));

  // Uploaded theme assets. Content type comes from the DB (sniffed at upload), never from the request.
  app.get('/uploads/:id', (req, res, next) => {
    const f = /^[0-9a-f]{32}$/.test(req.params.id) && assets.filePath(db, cfg, req.params.id);
    if (!f || !fs.existsSync(f.path)) return next(new HttpError(404, 'not_found', 'Asset not found'));
    res.set({ 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.sendFile(f.path);
  });

  // Admin pages: the HTML shell is only served to a logged-in admin.
  const adminDir = path.join(ROOT, 'admin');
  app.get(['/admin', '/admin/', '/admin/index.html'], (req, res) => {
    if (!adminFromRequest(cfg, req)) return res.redirect('/admin/login.html');
    res.set('Cache-Control', 'no-store').sendFile(path.join(adminDir, 'index.html'));
  });
  app.use('/admin', express.static(adminDir, { index: false }));

  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public')));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Unknown API route')));
  app.use('/admin/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Unknown API route')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', 'Request body too large');
    if (!(err instanceof HttpError)) {
      console.error(err);
      err = new HttpError(500, 'internal_error', 'Internal server error');
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } });
  });

  return app;
}
