const form = document.getElementById('form');
const err = document.getElementById('err');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  form.querySelector('button').disabled = true;
  try {
    const res = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (res.ok) return (location.href = '/admin/');
    const data = await res.json().catch(() => null);
    err.textContent = data?.error?.message || 'Sign in failed';
  } catch {
    err.textContent = 'Network error';
  }
  form.querySelector('button').disabled = false;
});
