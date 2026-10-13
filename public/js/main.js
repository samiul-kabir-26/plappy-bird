import { DEFAULT_CONFIG, WORLD } from '/shared/defaults.js';
import { api } from './api.js';
import { GameAudio } from './game/audio.js';
import { loadAssets } from './game/assets.js';
import { Engine } from './game/engine.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true, display = 'flex') => { el.style.display = on ? display : 'none'; };
const stage = $('stage');
const canvas = $('game');
const audio = new GameAudio();

let cfg = structuredClone(DEFAULT_CONFIG);
let allowGuests = true;
let session = null; // bearer token, null => offline / unsubmitted play
let player = null;
let engine = null;
let run = null;

// ---- layout: integer scale where it doesn't waste much space ---------------
function layout() {
  const fit = Math.min(innerWidth / WORLD.width, innerHeight / WORLD.height);
  const whole = Math.floor(fit);
  const scale = whole >= 1 && whole / fit > 0.85 ? whole : fit;
  const w = Math.floor(WORLD.width * scale);
  stage.style.width = `${w}px`;
  stage.style.height = `${Math.floor(WORLD.height * scale)}px`;
  stage.style.fontSize = `${w / WORLD.width}px`;
  engine?.resize(w);
}

function applyTheme() {
  stage.style.setProperty('--btn', cfg.colors.button);
  stage.style.setProperty('--btn-text', cfg.colors.buttonText);
  stage.style.fontFamily = cfg.font;
  document.title = cfg.text.title;
}

const bestKey = () => `pb_best:${player?.userId || 'local'}`;
const readBest = () => { try { return Number(localStorage.getItem(bestKey())) || 0; } catch { return 0; } };
const writeBest = (n) => { try { localStorage.setItem(bestKey(), String(n)); } catch { /* storage unavailable */ } };

function message(text) {
  $('msg-text').textContent = text;
  show($('msg'));
  show($('loading'), false);
}

// ---- run reporting ---------------------------------------------------------
function flush(r) {
  const batch = r.ticks.slice(r.sent);
  if (!batch.length) return;
  r.sent = r.ticks.length;
  r.chain = r.chain.then(async (id) => {
    if (id) await api(`/runs/${id}/ticks`, { method: 'POST', body: { ticks: batch }, session }).catch(() => { r.failed = true; });
    return id;
  });
}

const hooks = {
  onState(s) {
    show($('over-actions'), s === 'GAME_OVER');
    show($('btn-board'), s === 'READY' && !!session);
  },
  onStart() {
    run = null;
    if (!session) return;
    const r = { ticks: [], sent: 0, failed: false };
    r.chain = api('/runs', { method: 'POST', session })
      .then((res) => { engine.reseed(res.seed); return res.runId; })
      .catch(() => null);
    run = r;
  },
  onScore(score, t) {
    if (!run) return;
    run.ticks.push({ t: Math.round(t) });
    if (run.ticks.length - run.sent >= 5) flush(run);
  },
  onEnd({ score, flaps, isBest }) {
    if (isBest) writeBest(score);
    const r = run;
    run = null;
    if (!r) return;
    flush(r);
    r.chain.then(async (id) => {
      if (!id) return;
      try {
        const res = await api(`/runs/${id}/end`, { method: 'POST', body: { score, flaps }, session });
        engine.best = Math.max(engine.best, res.best);
        if (res.rank) engine.panelNote = `Rank #${res.rank} all-time`;
        writeBest(engine.best);
      } catch (e) {
        engine.panelNote = e.status === 422 ? 'Score not counted' : '';
      }
    });
  },
};

