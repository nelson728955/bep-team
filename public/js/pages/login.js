import { api, esc } from '../ui.js';

export function render(root, onSuccess) {
  root.innerHTML = `
    <div class="login">
      <div class="login-logo" role="img" aria-label="Bếp, Cuisine Vietnamienne"></div>
      <form class="login-card" novalidate>
        <div class="brand"><span class="brand-mark">SH</span><span>ShiftHub</span></div>
        <h1 style="margin-bottom:4px">Welcome back</h1>
        <p class="muted" style="margin-bottom:20px">Sign in to see your schedule, clock in, and more.</p>
        <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="username" autofocus></label>
        <label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
        <p class="form-error" style="margin:0 0 12px" hidden></p>
        <button class="btn btn-primary" style="width:100%;height:42px" type="submit">Sign in</button>
        <p class="small muted" style="margin:16px 0 0">Need access? Ask your restaurant manager for your account.</p>
      </form>
    </div>`;
  const form = root.querySelector('form');
  const err = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    err.hidden = true;
    try {
      await api('/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
      await onSuccess();
    } catch (ex) {
      err.innerHTML = esc(ex.message);
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}
