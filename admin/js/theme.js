import { DEFAULT_CONFIG, FIELDS, getPath, setPath } from '/shared/defaults.js';
import { Engine } from '/js/game/engine.js';
import { loadAssets } from '/js/game/assets.js';
import { AdminApiError, api, btn, btn2, card, esc, fmtTime, input, toast } from './lib.js';

export const assetIdsInUse = (config) => Object.values(config.assets).filter((v) => typeof v === 'string');

export async function mount(el) {
  const [cur, { assets: initialAssets }, { versions }] = await Promise.all([api('/config'), api('/assets'), api('/config/history')]);
  let saved = cur.config;
  let draft = structuredClone(saved);
  let assetList = initialAssets;
  let history = versions;
  let version = cur.version;
  const assetCache = {};
  let engine = null;

  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 class="text-2xl font-bold">Theme editor</h2>
      <p class="text-sm text-slate-400">Live version <b id="ver"></b> <span id="dirty" class="ml-2 hidden rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">unsaved changes</span></p></div>
      <div class="flex flex-wrap items-center gap-2">
        <select id="hist" class="${input}"></select><button id="rollback" class="${btn2}">Rollback</button>
        <button id="defaults" class="${btn2}">Reset to defaults</button>
        <button id="save" class="${btn}">Save &amp; publish</button>
      </div>
    </div>
    <div id="errors" class="mb-4 hidden rounded-lg bg-red-500/15 p-3 text-sm text-red-300"></div>
    <div class="flex flex-col gap-6 xl:flex-row-reverse">
      <div class="xl:sticky xl:top-6 xl:self-start">
        <div class="${card} flex flex-col items-center gap-2">
          <canvas id="preview" tabindex="0" class="block rounded-lg" style="width:288px"></canvas>
          <p class="text-xs text-slate-400">Live preview. Click or press Space to play.</p>
          <button id="restart" class="${btn2}">Restart preview</button>
        </div>
      </div>
      <form id="form" class="min-w-0 flex-1 space-y-4" onsubmit="return false"></form>
    </div>`;

  const q = (s) => el.querySelector(s);
  const groups = [...new Set(FIELDS.map((f) => f.group))];

  function assetField(f) {
    const value = getPath(draft, f.path);
    const options = assetList.filter((a) => a.kind === f.kind);
    const sel = options.find((a) => a.id === value);
    const preview = sel
      ? f.kind === 'image'
        ? `<img src="${esc(sel.url)}" alt="" class="h-10 w-10 rounded bg-slate-800 object-contain" style="image-rendering:pixelated">`
        : `<audio controls src="${esc(sel.url)}" class="h-8 w-40"></audio>`
      : '<span class="text-xs text-slate-500">built-in default</span>';
    return `<div class="flex flex-wrap items-center gap-2">
      <select data-path="${f.path}" class="${input} min-w-0 flex-1">
        <option value="">Default</option>${options.map((a) => `<option value="${a.id}" ${a.id === value ? 'selected' : ''}>${esc(a.filename)}</option>`).join('')}
      </select>${preview}
      <label class="${btn2} cursor-pointer">Upload<input type="file" data-upload="${f.path}" data-kind="${f.kind}" class="hidden"
        accept="${f.kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : 'audio/mpeg,audio/ogg,audio/wav'}"></label></div>`;
  }

  function fieldHtml(f) {
    const v = getPath(draft, f.path);
    let control;
    if (f.type === 'asset') control = assetField(f);
    else if (f.type === 'color') control = `<div class="flex items-center gap-2"><input type="color" data-path="${f.path}" value="${esc(v)}" class="h-8 w-12 cursor-pointer rounded bg-transparent"><code class="text-xs text-slate-400">${esc(v)}</code></div>`;
    else if (f.type === 'number' || f.type === 'int') control = `<div class="flex items-center gap-3"><input type="range" data-path="${f.path}" data-num="${f.type}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${v}" class="flex-1 accent-amber-400"><input type="number" data-path="${f.path}" data-num="${f.type}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${v}" class="${input} w-24"></div>`;
    else control = `<input type="text" data-path="${f.path}" maxlength="${f.max}" value="${esc(v)}" class="${input} w-full">`;
    return `<div class="grid gap-1 sm:grid-cols-[14rem_1fr] sm:items-center"><label class="text-sm text-slate-300">${esc(f.label)}</label>${control}</div>`;
  }

  function renderForm() {
    q('#form').innerHTML = groups.map((g) => `
      <section class="${card}"><h3 class="mb-3 font-semibold text-amber-300">${esc(g)}</h3><div class="space-y-3">
        ${FIELDS.filter((f) => f.group === g && (!f.showIf || getPath(draft, f.showIf))).map(fieldHtml).join('')}
      </div></section>`).join('');
    q('#hist').innerHTML = history.map((h) => `<option value="${h.version}">v${h.version} · ${esc(fmtTime(h.createdAt))} · ${esc(h.createdBy)}</option>`).join('');
    q('#ver').textContent = `v${version}`;
    q('#dirty').classList.toggle('hidden', JSON.stringify(draft) === JSON.stringify(saved));
  }

  let previewTimer = 0;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const a = await loadAssets(draft, assetCache);
      if (engine) engine.setTheme(draft, a);
      else engine = new Engine(q('#preview'), { config: draft, assets: a, preview: true, keyTarget: q('#preview') });
      engine.setTheme(draft, a);
      if (!engine.raf) engine.start();
    }, 120);
  }

  function setValue(path, raw, target) {
    const f = FIELDS.find((x) => x.path === path);
    let value = raw;
    if (f.type === 'number' || f.type === 'int') {
      value = f.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
      if (!Number.isFinite(value)) return;
    }
    if (f.type === 'asset' && raw === '') value = null;
    setPath(draft, path, value);
    // keep the paired slider / number box in sync without re-rendering (which would drop focus)
    for (const o of el.querySelectorAll(`[data-path="${path}"]`)) if (o !== target && o.type !== 'file') o.value = value;
    const code = target?.parentElement?.querySelector('code');
    if (f.type === 'color' && code) code.textContent = value;
    q('#dirty').classList.toggle('hidden', JSON.stringify(draft) === JSON.stringify(saved));
    schedulePreview();
  }

  q('#form').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.path || t.tagName === 'SELECT') return;
    setValue(t.dataset.path, t.value, t);
  });
  q('#form').addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.upload) {
      const file = t.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      try {
        const asset = await api('/assets', { method: 'POST', form });
        if (asset.kind !== t.dataset.kind) { toast(`That file is ${asset.kind}, expected ${t.dataset.kind}`, 'error'); }
        else { assetList = [asset, ...assetList]; setPath(draft, t.dataset.upload, asset.id); renderForm(); schedulePreview(); toast('Uploaded'); }
      } catch (err) { toast(err.message, 'error'); }
    } else if (t.tagName === 'SELECT' && t.dataset.path) {
      setPath(draft, t.dataset.path, t.value || null);
      renderForm();
      schedulePreview();
    }
  });

  const showErrors = (err) => {
    const box = q('#errors');
    box.classList.toggle('hidden', !err);
    if (err) box.innerHTML = `<b>${esc(err.message)}</b><ul class="mt-1 list-disc pl-5">${(err.details || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
  };

  async function refreshAfterWrite(res) {
    saved = res.config;
    draft = structuredClone(saved);
    version = res.version;
    history = (await api('/config/history')).versions;
    renderForm();
    schedulePreview();
  }

  q('#save').addEventListener('click', async () => {
    showErrors(null);
    try { await refreshAfterWrite(await api('/config', { method: 'PUT', body: draft })); toast(`Published v${version}`); }
    catch (err) { if (err instanceof AdminApiError) { showErrors(err); toast('Fix the highlighted problems', 'error'); } else throw err; }
  });
  q('#rollback').addEventListener('click', async () => {
    const v = q('#hist').value;
    if (!v || !confirm(`Roll back to v${v}? A new version is published with that content.`)) return;
    showErrors(null);
    try { await refreshAfterWrite(await api(`/config/rollback/${v}`, { method: 'POST' })); toast(`Rolled back, now v${version}`); }
    catch (err) { showErrors(err); }
  });
  q('#defaults').addEventListener('click', () => { draft = structuredClone(DEFAULT_CONFIG); renderForm(); schedulePreview(); });
  q('#restart').addEventListener('click', () => engine?.restart());

  renderForm();
  schedulePreview();
  return () => { clearTimeout(previewTimer); engine?.stop(); };
}
