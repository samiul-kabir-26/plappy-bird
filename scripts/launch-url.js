#!/usr/bin/env node
// Prints a signed launch URL, as a host backend would generate for an embedded player.
//   npm run launch-url -- user_42 "Jane Doe" [baseUrl] [ttlSeconds]
import 'dotenv/config';
import { signLaunchToken } from '../server/auth/player.js';

const [userId, displayName = userId, baseUrl = `http://localhost:${process.env.PORT || 3000}`, ttl = '600'] = process.argv.slice(2);
if (!userId) {
  console.error('Usage: npm run launch-url -- <userId> [displayName] [baseUrl] [ttlSeconds]');
  process.exit(1);
}
const secret = process.env.PLAYER_TOKEN_SECRET || 'dev-player-token-secret';
const token = signLaunchToken(secret, { userId, displayName, exp: Math.floor(Date.now() / 1000) + Number(ttl) });
console.log(`${baseUrl.replace(/\/$/, '')}/?token=${token}`);
