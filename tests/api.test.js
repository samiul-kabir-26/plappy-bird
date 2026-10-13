import { describe, expect, it } from 'vitest';
import { backdateRun, ENV, launchToken, login, makeApp, playerSession } from './helpers.js';
import { minFirstPassMs, DEFAULT_CONFIG } from '../shared/defaults.js';
import { signLaunchToken } from '../server/auth/player.js';

const FIRST = Math.ceil(minFirstPassMs(DEFAULT_CONFIG)) + 10;
const INTERVAL = DEFAULT_CONFIG.pipes.spawnInterval;
const ticksFor = (n) => Array.from({ length: n }, (_, i) => ({ t: FIRST + i * INTERVAL }));

async function playRun(api, db, auth, score, { score: reported = score, ticks } = {}) {
  const { body: run } = await api.post('/api/runs').set('Authorization', auth);
  backdateRun(db, run.runId, FIRST + Math.max(score, 1) * INTERVAL + 500);
  if (score > 0) await api.post(`/api/runs/${run.runId}/ticks`).set('Authorization', auth).send({ ticks: ticks ?? ticksFor(score) });
  const end = await api.post(`/api/runs/${run.runId}/end`).set('Authorization', auth).send({ score: reported, flaps: score * 4 });
  return { run, end };
}

describe('player sessions', () => {
  it('accepts a valid signed launch token and upserts the player', async () => {
    const { api } = makeApp();
    const r = await api.post('/api/session').send({ token: launchToken('user_1', 'Ann') });
    expect(r.status).toBe(200);
    expect(r.body.player).toMatchObject({ userId: 'user_1', displayName: 'Ann', isGuest: false });
  });
  it('rejects tampered, expired and reserved tokens with 401', async () => {
    const { api } = makeApp();
    const good = launchToken('user_1');
    expect((await api.post('/api/session').send({ token: good.slice(0, -2) + 'xx' })).status).toBe(401);
    expect((await api.post('/api/session').send({ token: launchToken('u', 'x', -10) })).status).toBe(401);
    const guest = signLaunchToken(ENV.PLAYER_TOKEN_SECRET, { userId: 'guest:abc', displayName: 'x', exp: Date.now() / 1000 + 60 });
    expect((await api.post('/api/session').send({ token: guest })).status).toBe(401);
    expect((await api.post('/api/session').send({ token: launchToken().replace(/^./, 'A') })).status).toBe(401);
  });
  it('creates guests when allowed and blocks them when not', async () => {
    const a = makeApp();
    const ok = await a.api.post('/api/session').send({ nickname: 'Bob' });
    expect(ok.body.player.isGuest).toBe(true);
    expect(ok.body.player.userId).toMatch(/^guest:/);
    const b = makeApp({ ALLOW_GUESTS: 'false' });
    expect((await b.api.post('/api/session').send({ nickname: 'Bob' })).status).toBe(403);
    expect((await a.api.post('/api/session').send({ nickname: '' })).status).toBe(400);
  });
  it('requires a session for runs', async () => {
    const { api } = makeApp();
    expect((await api.post('/api/runs')).status).toBe(401);
  });
});

