// Web Audio sound manager. Defaults are synthesized; admin-uploaded sounds replace them.
const MUTE_KEY = 'pb_muted';

export class NullAudio {
  play() {}
  unlock() {}
  async loadCustom() {}
  get muted() { return true; }
  setMuted() {}
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.sources = {};
    try { this._muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { this._muted = false; }
  }

  get muted() { return this._muted; }
  setMuted(v) {
    this._muted = v;
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // Browsers only allow audio after a user gesture.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._decodePending();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async loadCustom(assets) {
    this.sources = { flap: assets.soundFlap, point: assets.soundPoint, hit: assets.soundHit, die: assets.soundDie };
    this.buffers = {};
    this.bytes = {};
    await Promise.all(Object.entries(this.sources).map(async ([name, id]) => {
      if (!id) return;
      try {
        const res = await fetch(`/uploads/${id}`);
        if (res.ok) this.bytes[name] = await res.arrayBuffer();
      } catch { /* fall back to synth */ }
    }));
    this._decodePending();
  }

  _decodePending() {
    if (!this.ctx || !this.bytes) return;
    for (const [name, buf] of Object.entries(this.bytes)) {
      if (this.buffers[name]) continue;
      this.ctx.decodeAudioData(buf.slice(0)).then((b) => { this.buffers[name] = b; }, () => {});
    }
  }

  play(name) {
    if (this._muted || !this.ctx) return;
    if (this.buffers[name]) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers[name];
      src.connect(this.ctx.destination);
      src.start();
      return;
    }
    this[`_${name}`]?.();
  }

  _tone(freq, end, dur, type = 'square', vol = 0.12, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(end, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _flap() { this._tone(380, 760, 0.09, 'triangle', 0.16); }
  _point() { this._tone(880, 880, 0.07, 'square', 0.09); this._tone(1320, 1320, 0.12, 'square', 0.09, 0.07); }
  _hit() {
    const c = this.ctx, len = c.sampleRate * 0.15, buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), g = c.createGain();
    g.gain.value = 0.25; s.buffer = buf; s.connect(g).connect(c.destination); s.start();
  }
  _die() { this._tone(520, 90, 0.4, 'sawtooth', 0.1); }
}
