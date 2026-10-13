export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, session } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(session && { Authorization: `Bearer ${session}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || res.statusText);
  return data;
}
