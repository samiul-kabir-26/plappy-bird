import { STEP_MS, WORLD, mulberry32 } from '../../../shared/defaults.js';
import { NullAudio } from './audio.js';
import { attachInput } from './input.js';
import { render } from './renderer.js';

const { width: W, height: H, groundY, birdX, birdRadius, pipeW } = WORLD;
const READY_Y = 230;
const GAME_OVER_TAP_DELAY = 40; // frames before a tap restarts (prevents accidental instant restarts)

// Canvas-only game engine: no DOM beyond the canvas, so the admin theme editor reuses it for the live preview.
// hooks: onStart(), onScore(score, gameMs), onEnd({score, flaps, durationMs, isBest}), onState(state)
export class Engine {
  constructor(canvas, { config, assets, audio = new NullAudio(), hooks = {}, best = 0, preview = false, keyTarget } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cfg = config;
    this.assets = assets;
    this.audio = audio;
    this.hooks = hooks;
    this.best = best;
    this.preview = preview;
    this.rng = mulberry32((Math.random() * 2 ** 31) | 0);
    this.paused = false;
    this.panelNote = '';
    this.scale = 1;
    this.raf = 0;
    this.acc = 0;
    this.last = 0;
    this.frame = 0;
    this.groundX = 0;
    this.birdFrame = 0;
    this._toReady();
    this.resize(canvas.clientWidth || W);

    this.detach = attachInput({
      pointerTarget: canvas,
      keyTarget: keyTarget || window,
      onFlap: () => this.input(),
      onPause: () => this.togglePause(),
    });
    this._onBlur = () => { if (this.state === 'PLAYING') this.setPaused(true); };
    if (!preview) {
      window.addEventListener('blur', this._onBlur);
      document.addEventListener('visibilitychange', () => document.hidden && this._onBlur());
    }
  }

  // ---- public API --------------------------------------------------------
  setTheme(config, assets) { this.cfg = config; this.assets = assets; }
  reseed(seed) { this.rng = mulberry32(seed); }

  resize(cssWidth) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${(cssWidth * H) / W}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round((cssWidth * H * dpr) / W);
    this.scale = (cssWidth * dpr) / W;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      this.acc += Math.min(now - this.last, 100);
      this.last = now;
      while (this.acc >= STEP_MS) { this.update(); this.acc -= STEP_MS; }
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detach();
    window.removeEventListener('blur', this._onBlur);
  }

  restart() {
    this._toReady();
  }

  setPaused(v) {
    if (this.state !== 'PLAYING') return;
    this.paused = v;
  }
  togglePause() { this.setPaused(!this.paused); }

  // ---- state machine -----------------------------------------------------
  _setState(s) {
    this.state = s;
    this.hooks.onState?.(s);
  }

  _toReady() {
    this.bird = { y: READY_Y, vy: 0, rot: 0 };
    this.pipes = [];
    this.score = 0;
    this.flaps = 0;
    this.gameMs = 0;
    this.spawnTimer = 0;
    this.flash = 0;
    this.overFrames = 0;
    this.dyingFrames = 0;
    this.newBest = false;
    this.panelNote = '';
    this.paused = false;
    this._setState('READY');
  }

  input() {
    this.audio.unlock();
    if (this.paused) { this.paused = false; return; }
    switch (this.state) {
      case 'READY': this._begin(); break;
      case 'PLAYING': this._flap(); break;
      case 'GAME_OVER': if (this.overFrames > GAME_OVER_TAP_DELAY) this.restart(); break;
      default: break;
    }
  }

  _begin() {
    this.pipes = [];
    this.spawnTimer = 0;
    this._setState('PLAYING');
    this.hooks.onStart?.();
    this._spawn();
    this._flap();
  }

  _flap() {
    this.bird.vy = -this.cfg.physics.flapStrength;
    this.flaps++;
    this.audio.play('flap');
  }

  _spawn() {
    const gap = this.cfg.pipes.gap;
    const margin = 50;
    const minY = margin + gap / 2;
    const maxY = groundY - margin - gap / 2;
    this.pipes.push({ x: W, gapY: minY + this.rng() * (maxY - minY), passed: false });
  }

  update() {
    this.frame++;
    if (this.paused) return;
    const { physics, pipes: pcfg } = this.cfg;
    const st = this.state;

    if (st === 'READY' || st === 'PLAYING') {
      this.groundX -= pcfg.speed;
      if (this.frame % 5 === 0) this.birdFrame++;
    }

    if (st === 'READY') {
      this.bird.y = READY_Y + Math.sin(this.frame / 9) * 6;
      return;
    }

    if (st === 'PLAYING') {
      this.gameMs += STEP_MS;
      const b = this.bird;
      b.vy = Math.min(b.vy + physics.gravity, physics.terminalVelocity);
      b.y += b.vy;
      b.rot = b.vy < 0 ? -25 : Math.min(90, b.rot + 4);
      if (b.y < -40) { b.y = -40; b.vy = 0; }

      this.spawnTimer += STEP_MS;
      if (this.spawnTimer >= pcfg.spawnInterval) { this.spawnTimer -= pcfg.spawnInterval; this._spawn(); }
      for (const p of this.pipes) {
        p.x -= pcfg.speed;
        if (!p.passed && p.x + pipeW / 2 < birdX) {
          p.passed = true;
          this.score++;
          this.audio.play('point');
          this.hooks.onScore?.(this.score, this.gameMs);
        }
      }
      this.pipes = this.pipes.filter((p) => p.x > -pipeW);

      if (this._collides()) this._die();
      return;
    }

    if (st === 'DYING') {
      const b = this.bird;
      this.dyingFrames++;
      b.vy = Math.min(b.vy + physics.gravity * 1.4, physics.terminalVelocity + 4);
      b.y += b.vy;
      b.rot = Math.min(90, b.rot + 8);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.08);
      if (this.dyingFrames === 6) this.audio.play('die');
      const floor = groundY - birdRadius;
      if (b.y >= floor) {
        b.y = floor;
        this._setState('GAME_OVER');
        this.overFrames = 0;
      }
      return;
    }

    if (st === 'GAME_OVER') {
      this.overFrames++;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.08);
    }
  }

  _collides() {
    const b = this.bird;
    if (b.y + birdRadius >= groundY) { b.y = groundY - birdRadius; return true; }
    const gap = this.cfg.pipes.gap;
    for (const p of this.pipes) {
      if (birdX + birdRadius <= p.x || birdX - birdRadius >= p.x + pipeW) continue;
      if (b.y - birdRadius < p.gapY - gap / 2 || b.y + birdRadius > p.gapY + gap / 2) return true;
    }
    return false;
  }

  _die() {
    const onGround = this.bird.y + birdRadius >= groundY;
    this.audio.play('hit');
    this.flash = 0.9;
    this.newBest = this.score > this.best;
    if (this.newBest) this.best = this.score;
    this.hooks.onEnd?.({ score: this.score, flaps: this.flaps, durationMs: Math.round(this.gameMs), isBest: this.newBest });
    if (onGround) {
      this.audio.play('die');
      this._setState('GAME_OVER');
      this.overFrames = 0;
    } else {
      this.dyingFrames = 0;
      this._setState('DYING');
    }
  }

  draw() {
    const g = this.g;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    render(g, this, this.assets, this.cfg);
  }
}
