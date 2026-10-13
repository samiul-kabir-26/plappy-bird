import { api, card, esc, fmtTime } from './lib.js';

const TYPE_STYLE = {
  'run.rejected': 'bg-red-500/20 text-red-300',
  'run.ended': 'bg-emerald-500/20 text-emerald-300',
  'player.personal_best': 'bg-amber-500/20 text-amber-300',
};
export const typeBadge = (t) => `<span class="rounded px-1.5 py-0.5 font-mono text-xs ${TYPE_STYLE[t] || 'bg-white/10 text-slate-300'}">${esc(t)}</span>`;

export async function mount(el) {
  el.innerHTML = `
    <h2 class="mb-4 text-2xl font-bold">Dashboard</h2>
    <div id="stats" class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"></div>
    <div class="${card}">
      <h3 class="mb-3 font-semibold">Latest events <span class="text-xs font-normal text-slate-500">(refreshes every 10 s)</span></h3>
      <div id="feed" class="overflow-x-auto"></div>
    </div>`;

  async function refresh() {
    const [s, e] = await Promise.all([api('/stats'), api('/events?limit=15')]);
    const tiles = [
      ['Runs today', s.runsToday], ['Active players today', s.activePlayersToday], ['Total players', s.totalPlayers],
      ['Average score', s.averageScore], ['Top score', s.topScore], ['Rejected today', s.rejectedToday],
    ];
    el.querySelector('#stats').innerHTML = tiles.map(([k, v]) =>
      `<div class="${card}"><p class="text-xs text-slate-400">${k}</p><p class="mt-1 text-3xl font-bold tabular-nums">${esc(v)}</p></div>`).join('');
    el.querySelector('#feed').innerHTML = e.events.length
      ? `<table class="w-full text-left text-sm"><tbody>${e.events.map((ev) => `
          <tr class="border-t border-white/5"><td class="py-1.5 pr-3 text-slate-500 tabular-nums">#${ev.id}</td>
          <td class="pr-3">${typeBadge(ev.type)}</td><td class="pr-3 text-slate-300">${esc(ev.playerId || '')}</td>
          <td class="pr-3 font-mono text-xs text-slate-400">${esc(JSON.stringify(ev.payload))}</td>
          <td class="whitespace-nowrap text-right text-slate-500">${esc(fmtTime(ev.createdAt))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="text-sm text-slate-500">No events yet. Play a round!</p>';
  }
  await refresh();
  const t = setInterval(() => refresh().catch(() => {}), 10_000);
  return () => clearInterval(t);
}
