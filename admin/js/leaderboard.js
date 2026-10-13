import { api, btn2, card, esc, fmtTime, toast } from './lib.js';

export async function mount(el) {
  let period = 'all';
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-2xl font-bold">Leaderboard</h2>
      <div class="flex gap-2" id="tabs"></div>
    </div>
    <div class="${card} overflow-x-auto"><table class="w-full text-left text-sm">
      <thead class="text-xs uppercase text-slate-500"><tr><th class="pb-2">#</th><th>Player</th><th>User ID</th><th>Score</th><th>When</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table></div>
    <div class="mt-4"><button id="reset" class="rounded-lg bg-red-600/80 px-3 py-1.5 text-sm font-semibold hover:bg-red-600">Reset this period…</button>
    <p class="mt-1 text-xs text-slate-500">Resetting marks the finished runs in the period as removed. Events already emitted are kept.</p></div>`;

  const tabs = [['daily', 'Last 24 h'], ['weekly', 'Last 7 days'], ['all', 'All time']];
  const drawTabs = () => {
    el.querySelector('#tabs').innerHTML = tabs.map(([id, label]) =>
      `<button data-p="${id}" class="${btn2} ${id === period ? '!bg-amber-400 !text-slate-900 font-semibold' : ''}">${label}</button>`).join('');
  };

  async function load() {
    drawTabs();
    const { entries } = await api(`/leaderboard?period=${period}`);
    el.querySelector('#rows').innerHTML = entries.map((e) => `
      <tr class="border-t border-white/5"><td class="py-1.5 pr-3 font-bold tabular-nums">${e.rank}</td>
      <td class="pr-3">${esc(e.displayName)}${e.isGuest ? ' <span class="text-xs text-slate-500">guest</span>' : ''}</td>
      <td class="pr-3 font-mono text-xs text-slate-400">${esc(e.userId)}</td><td class="pr-3 font-bold tabular-nums">${e.score}</td>
      <td class="pr-3 text-slate-500">${esc(fmtTime(e.endedAt))}</td>
      <td class="text-right"><button data-run="${esc(e.runId)}" class="rounded bg-red-600/70 px-2 py-1 text-xs hover:bg-red-600">Remove</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="py-6 text-center text-slate-500">No scores in this period.</td></tr>';
  }

  el.addEventListener('click', async (e) => {
    try {
      const p = e.target.closest('[data-p]');
      if (p) { period = p.dataset.p; return await load(); }
      const r = e.target.closest('[data-run]');
      if (r && confirm('Remove this run from the leaderboard?')) {
        await api(`/runs/${r.dataset.run}`, { method: 'DELETE' });
        toast('Run removed');
        await load();
      }
      if (e.target.id === 'reset' && confirm(`Reset the "${period}" leaderboard? This cannot be undone.`)) {
        const res = await api(`/leaderboard/reset?period=${period}`, { method: 'POST' });
        toast(`Removed ${res.removedRuns} runs`);
        await load();
      }
    } catch (err) { toast(err.message, 'error'); }
  });
  await load();
}
