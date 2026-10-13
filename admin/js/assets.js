import { api, btn, card, esc, fmtBytes, toast } from './lib.js';
import { assetIdsInUse } from './theme.js';

export async function mount(el) {
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 class="text-2xl font-bold">Assets</h2>
      <p class="text-sm text-slate-400">PNG, JPEG, WEBP, GIF images and MP3, OGG, WAV sounds, up to 1 MB. Assign them in the Theme editor.</p></div>
      <label class="${btn} cursor-pointer">Upload file<input id="file" type="file" class="hidden" accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/ogg,audio/wav"></label>
    </div>
    <div id="grid" class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"></div>`;

  async function load() {
    const [{ assets }, cur] = await Promise.all([api('/assets'), api('/config')]);
    const used = new Set(assetIdsInUse(cur.config));
    el.querySelector('#grid').innerHTML = assets.map((a) => `
      <div class="${card} flex flex-col gap-2">
        <div class="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:16px_16px]">
          ${a.kind === 'image' ? `<img src="${esc(a.url)}" alt="" class="max-h-full max-w-full object-contain" style="image-rendering:pixelated">` : `<audio controls src="${esc(a.url)}" class="w-full"></audio>`}
        </div>
        <p class="truncate text-sm" title="${esc(a.filename)}">${esc(a.filename)}</p>
        <p class="text-xs text-slate-500">${esc(a.mime)} · ${fmtBytes(a.size)}</p>
        <div class="mt-auto flex items-center justify-between">
          ${used.has(a.id) ? '<span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-300">in use</span>' : '<span></span>'}
          <button data-del="${esc(a.id)}" class="rounded bg-red-600/70 px-2 py-1 text-xs hover:bg-red-600">Delete</button>
        </div>
      </div>`).join('') || '<p class="text-slate-500">No uploads yet.</p>';
  }

  el.querySelector('#file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try { await api('/assets', { method: 'POST', form }); toast('Uploaded'); await load(); } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  });
  el.querySelector('#grid').addEventListener('click', async (e) => {
    const id = e.target.dataset.del;
    if (!id || !confirm('Delete this asset?')) return;
    try { await api(`/assets/${id}`, { method: 'DELETE' }); toast('Deleted'); await load(); } catch (err) { toast(err.message, 'error'); }
  });
  await load();
}
