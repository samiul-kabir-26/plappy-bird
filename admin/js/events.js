import { api, btn, btn2, card, esc, fmtTime, input } from './lib.js';
import { typeBadge } from './dashboard.js';

export async function mount(el, ctx) {
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h2 class="text-2xl font-bold">Events</h2>
      <label class="flex items-center gap-2 text-sm text-slate-300"><input id="live" type="checkbox" checked> Live refresh (5 s)</label>
    </div>
    <form id="filters" class="${card} mb-4 flex flex-wrap items-end gap-3 text-sm">
      <label class="flex flex-col gap-1">Type
        <select name="type" class="${input}"><option value="">All</option>${ctx.eventTypes.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
      <label class="flex flex-col gap-1">Player ID<input name="player" class="${input}" placeholder="user id"></label>
      <label class="flex flex-col gap-1">From<input name="from" type="datetime-local" class="${input}"></label>
      <label class="flex flex-col gap-1">To<input name="to" type="datetime-local" class="${input}"></label>
      <button class="${btn}">Apply</button>
      <a id="csv" class="${btn2}" href="#">Export CSV</a>
    </form>
    <div class="${card} overflow-x-auto"><table class="w-full text-left text-sm">
      <thead class="text-xs uppercase text-slate-500"><tr><th class="pb-2">ID</th><th>Type</th><th>Player</th><th>Run</th><th>Payload</th><th class="text-right">Time</th></tr></thead>
      <tbody id="rows"></tbody></table>
      <div class="mt-3 flex items-center gap-3"><button id="more" class="${btn2} hidden">Load more</button><span id="count" class="text-xs text-slate-500"></span></div>
    </div>
    <aside id="drawer" class="fixed inset-y-0 right-0 z-40 hidden w-full max-w-lg overflow-auto bg-slate-900 p-5 shadow-2xl ring-1 ring-white/10">
      <div class="mb-3 flex items-center justify-between"><h3 class="font-semibold">Event detail</h3><button id="close" class="${btn2}">Close</button></div>
      <pre id="json" class="whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-xs text-emerald-200"></pre>
    </aside>`;

  const form = el.querySelector('#filters');
  const rows = el.querySelector('#rows');
  let events = [];
  let nextBefore = null;

  const iso = (v) => (v ? new Date(v).toISOString() : '');
  const query = (extra = {}) => {
    const f = new URLSearchParams();
    const d = Object.fromEntries(new FormData(form));
    if (d.type) f.set('type', d.type);
    if (d.player) f.set('player', d.player.trim());
    if (d.from) f.set('from', iso(d.from));
    if (d.to) f.set('to', iso(d.to));
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  function draw() {
    rows.innerHTML = events.map((ev, i) => `
      <tr data-i="${i}" class="cursor-pointer border-t border-white/5 hover:bg-white/5">
        <td class="py-1.5 pr-3 tabular-nums text-slate-500">${ev.id}</td><td class="pr-3">${typeBadge(ev.type)}</td>
        <td class="max-w-[10rem] truncate pr-3">${esc(ev.playerId || '')}</td>
        <td class="pr-3 font-mono text-xs text-slate-500">${esc((ev.runId || '').slice(0, 8))}</td>
        <td class="max-w-xs truncate pr-3 font-mono text-xs text-slate-400">${esc(JSON.stringify(ev.payload))}</td>
        <td class="whitespace-nowrap text-right text-slate-500">${esc(fmtTime(ev.createdAt))}</td></tr>`).join('')
      || '<tr><td colspan="6" class="py-6 text-center text-slate-500">No events match.</td></tr>';
    el.querySelector('#more').classList.toggle('hidden', nextBefore == null);
    el.querySelector('#count').textContent = `${events.length} shown`;
    el.querySelector('#csv').href = `/admin/api/events?${query({ format: 'csv' })}`;
  }

  async function loadFirst() {
    const r = await api(`/events?${query({ limit: 50 })}`);
    // keep already-loaded older pages when live-refreshing
    const known = new Set(r.events.map((e) => e.id));
    const oldest = r.events.length ? r.events[r.events.length - 1].id : Infinity;
    events = [...r.events, ...events.filter((e) => !known.has(e.id) && e.id < oldest)];
    if (nextBefore == null || r.nextBefore != null) nextBefore = events.length ? (r.nextBefore ?? nextBefore) : null;
    draw();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); events = []; nextBefore = null; loadFirst(); });
  el.querySelector('#more').addEventListener('click', async () => {
    const r = await api(`/events?${query({ limit: 50, before: nextBefore })}`);
    events = [...events, ...r.events];
    nextBefore = r.nextBefore;
    draw();
  });
  rows.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    el.querySelector('#json').textContent = JSON.stringify(events[+tr.dataset.i], null, 2);
    el.querySelector('#drawer').classList.remove('hidden');
  });
  el.querySelector('#close').addEventListener('click', () => el.querySelector('#drawer').classList.add('hidden'));

  await loadFirst();
  const timer = setInterval(() => { if (el.querySelector('#live').checked) loadFirst().catch(() => {}); }, 5000);
  return () => clearInterval(timer);
}
