import { WORLD, medalFor } from '../../../shared/defaults.js';

const { width: W, height: H, groundY, birdX, birdW, birdH, pipeW } = WORLD;
const MEDAL_COLORS = { bronze: ['#cd7f32', '#e9a966'], silver: ['#9aa0a6', '#d5d9dc'], gold: ['#e0a800', '#ffe066'], platinum: ['#7fb7c9', '#e6f6fb'] };

function outlinedText(g, text, x, y, size, { fill = '#fff', stroke = '#533846', font, align = 'center', weight = 'bold' } = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, size / 6);
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

// Draws one pipe column growing away from the gap edge `y0` (away: +1 down, -1 up) for `length` px.
// The image keeps its aspect at width pipeW. `mirror` flips it vertically so its cap faces the gap;
// if the image is shorter than `length`, its far-end pixel row is stretched to fill the rest.
function drawPipe(g, img, x, y0, away, mirror, length) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const h = (ih * pipeW) / iw;
  const y1 = away > 0 ? y0 : y0 - h;
  g.save();
  g.beginPath();
  g.rect(x, away > 0 ? y0 : y0 - length, pipeW, length);
  g.clip();
  g.save();
  if (mirror) { g.translate(0, 2 * y1 + h); g.scale(1, -1); }
  g.drawImage(img, x, y1, pipeW, h);
  g.restore();
  if (h < length) {
    const farRow = (away > 0) === !mirror ? ih - 1 : 0;
    g.drawImage(img, 0, farRow, iw, 1, x, away > 0 ? y0 + h : y0 - length, pipeW, length - h);
  }
  g.restore();
}

export function render(g, game, assets, cfg) {
  const font = cfg.font;
  g.imageSmoothingEnabled = assets.custom.bird || assets.custom.background ? true : false;

  // sky + background
  g.fillStyle = cfg.colors.sky;
  g.fillRect(0, 0, W, H);
  g.drawImage(assets.background, 0, 0, W, groundY);

  // pipes
  for (const p of game.pipes) {
    const top = p.gapY - cfg.pipes.gap / 2;
    const bottom = p.gapY + cfg.pipes.gap / 2;
    drawPipe(g, assets.pipeTop, p.x, top, -1, assets.pipeFlipTop, top + 100);
    drawPipe(g, assets.pipeBottom, p.x, bottom, 1, assets.pipeFlipBottom, groundY - bottom + 10);
  }

  // ground (clipped so pipes stay behind it)
  const gi = assets.ground;
  const gh = H - groundY;
  const gw = Math.max(8, ((gi.naturalWidth || gi.width) * gh) / (gi.naturalHeight || gi.height));
  g.save();
  g.beginPath(); g.rect(0, groundY, W, gh); g.clip();
  g.fillStyle = '#ded895'; g.fillRect(0, groundY, W, gh);
  for (let x = game.groundX % gw; x < W; x += gw) g.drawImage(gi, x, groundY, gw, gh);
  g.restore();

  // bird
  const bi = assets.bird;
  const fw = (bi.naturalWidth || bi.width) / assets.birdFrames;
  const fh = bi.naturalHeight || bi.height;
  const dh = (fh * birdW) / fw;
  const frame = game.state === 'DYING' || game.state === 'GAME_OVER' ? 1 : game.birdFrame % assets.birdFrames;
  g.save();
  g.translate(birdX, game.bird.y);
  g.rotate((game.bird.rot * Math.PI) / 180);
  g.drawImage(bi, frame * fw, 0, fw, fh, -birdW / 2, -dh / 2, birdW, dh);
  g.restore();

  const st = game.state;

  if (st === 'PLAYING' || st === 'DYING') {
    outlinedText(g, String(game.score), W / 2, 70, 44, { fill: cfg.colors.score, font });
  }

  if (st === 'READY') {
    if (assets.logo) {
      const lw = Math.min(220, assets.logo.naturalWidth), lh = (assets.logo.naturalHeight * lw) / assets.logo.naturalWidth;
      g.drawImage(assets.logo, (W - lw) / 2, 70, lw, Math.min(lh, 90));
    } else {
      outlinedText(g, cfg.text.title, W / 2, 95, 38, { fill: '#f6c026', font });
    }
    outlinedText(g, cfg.text.getReady, W / 2, 175, 28, { fill: cfg.colors.score, font });
    outlinedText(g, cfg.text.tapHint, W / 2, 300, 15, { fill: '#fff', font, weight: '600' });
  }

  if (game.flash > 0) {
    g.fillStyle = `rgba(255,255,255,${game.flash})`;
    g.fillRect(0, 0, W, H);
  }

  if (st === 'GAME_OVER') {
    const t = Math.min(1, game.overFrames / 24);
    const ease = 1 - (1 - t) * (1 - t);
    g.globalAlpha = ease;
    outlinedText(g, cfg.text.gameOver, W / 2, 120, 32, { fill: '#f2602f', font });
    const py = 160 + (1 - ease) * 80;
    g.fillStyle = cfg.colors.panel;
    g.strokeStyle = '#533846';
    g.lineWidth = 3;
    g.beginPath(); g.roundRect(34, py, W - 68, 130, 8); g.fill(); g.stroke();

    const medal = medalFor(game.score, cfg.medals);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.arc(80, py + 65, 28, 0, Math.PI * 2); g.fill();
    if (medal) {
      const [dark, light] = MEDAL_COLORS[medal];
      const gr = g.createRadialGradient(76, py + 58, 4, 80, py + 65, 26);
      gr.addColorStop(0, light); gr.addColorStop(1, dark);
      g.fillStyle = gr; g.strokeStyle = '#533846'; g.lineWidth = 2;
      g.beginPath(); g.arc(80, py + 65, 24, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `bold 22px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('★', 80, py + 66);
    }

    g.textAlign = 'right';
    g.fillStyle = '#e8794a'; g.font = `bold 11px ${font}`; g.textBaseline = 'alphabetic';
    g.fillText('SCORE', W - 50, py + 30);
    g.fillText('BEST', W - 50, py + 82);
    outlinedText(g, String(game.score), W - 50, py + 54, 26, { fill: '#fff', font, align: 'right' });
    outlinedText(g, String(game.best), W - 50, py + 106, 26, { fill: '#fff', font, align: 'right' });
    if (game.newBest) {
      g.fillStyle = '#e8402f'; g.beginPath(); g.roundRect(W - 126, py + 94, 34, 16, 3); g.fill();
      g.fillStyle = '#fff'; g.font = `bold 10px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('NEW', W - 109, py + 102);
    }
    if (game.panelNote) {
      outlinedText(g, game.panelNote, W / 2, py + 152, 13, { fill: '#fff', font, weight: '600' });
    }
    g.globalAlpha = 1;
  }

  if (game.paused) {
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, W, H);
    outlinedText(g, 'Paused', W / 2, H / 2 - 10, 32, { fill: '#fff', font });
    outlinedText(g, 'Tap or press P to resume', W / 2, H / 2 + 28, 13, { fill: '#fff', font, weight: '600' });
  }
}
