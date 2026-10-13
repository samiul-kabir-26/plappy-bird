// Built-in default art, drawn procedurally so the service ships no copyrighted
// (or binary) assets. Operators replace any of these from the admin panel.
import { WORLD } from '../../../shared/defaults.js';

const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
};

export function makeBird(frames = 3) {
  const { birdW: W, birdH: H } = WORLD;
  const [c, g] = canvas(W * frames, H);
  const wingY = [-3, 1, 5];
  for (let f = 0; f < frames; f++) {
    g.save();
    g.translate(f * W, 0);
    g.fillStyle = '#f6c026'; g.strokeStyle = '#533846'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(16, 12, 14, 10, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fbe4a0'; g.beginPath(); g.ellipse(14, 17, 9, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(22, 8, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#533846'; g.beginPath(); g.arc(24, 8, 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2602f';
    g.beginPath(); g.ellipse(29, 15, 5, 3.2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fff4d0';
    g.beginPath(); g.ellipse(9, 13 + wingY[f % 3], 7, 4.5, -0.2, 0, Math.PI * 2); g.fill(); g.stroke();
    g.restore();
  }
  return c;
}

// Pipe with its cap at the TOP (used for the bottom pipe; flipped for the top one).
export function makePipe() {
  const W = WORLD.pipeW, H = 320, cap = 26;
  const [c, g] = canvas(W, H);
  const body = (x, w, y, h) => {
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, '#9be35a'); gr.addColorStop(0.35, '#73bf2e'); gr.addColorStop(1, '#4c8a1c');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.strokeStyle = '#2d4d17'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  body(4, W - 8, cap, H - cap);
  body(0, W, 0, cap);
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(6, 4, 5, cap - 8); g.fillRect(9, cap + 3, 4, H - cap - 6);
  return c;
}

export function makeGround() {
  const W = 48, H = WORLD.height - WORLD.groundY;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#ded895'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#73bf2e'; g.fillRect(0, 0, W, 14);
  g.fillStyle = '#9be35a'; g.fillRect(0, 0, W, 4);
  g.fillStyle = '#4c8a1c';
  for (let x = -24; x < W + 24; x += 24) {
    g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 12, 4); g.lineTo(x + 24, 14); g.closePath(); g.fill();
  }
  g.fillStyle = '#d2c47a'; g.fillRect(0, 14, W, 3);
  g.fillStyle = '#c4b269'; for (let x = 6; x < W; x += 16) g.fillRect(x, 40 + (x % 3) * 8, 6, 3);
  return c;
}

export function makeBackground() {
  const W = WORLD.width, H = WORLD.groundY;
  const [c, g] = canvas(W, H);
  // Scenery only: the sky colour comes from the theme, this just adds a soft horizon haze.
  const haze = g.createLinearGradient(0, 0, 0, H);
  haze.addColorStop(0, 'rgba(255,255,255,0)'); haze.addColorStop(1, 'rgba(255,255,255,.55)');
  g.fillStyle = haze; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.9)';
  for (const [x, y, s] of [[34, 250, 1], [150, 300, 0.8], [235, 215, 1.1]]) {
    for (const [dx, dy, r] of [[-16, 4, 11], [0, -2, 15], [17, 3, 12], [0, 8, 12]]) {
      g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); g.fill();
    }
  }
  g.fillStyle = '#9ed8a0';
  for (const [x, y, r] of [[30, 400, 70], [120, 405, 60], [215, 400, 80], [290, 408, 55]]) {
    g.beginPath(); g.arc(x, y, r, Math.PI, 0); g.fill();
  }
  g.fillStyle = '#b4e3c0';
  for (const [x, w, h] of [[10, 22, 40], [40, 28, 62], [76, 20, 34], [150, 26, 52], [190, 22, 70], [232, 30, 44]]) g.fillRect(x, H - h - 8, w, h);
  return c;
}
