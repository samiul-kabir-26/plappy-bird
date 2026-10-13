import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const app = createApp({ cfg, db });

for (const w of cfg.warnings) console.warn(`[config] ${w}`);

const server = app.listen(cfg.port, () => {
  console.log(`Plappy Bird listening on http://localhost:${cfg.port}  (admin: /admin)`);
});

const shutdown = () => {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
