import { api, esc, toast } from './lib.js';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', load: () => import('./dashboard.js') },
  { id: 'theme', label: 'Theme editor', load: () => import('./theme.js') },
  { id: 'assets', label: 'Assets', load: () => import('./assets.js') },
  { id: 'events', label: 'Events', load: () => import('./events.js') },
  { id: 'leaderboard', label: 'Leaderboard', load: () => import('./leaderboard.js') },
];

const view = document.getElementById('view');
let cleanup = null;
let ctx = {};

function renderNav(active) {
  document.getElementById('nav').innerHTML = PAGES.map((p) =>
    `<a href="#${p.id}" class="whitespace-nowrap rounded-lg px-3 py-2 text-sm ${p.id === active ? 'bg-amber-400 font-semibold text-slate-900' : 'text-slate-300 hover:bg-white/5'}">${esc(p.label)}</a>`
  ).join('');
}

async function route() {
  const id = location.hash.slice(1) || 'dashboard';
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  renderNav(page.id);
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  view.innerHTML = '<p class="text-slate-400">Loading…</p>';
  try {
    const mod = await page.load();
    view.innerHTML = '';
    cleanup = (await mod.mount(view, ctx)) || null;
  } catch (e) {
    if (e.status !== 401) view.innerHTML = `<p class="text-red-400">Failed to load: ${esc(e.message)}</p>`;
  }
}

document.getElementById('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  location.href = '/admin/login.html';
});

addEventListener('hashchange', route);
api('/me').then((me) => {
  ctx = { eventTypes: me.eventTypes };
  document.getElementById('who').textContent = `Signed in as ${me.username}`;
  route();
}).catch((e) => e.status !== 401 && toast(e.message, 'error'));