describe('runs, events and anti-cheat', () => {
  it('a valid run yields started, pipe_passed x score, milestone, ended, personal_best events in order', async () => {
    const { api, db } = makeApp();
    const { auth } = await playerSession(api, 'u1');
    const { end } = await playRun(api, db, auth, 12);
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ score: 12, best: 12, rank: 1, medal: 'bronze', isPersonalBest: true });

    const ev = await api.get('/api/v1/events?limit=1000').set('X-API-Key', ENV.INTEGRATION_API_KEY);
    const types = ev.body.events.map((e) => e.type);
    expect(types[0]).toBe('player.joined');
    expect(types[1]).toBe('run.started');
    expect(types.filter((t) => t === 'run.pipe_passed')).toHaveLength(12);
    expect(types).toContain('run.milestone');
    expect(types).toContain('player.personal_best');
    expect(types).toContain('leaderboard.top_n');
    const ended = ev.body.events.find((e) => e.type === 'run.ended');
    expect(ended.payload).toMatchObject({ score: 12, flaps: 48, medal: 'bronze' });
    expect(ended.playerId).toBe('u1');
  });

  it('cursor pagination is gap-free and resumes from nextCursor', async () => {
    const { api, db } = makeApp();
    const { auth } = await playerSession(api);
    await playRun(api, db, auth, 5);
    const key = { 'X-API-Key': ENV.INTEGRATION_API_KEY };
    const seen = [];
    let cursor = 0;
    for (let i = 0; i < 20; i++) {
      const r = await api.get(`/api/v1/events?after=${cursor}&limit=3`).set(key);
      if (!r.body.events.length) break;
      seen.push(...r.body.events.map((e) => e.id));
      cursor = r.body.nextCursor;
    }
    expect(seen.length).toBeGreaterThan(8);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(seen[i - 1] + 1);
    expect((await api.get(`/api/v1/events?after=${cursor}`).set(key)).body.nextCursor).toBe(cursor);
  });

  it('rejects a forged score (500 points in a few seconds) and keeps it off the leaderboard', async () => {
    const { api, db } = makeApp();
    const { auth } = await playerSession(api);
    const { body: run } = await api.post('/api/runs').set('Authorization', auth);
    const r = await api.post(`/api/runs/${run.runId}/ticks`).set('Authorization', auth).send({ ticks: ticksFor(40) });
    expect(r.status).toBe(422);
    const end = await api.post(`/api/runs/${run.runId}/end`).set('Authorization', auth).send({ score: 500 });
    expect(end.status).toBe(409); // already rejected
    const ev = await api.get('/api/v1/events').set('X-API-Key', ENV.INTEGRATION_API_KEY);
    expect(ev.body.events.some((e) => e.type === 'run.rejected')).toBe(true);
    expect(ev.body.events.some((e) => e.type === 'run.pipe_passed' || e.type === 'run.ended')).toBe(false);
    expect((await api.get('/api/leaderboard')).body.entries).toHaveLength(0);
    expect(db.prepare("SELECT status FROM runs").get().status).toBe('rejected');
  });

  it('rejects a reported score that differs from the validated ticks', async () => {
    const { api, db } = makeApp();
    const { auth } = await playerSession(api);
    const { end } = await playRun(api, db, auth, 3, { score: 30 });
    expect(end.status).toBe(422);
    expect(end.body.error.message).toMatch(/score_mismatch/);
  });

  it('rejects pipes passed faster than the spawn interval and too-early first pipe', async () => {
    const { api, db } = makeApp();
    const { auth } = await playerSession(api);
    const a = (await api.post('/api/runs').set('Authorization', auth)).body;
    backdateRun(db, a.runId, 60000);
    expect((await api.post(`/api/runs/${a.runId}/ticks`).set('Authorization', auth).send({ ticks: [{ t: 100 }] })).status).toBe(422);
    const b = (await api.post('/api/runs').set('Authorization', auth)).body;
    backdateRun(db, b.runId, 60000);
    const fast = await api.post(`/api/runs/${b.runId}/ticks`).set('Authorization', auth).send({ ticks: [{ t: FIRST }, { t: FIRST + 500 }] });
    expect(fast.status).toBe(422);
  });

  it("can't end someone else's run or end a run twice", async () => {
    const { api, db } = makeApp();
    const a = await playerSession(api, 'a');
    const b = await playerSession(api, 'b');
    const { run } = await playRun(api, db, a.auth, 2);
    expect((await api.post(`/api/runs/${run.runId}/end`).set('Authorization', b.auth).send({ score: 2 })).status).toBe(404);
    expect((await api.post(`/api/runs/${run.runId}/end`).set('Authorization', a.auth).send({ score: 2 })).status).toBe(409);
  });

  it('rate-limits to 60 runs per hour per player', async () => {
    const { api } = makeApp();
    const { auth } = await playerSession(api);
    for (let i = 0; i < 60; i++) expect((await api.post('/api/runs').set('Authorization', auth)).status).toBe(201);
    expect((await api.post('/api/runs').set('Authorization', auth)).status).toBe(429);
  });
});

describe('integration API auth', () => {
  it('401 without / with a wrong API key', async () => {
    const { api } = makeApp();
    expect((await api.get('/api/v1/events')).status).toBe(401);
    expect((await api.get('/api/v1/events').set('X-API-Key', 'nope')).status).toBe(401);
    expect((await api.get('/api/v1/leaderboard').set('X-API-Key', ENV.INTEGRATION_API_KEY)).status).toBe(200);
  });
  it('exposes player stats', async () => {
    const { api, db } = makeApp();
    const { auth } = await playerSession(api, 'u9', 'Nine');
    await playRun(api, db, auth, 4);
    const r = await api.get('/api/v1/players/u9').set('X-API-Key', ENV.INTEGRATION_API_KEY);
    expect(r.body).toMatchObject({ userId: 'u9', bestScore: 4, totalRuns: 1, totalPipes: 4 });
    expect((await api.get('/api/v1/players/none').set('X-API-Key', ENV.INTEGRATION_API_KEY)).status).toBe(404);
  });
});

