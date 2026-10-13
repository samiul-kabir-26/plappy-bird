export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class AdminApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.details = body?.error?.details;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`/admin/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) { location.href = '/admin/login.html'; throw new AdminApiError(401, null); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AdminApiError(res.status, data);
  return data;
}

export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${kind === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`;
  el.textContent = message;
  document.getElementById('toast').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 2500);
}

export const card = 'rounded-xl bg-slate-900 p-4 ring-1 ring-white/10';
export const btn = 'rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-50';
export const btn2 = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-50';
export const input = 'rounded-lg bg-slate-800 px-3 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-amber-400';

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '');
export const fmtBytes = (n) => (n > 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);
