// Shared by the server (validation), the game client and the admin theme editor.
// Pure ES module: no DOM / Node APIs.

export const WORLD = {
  width: 288,
  height: 512,
  groundY: 400,
  birdX: 70,
  birdW: 34,
  birdH: 24,
  birdRadius: 11,
  pipeW: 52,
  fps: 60,
};

export const STEP_MS = 1000 / WORLD.fps;

export const DEFAULT_CONFIG = {
  text: {
    title: 'Plappy Bird',
    getReady: 'Get Ready',
    tapHint: 'Tap or press Space',
    gameOver: 'Game Over',
  },
  colors: {
    sky: '#70c5ce',
    score: '#ffffff',
    panel: '#ded895',
    button: '#e8a33d',
    buttonText: '#ffffff',
  },
  font: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  physics: { gravity: 0.25, flapStrength: 4.6, terminalVelocity: 8 },
  pipes: { speed: 2, gap: 100, spawnInterval: 1500 },
  medals: { bronze: 10, silver: 20, gold: 30, platinum: 40 },
  assets: {
    bird: null,
    birdFrames: 3,
    pipeTop: null,
    pipeBottom: null,
    background: null,
    ground: null,
    logo: null,
    soundFlap: null,
    soundPoint: null,
    soundHit: null,
    soundDie: null,
  },
};

// One descriptor per editable field. The server validates against this list and
// the admin form is generated from it.
export const FIELDS = [
  { group: 'Text', path: 'text.title', label: 'Title', type: 'string', max: 24 },
  { group: 'Text', path: 'text.getReady', label: '"Get ready" text', type: 'string', max: 24 },
  { group: 'Text', path: 'text.tapHint', label: 'Tap hint', type: 'string', max: 32 },
  { group: 'Text', path: 'text.gameOver', label: '"Game over" text', type: 'string', max: 24 },
  { group: 'Colors', path: 'colors.sky', label: 'Sky (no background image)', type: 'color' },
  { group: 'Colors', path: 'colors.score', label: 'Score text', type: 'color' },
  { group: 'Colors', path: 'colors.panel', label: 'Game-over panel', type: 'color' },
  { group: 'Colors', path: 'colors.button', label: 'Button', type: 'color' },
  { group: 'Colors', path: 'colors.buttonText', label: 'Button text', type: 'color' },
  { group: 'Colors', path: 'font', label: 'Font family (CSS)', type: 'font', max: 100 },
  { group: 'Physics', path: 'physics.gravity', label: 'Gravity (px/frame²)', type: 'number', min: 0.05, max: 1, step: 0.01 },
  { group: 'Physics', path: 'physics.flapStrength', label: 'Flap strength (px/frame)', type: 'number', min: 1, max: 12, step: 0.1 },
  { group: 'Physics', path: 'physics.terminalVelocity', label: 'Terminal velocity (px/frame)', type: 'number', min: 2, max: 20, step: 0.5 },
  { group: 'Physics', path: 'pipes.speed', label: 'Pipe speed (px/frame)', type: 'number', min: 0.5, max: 6, step: 0.1 },
  { group: 'Physics', path: 'pipes.gap', label: 'Pipe gap (px)', type: 'number', min: 60, max: 220, step: 1 },
  { group: 'Physics', path: 'pipes.spawnInterval', label: 'Pipe spawn interval (ms)', type: 'number', min: 600, max: 5000, step: 50 },
  { group: 'Medals', path: 'medals.bronze', label: 'Bronze at score', type: 'int', min: 1, max: 1000 },
  { group: 'Medals', path: 'medals.silver', label: 'Silver at score', type: 'int', min: 1, max: 1000 },
  { group: 'Medals', path: 'medals.gold', label: 'Gold at score', type: 'int', min: 1, max: 1000 },
  { group: 'Medals', path: 'medals.platinum', label: 'Platinum at score', type: 'int', min: 1, max: 1000 },
  { group: 'Assets', path: 'assets.bird', label: 'Bird (image or sprite strip)', type: 'asset', kind: 'image' },
  { group: 'Assets', path: 'assets.birdFrames', label: 'Bird frames in strip', type: 'int', min: 1, max: 12, showIf: 'assets.bird' },
  { group: 'Assets', path: 'assets.pipeTop', label: 'Top pipe', type: 'asset', kind: 'image' },
  { group: 'Assets', path: 'assets.pipeBottom', label: 'Bottom pipe (mirrored if only one is set)', type: 'asset', kind: 'image' },
  { group: 'Assets', path: 'assets.background', label: 'Background', type: 'asset', kind: 'image' },
  { group: 'Assets', path: 'assets.ground', label: 'Ground (tiled)', type: 'asset', kind: 'image' },
  { group: 'Assets', path: 'assets.logo', label: 'Logo (replaces title text)', type: 'asset', kind: 'image' },
  { group: 'Assets', path: 'assets.soundFlap', label: 'Flap sound', type: 'asset', kind: 'audio' },
  { group: 'Assets', path: 'assets.soundPoint', label: 'Point sound', type: 'asset', kind: 'audio' },
  { group: 'Assets', path: 'assets.soundHit', label: 'Hit sound', type: 'asset', kind: 'audio' },
  { group: 'Assets', path: 'assets.soundDie', label: 'Die sound', type: 'asset', kind: 'audio' },
];

export const EVENT_TYPES = [
  'player.joined',
  'run.started',
  'run.pipe_passed',
  'run.milestone',
  'run.ended',
  'run.rejected',
  'player.personal_best',
  'leaderboard.top_n',
  'admin.config_updated',
  'admin.run_removed',
  'admin.leaderboard_reset',
];

export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

export function medalFor(score, medals) {
  if (score >= medals.platinum) return 'platinum';
  if (score >= medals.gold) return 'gold';
  if (score >= medals.silver) return 'silver';
  if (score >= medals.bronze) return 'bronze';
  return null;
}

// Shortest possible time (game ms) between the run starting and the first pipe being passed.
export function minFirstPassMs(cfg) {
  const travel = WORLD.width + WORLD.pipeW / 2 - WORLD.birdX;
  return (travel / cfg.pipes.speed) * STEP_MS;
}

// Mulberry32 PRNG: deterministic pipe layouts from a run seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