describe('leaderboard', () => {
  it('ranks by best run, ties to earliest, per period', async () => {
    const { api, db } = makeApp();
    const a = await playerSession(api, 'a', 'Alice');
    const b = await playerSession(api, 'b', 'Bob');
    await playRun(api, db, a.auth, 5);
    await playRun(api, db, b.auth, 8);
    await playRun(api, db, a.auth, 8); // ties Bob, but later
    await playRun(api, db, a.auth, 2); // worse run must not replace best
    const lb = (await api.get('/api/leaderboard?period=all')).body.entries;
    expect(lb.map((e) => [e.rank, e.displayName, e.score])).toEqual([[1, 'Bob', 8], [2, 'Alice', 8]]);
    expect((await api.get('/api/leaderboard?period=daily')).body.entries).toHaveLength(2);
    // push Alice's runs out of the daily window
    db.prepare("UPDATE runs SET ended_at = ? WHERE player_id = (SELECT id FROM players WHERE display_name='Alice')").run(new Date(Date.now() - 3 * 864e5).toISOString());
    expect((await api.get('/api/leaderboard?period=daily')).body.entries.map((e) => e.displayName)).toEqual(['Bob']);
    expect((await api.get('/api/leaderboard?period=weekly')).body.entries).toHaveLength(2);
    expect((await api.get('/api/leaderboard?period=bogus')).status).toBe(400);
    const me = await api.get('/api/leaderboard/me').set('Authorization', b.auth);
    // Alice's tied 8 is now older, so she wins the all-time tie; Bob is alone in the daily window
    expect(me.body.all).toEqual({ rank: 2, score: 8 });
    expect(me.body.daily).toEqual({ rank: 1, score: 8 });
  });
});