// ---- leaderboard modal -----------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadBoard(period) {
  for (const b of document.querySelectorAll('#board-tabs button')) {
    b.classList.toggle('!bg-white', b.dataset.period === period);
    b.classList.toggle('text-slate-900', b.dataset.period === period);
  }
  const list = $('board-list');
  list.innerHTML = '<li class="text-center opacity-70">Loading…</li>';
  try {
    const [{ entries }, me] = await Promise.all([
      api(`/leaderboard?period=${period}&limit=20`),
      session ? api('/leaderboard/me', { session }).catch(() => null) : null,
    ]);
    list.innerHTML = entries.length
      ? entries.map((e) => `
          <li class="flex items-center justify-between border-b border-white/10" style="padding:0.35em 0.2em">
            <span class="w-[2.2em] text-center font-bold ${e.rank <= 3 ? 'text-yellow-300' : 'text-white/70'}">${e.rank}</span>
            <span class="flex-1 truncate">${esc(e.displayName)}${e.isGuest ? ' <span class="opacity-50" style="font-size:0.75em">guest</span>' : ''}</span>
            <span class="font-bold">${e.score}</span>
          </li>`).join('')
      : '<li class="text-center opacity-70">No scores yet. Be the first!</li>';
    const mine = me?.[period];
    $('board-me').textContent = mine ? `You: #${mine.rank} with ${mine.score}` : '';
  } catch {
    list.innerHTML = '<li class="text-center text-red-300">Could not load the leaderboard</li>';
  }
}

function openBoard() { show($('board')); loadBoard('weekly'); }

// ---- boot ------------------------------------------------------------------
async function startGame() {
  show($('loading'), false);
  show($('nick-form'), false);
  show($('btn-mute'));
  $('mute-glyph').textContent = audio.muted ? '🔇' : '🔊';
  engine = new Engine(canvas, { config: cfg, assets: await loadAssets(cfg), audio, hooks, best: readBest(), keyTarget: window });
  layout();
  hooks.onState('READY');
  engine.start();
  if (location.hostname === 'localhost') window.__pb = engine; // dev/test handle
  canvas.focus({ preventScroll: true });
}

async function openSession() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  if (token) {
    history.replaceState(null, '', location.pathname); // keep the token out of history / referrers
    try {
      const res = await api('/session', { method: 'POST', body: { token } });
      return res;
    } catch (e) {
      if (e.status === 401) throw new Error('This game link is invalid or has expired. Please relaunch the game from the app.');
      throw e;
    }
  }
  let saved = null;
  try { saved = localStorage.getItem('pb_guest_session'); } catch { /* storage unavailable */ }
  if (saved) {
    try { return { session: saved, ...(await api('/session/me', { session: saved })) }; } catch { /* expired */ }
  }
  if (!allowGuests) throw new Error('Please launch this game from the app you were sent from.');
  return null;
}

async function boot() {
  layout();
  addEventListener('resize', layout);
  try {
    const res = await api('/config');
    cfg = res.config;
    allowGuests = res.allowGuests;
  } catch { /* offline: built-in defaults */ }
  applyTheme();
  audio.loadCustom(cfg.assets);

  let s;
  try {
    s = await openSession();
  } catch (e) {
    if (e.status) { /* server error: play without submitting */ s = undefined; } else { message(e.message); return; }
  }

  if (s === null) {
    // guest: ask for a nickname
    show($('loading'), false);
    show($('nick-form'));
    $('nick').focus();
    await new Promise((resolve) => {
      $('nick-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          const res = await api('/session', { method: 'POST', body: { nickname: $('nick').value } });
          try { localStorage.setItem('pb_guest_session', res.session); } catch { /* storage unavailable */ }
          s = res;
          resolve();
        } catch (e) {
          $('nick-err').textContent = e.message;
        }
      });
    });
  }
  if (s) { session = s.session; player = s.player; }

  await startGame();
}

$('btn-restart').addEventListener('click', () => engine.restart());
$('btn-board').addEventListener('click', openBoard);
$('btn-board2').addEventListener('click', openBoard);
$('board-close').addEventListener('click', () => show($('board'), false));
$('btn-mute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  $('mute-glyph').textContent = audio.muted ? '🔇' : '🔊';
  canvas.focus({ preventScroll: true });
});
for (const b of document.querySelectorAll('#board-tabs button')) b.addEventListener('click', () => loadBoard(b.dataset.period));

boot();
