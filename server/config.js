import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const PLACEHOLDER = /^(replace-with|change-me|changeme|admin$)/i;

const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const warnings = [];

  const secret = (name, devDefault, { min = 16 } = {}) => {
    const v = env[name];
    if (production) {
      if (!v || PLACEHOLDER.test(v) || v.length < min) {
        throw new Error(`${name} must be set to a non-placeholder value of at least ${min} characters in production`);
      }
      return v;
    }
    if (!v) warnings.push(`${name} not set, using an insecure development default`);
    return v || devDefault;
  };

  const cfg = {
    production,
    port: Number(env.PORT) || 3000,
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: secret('ADMIN_PASSWORD', 'admin', { min: 8 }),
    jwtSecret: secret('JWT_SECRET', randomBytes(32).toString('hex')),
    apiKey: secret('INTEGRATION_API_KEY', 'dev-integration-key'),
    playerTokenSecret: secret('PLAYER_TOKEN_SECRET', 'dev-player-token-secret'),
    allowGuests: bool(env.ALLOW_GUESTS, true),
    corsOrigins: list(env.CORS_ORIGINS),
    frameAncestors: list(env.FRAME_ANCESTORS),
    cookieSecure: bool(env.COOKIE_SECURE, production),
    trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
    dataDir: path.resolve(env.DATA_DIR || './data'),
    warnings,
  };
  if (production && cfg.adminUsername === 'admin') warnings.push('ADMIN_USERNAME is the default "admin"');
  return cfg;
}