describe('admin', () => {
  it('login: wrong creds 401, rate limited, right creds set httpOnly cookie', async () => {
    const { api } = makeApp({}, { loginMax: 3 });
    for (let i = 0; i < 3; i++) expect((await api.post('/admin/api/login').send({ username: 'boss', password: 'bad' })).status).toBe(401);
    expect((await api.post('/admin/api/login').send({ username: 'boss', password: 'bad' })).status).toBe(429);
    const ok = makeApp();
    const r = await ok.api.post('/admin/api/login').send({ username: ENV.ADMIN_USERNAME, password: ENV.ADMIN_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(r.headers['set-cookie'][0]).toMatch(/SameSite=Strict/i);
  });

  it('protects admin endpoints and the admin page', async () => {
    const { api } = makeApp();
    for (const p of ['/admin/api/config', '/admin/api/events', '/admin/api/stats', '/admin/api/assets', '/admin/api/leaderboard']) {
      expect((await api.get(p)).status).toBe(401);
    }
    expect((await api.put('/admin/api/config').send({})).status).toBe(401);
    const page = await api.get('/admin/');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/admin/login.html');
    const cookie = await login(api);
    expect((await api.get('/admin/').set('Cookie', cookie)).status).toBe(200);
  });

  it('blocks cross-origin state changes', async () => {
    const { api } = makeApp();
    const cookie = await login(api);
    const r = await api.post('/admin/api/logout').set('Cookie', cookie).set('Origin', 'https://evil.example');
    expect(r.status).toBe(403);
  });

  it('saves, validates, versions and rolls back the theme, emitting events', async () => {
    const { api } = makeApp();
    const cookie = await login(api);
    const cur = (await api.get('/admin/api/config').set('Cookie', cookie)).body;
    expect(cur.version).toBe(1);

    const bad = await api.put('/admin/api/config').set('Cookie', cookie).send({ physics: { gravity: 99 }, colors: { sky: 'red' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.length).toBe(2);

    const next = structuredClone(cur.config);
    next.text.title = 'Zavi Bird';
    next.pipes.gap = 130;
    const saved = await api.put('/admin/api/config').set('Cookie', cookie).send(next);
    expect(saved.body.version).toBe(2);
    expect((await api.get('/api/config')).body.config.text.title).toBe('Zavi Bird');

    const back = await api.post('/admin/api/config/rollback/1').set('Cookie', cookie);
    expect(back.body.version).toBe(3);
    expect((await api.get('/api/config')).body.config.text.title).toBe('Plappy Bird');
    expect((await api.get('/admin/api/config/history').set('Cookie', cookie)).body.versions).toHaveLength(3);

    const ev = await api.get('/admin/api/events?type=admin.config_updated').set('Cookie', cookie);
    expect(ev.body.events).toHaveLength(2);
  });

  it('rejects medal thresholds out of order and unknown asset ids', async () => {
    const { api } = makeApp();
    const cookie = await login(api);
    const r1 = await api.put('/admin/api/config').set('Cookie', cookie).send({ medals: { bronze: 30, silver: 20, gold: 30, platinum: 40 } });
    expect(r1.status).toBe(400);
    const r2 = await api.put('/admin/api/config').set('Cookie', cookie).send({ assets: { bird: 'a'.repeat(32) } });
    expect(r2.status).toBe(400);
  });

  it('uploads assets (sniffing real type), serves them, uses them in the theme, blocks deleting in-use ones', async () => {
    const { api, cfg } = makeApp({ DATA_DIR: '/tmp/plappy-test-' + Date.now() });
    const cookie = await login(api);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    const up = await api.post('/admin/api/assets').set('Cookie', cookie).attach('file', png, 'bird.png');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ mime: 'image/png', kind: 'image' });

    const served = await api.get(up.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);
    expect(served.headers['x-content-type-options']).toBe('nosniff');

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await api.post('/admin/api/assets').set('Cookie', cookie).attach('file', svg, 'x.png')).status).toBe(415);
    const big = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
    expect((await api.post('/admin/api/assets').set('Cookie', cookie).attach('file', big, 'big.png')).status).toBe(413);

    // image can't be used as a sound
    expect((await api.put('/admin/api/config').set('Cookie', cookie).send({ assets: { soundFlap: up.body.id } })).status).toBe(400);
    const saved = await api.put('/admin/api/config').set('Cookie', cookie).send({ assets: { bird: up.body.id, birdFrames: 1 } });
    expect(saved.status).toBe(200);
    expect((await api.delete(`/admin/api/assets/${up.body.id}`).set('Cookie', cookie)).status).toBe(409);
    await api.put('/admin/api/config').set('Cookie', cookie).send({});
    expect((await api.delete(`/admin/api/assets/${up.body.id}`).set('Cookie', cookie)).status).toBe(200);
    expect((await api.get(up.body.url)).status).toBe(404);
    expect(cfg.dataDir).toContain('plappy-test');
  });

  it('removes a run, recomputes best, resets leaderboard, exports CSV safely, reports stats', async () => {
    const { api, db } = makeApp();
    const cookie = await login(api);
    const a = await playerSession(api, '=SUM(1+1)', 'Alice');
    const { run } = await playRun(api, db, a.auth, 6);
    const stats = (await api.get('/admin/api/stats').set('Cookie', cookie)).body;
    expect(stats).toMatchObject({ runsToday: 1, topScore: 6, totalPlayers: 1 });

    const csv = await api.get('/admin/api/events?format=csv').set('Cookie', cookie);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(",'=SUM(1+1),");
    expect(csv.text).not.toMatch(/,=SUM/);

    expect((await api.delete(`/admin/api/runs/${run.runId}`).set('Cookie', cookie)).status).toBe(200);
    expect((await api.get('/api/leaderboard')).body.entries).toHaveLength(0);
    expect(db.prepare('SELECT best_score b FROM players').get().b).toBe(0);

    await playRun(api, db, a.auth, 3);
    const reset = await api.post('/admin/api/leaderboard/reset?period=all').set('Cookie', cookie);
    expect(reset.body.removedRuns).toBe(1);
    expect((await api.get('/api/leaderboard')).body.entries).toHaveLength(0);
  });
});

describe('security headers & CORS', () => {
  it('game allows configured frame ancestors; admin never can be framed', async () => {
    const { api } = makeApp({ FRAME_ANCESTORS: 'https://host.example.com', CORS_ORIGINS: 'https://host.example.com' });
    const game = await api.get('/api/health');
    expect(game.headers['content-security-policy']).toContain('frame-ancestors https://host.example.com');
    expect(game.headers['x-frame-options']).toBeUndefined();
    const admin = await api.get('/admin/login.html');
    expect(admin.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(admin.headers['x-frame-options']).toBe('DENY');
    const cors = await api.get('/api/health').set('Origin', 'https://host.example.com');
    expect(cors.headers['access-control-allow-origin']).toBe('https://host.example.com');
    const other = await api.get('/api/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('production config validation', () => {
  it('refuses placeholder secrets in production', async () => {
    const { loadConfig } = await import('../server/config.js');
    expect(() => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'change-me' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({ ...ENV, NODE_ENV: 'production' })).not.toThrow();
  });
});
