import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { signLaunchToken } from '../server/auth/player.js';

export const ENV = {
  ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'hunter2hunter2', JWT_SECRET: 'j'.repeat(32),
  INTEGRATION_API_KEY: 'k'.repeat(32), PLAYER_TOKEN_SECRET: 'p'.repeat(32), ALLOW_GUESTS: 'true',
};

export function makeApp(extraEnv = {}, opts = {}) {
  const cfg = loadConfig({ ...ENV, ...extraEnv });
  const db = openDb(':memory:');
  const app = createApp({ cfg, db, ...opts });
  return { app, db, cfg, api: request(app) };
}

export const launchToken = (userId = 'u1', displayName = 'User One', ttl = 600) =>
  signLaunchToken(ENV.PLAYER_TOKEN_SECRET, { userId, displayName, exp: Math.floor(Date.now() / 1000) + ttl });

export async function login(api) {
  const res = await api.post('/admin/api/login').send({ username: ENV.ADMIN_USERNAME, password: ENV.ADMIN_PASSWORD });
  return res.headers['set-cookie'];
}

export async function playerSession(api, userId = 'u1', name = 'User One') {
  const res = await api.post('/api/session').send({ token: launchToken(userId, name) });
  return { auth: `Bearer ${res.body.session}`, body: res.body };
}

// Plays a run that is valid for the server: backdates the start so wall-clock covers the game time.
export function backdateRun(db, runId, ms) {
  db.prepare('UPDATE runs SET started_at = ? WHERE id = ?').run(new Date(Date.now() - ms).toISOString(), runId);
}
