import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, STEP_MS } from '../shared/defaults.js';
import { backdateRun, makeApp, playerSession } from './helpers.js';

// Minimal browser stubs so the canvas-only engine can be stepped headlessly.
const noop = () => {};
const ctx = new Proxy({}, { get: () => noop, set: () => true });
const canvas = { getContext: () => ctx, style: {}, clientWidth: 288, addEventListener: noop, removeEventListener: noop };
let Engine;
beforeAll(async () => {
  globalThis.window = { devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop };
  globalThis.document = { addEventListener: noop, hidden: false };
  ({ Engine } = await import('../public/js/game/engine.js'));
});

function simulate(config, { targetScore = 6, maxFrames = 20000, dieAfterTarget = true } = {}) {
  const ticks = [];
  let flaps = 0;
  const e = new Engine(canvas, {
    config, assets: {}, preview: true, keyTarget: canvas,
    hooks: { onScore: (_s, t) => ticks.push({ t: Math.round(t) }) },
  });
  let frames = 0;
  while (frames++ < maxFrames) {
    if (e.state === 'READY') e.input();
    else if (e.state === 'PLAYING') {
      if (e.score >= targetScore && dieAfterTarget) { /* stop flapping and fall */ }
      else {
        const next = e.pipes.find((p) => p.x + 52 > 70 - 11);
        const target = next ? next.gapY + 10 : 230;
        if (e.bird.y > target && e.bird.vy > -1) { e.input(); flaps++; }
      }
    }
    e.update();
    if (e.state === 'GAME_OVER') break;
  }
  return { e, ticks, gameMs: e.gameMs, score: e.score, flaps: e.flaps };
}

const variant = (over) => {
  const c = structuredClone(DEFAULT_CONFIG);
  for (const [k, v] of Object.entries(over)) Object.assign(c[k], v);
  return c;
};

describe('engine rules', () => {
  it('bird dies on the ground without flapping, never scores', () => {
    const e = new Engine(canvas, { config: DEFAULT_CONFIG, assets: {}, preview: true, keyTarget: canvas });
    e.input(); // start (flaps once)
    for (let i = 0; i < 600 && e.state !== 'GAME_OVER'; i++) e.update();
    expect(e.state).toBe('GAME_OVER');
    expect(e.score).toBe(0);
  });

  it('pausing freezes the simulation; tap resumes without flapping', () => {
    const e = new Engine(canvas, { config: DEFAULT_CONFIG, assets: {}, preview: true, keyTarget: canvas });
    e.input();
    for (let i = 0; i < 5; i++) e.update();
    e.setPaused(true);
    const y = e.bird.y, ms = e.gameMs, flaps = e.flaps;
    for (let i = 0; i < 30; i++) e.update();
    expect([e.bird.y, e.gameMs]).toEqual([y, ms]);
    e.input();
    expect(e.paused).toBe(false);
    expect(e.flaps).toBe(flaps);
  });

  it('restart tap is ignored for a short delay after game over', () => {
    const e = new Engine(canvas, { config: DEFAULT_CONFIG, assets: {}, preview: true, keyTarget: canvas });
    e.input();
    while (e.state !== 'GAME_OVER') e.update();
    e.input();
    expect(e.state).toBe('GAME_OVER');
    for (let i = 0; i < 45; i++) e.update();
    e.input();
    expect(e.state).toBe('READY');
  });

  it('pipe gaps stay fully on screen for extreme gap sizes', () => {
    for (const gap of [60, 220]) {
      const e = new Engine(canvas, { config: variant({ pipes: { gap } }), assets: {}, preview: true, keyTarget: canvas });
      for (let i = 0; i < 200; i++) e._spawn();
      for (const p of e.pipes) {
        expect(p.gapY - gap / 2).toBeGreaterThanOrEqual(49);
        expect(p.gapY + gap / 2).toBeLessThanOrEqual(351);
      }
    }
  });
});

describe('engine timing is accepted by the server anti-cheat', () => {
  const cases = {
    'default physics': DEFAULT_CONFIG,
    'fast pipes (speed 4)': variant({ pipes: { speed: 4 } }),
    'very fast pipes (speed 4.5, interval 1000ms)': variant({ pipes: { speed: 4.5, spawnInterval: 1000 } }),
    'slow pipes, wide gap': variant({ pipes: { speed: 1, gap: 200, spawnInterval: 3000 } }),
    'short interval': variant({ pipes: { spawnInterval: 800, speed: 3.5 } }),
  };
  for (const [name, config] of Object.entries(cases)) {
    it(name, async () => {
      const { api, db } = makeApp();
      const { auth } = await playerSession(api);
      const sim = simulate(config);
      expect(sim.score).toBeGreaterThanOrEqual(3);

      // Server runs with the same config as the client simulated.
      db.prepare('UPDATE game_config SET data = ? WHERE version = 1').run(JSON.stringify(config));
      const { body: run } = await api.post('/api/runs').set('Authorization', auth);
      // Real play would have taken at least the game time; add the small post-game fall.
      backdateRun(db, run.runId, sim.gameMs + 400);
      for (let i = 0; i < sim.ticks.length; i += 5) {
        const r = await api.post(`/api/runs/${run.runId}/ticks`).set('Authorization', auth).send({ ticks: sim.ticks.slice(i, i + 5) });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
      }
      const end = await api.post(`/api/runs/${run.runId}/end`).set('Authorization', auth).send({ score: sim.score, flaps: sim.flaps });
      expect(end.status, JSON.stringify(end.body)).toBe(200);
      expect(end.body.score).toBe(sim.score);
      expect(STEP_MS).toBeCloseTo(16.667, 2);
    });
  }
});
