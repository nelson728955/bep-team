import { api, esc, avatar, toast, modal, applyTheme } from './ui.js';
import * as login from './pages/login.js';
import * as dashboard from './pages/dashboard.js';
import * as schedule from './pages/schedule.js';
import * as timeclock from './pages/timeclock.js';
import * as requests from './pages/requests.js';
import * as tasks from './pages/tasks.js';
import * as engage from './pages/engage.js';
import * as logbook from './pages/logbook.js';
import * as tips from './pages/tips.js';
import * as payroll from './pages/payroll.js';
import * as reports from './pages/reports.js';
import * as team from './pages/team.js';
import * as settings from './pages/settings.js';

const ICONS = {
  dashboard: '<path d="M3 13a9 9 0 1 1 18 0"/><path d="M12 13l4-4"/><path d="M5 19h14"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  timeclock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M10 2h4"/>',
  requests: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  tasks: '<path d="M4 12l5 5L20 6"/>',
  engage: '<path d="M4 5h16v11H8l-4 4z"/>',
  tips: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  payroll: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 9.5h.01M18 15.5h.01"/>',
  pay: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/>',
  reports: '<path d="M5 20V10M10 20V4M15 20v-7M20 20V8"/>',
  logbook: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  more: '<path d="M6 9l6 6 6-6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

const ROUTES = {
  dashboard: { label: 'Dashboard', page: dashboard },
  schedule: { label: 'Schedules', page: schedule },
  timeclock: { label: 'Time Clock', page: timeclock },
  requests: { label: 'Requests', page: requests },
  tasks: { label: 'Tasks', page: tasks },
  engage: { label: 'Engage', page: engage },
  tips: { label: 'Tips', page: tips },
  payroll: { label: 'Payroll', page: payroll, manager: true },
  pay: { label: 'My Pay', page: payroll, employee: true },
  reports: { label: 'Reports', page: reports, manager: true },
  logbook: { label: 'Log Book', page: logbook, manager: true, more: true },
  team: { label: 'Team', page: team, manager: true, more: true },
  settings: { label: 'Settings', page: settings, manager: true, more: true },
};

const app = document.getElementById('app');
let ctx = null;
let cleanup = null;

function buildCtx(data) {
  applyTheme(data.settings.theme);
  const userMap = new Map(data.users.map((u) => [u.id, u]));
  const posMap = new Map(data.positions.map((p) => [p.id, p]));
  return {
    ...data,
    isManager: data.me.role === 'manager',
    user: (id) => userMap.get(Number(id)),
    position: (id) => posMap.get(Number(id)),
    userName: (id) => userMap.get(Number(id))?.name || 'Unassigned',
    userColor: (id) => posMap.get(userMap.get(Number(id))?.position_id)?.color || '#6b5fb5',
    activeUsers: () => data.users.filter((u) => u.active),
    // Refetch shared data (team, positions, settings) and re-render the current page.
    reload: async () => { ctx = buildCtx(await api('/bootstrap')); await route(); },
    go: (path) => { location.hash = '#/' + path; },
  };
}

function allowed(key) {
  const r = ROUTES[key];
  if (!r) return false;
  if (r.manager && !ctx.isManager) return false;
  if (r.employee && ctx.isManager) return false;
  return true;
}

function renderShell() {
  const current = currentRoute();
  const visible = Object.keys(ROUTES).filter(allowed);
  const main = visible.filter((k) => !ROUTES[k].more);
  const more = visible.filter((k) => ROUTES[k].more);
  const moreActive = more.includes(current);
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/dashboard">
        <span class="brand-mark">SH</span>
        <span class="brand-logo" role="img" aria-label="${esc(ctx.settings.restaurant_name)}"></span>
        <span class="brand-text">${esc(ctx.settings.restaurant_name)}<small>ShiftHub</small></span>
      </a>
      <nav class="nav" aria-label="Main">
        ${main.map((k) => `<a href="#/${k}" class="${k === current ? 'active' : ''}">${icon(k)}<span class="lbl">${ROUTES[k].label}</span></a>`).join('')}
        ${more.length ? `<a href="#" data-more class="${moreActive ? 'active' : ''}">${icon('more')}<span class="lbl">${moreActive ? ROUTES[current].label : 'More'}</span></a>` : ''}
      </nav>
      <div class="user-menu">
        <button class="user-btn" data-user-menu aria-label="Account menu">${avatar(ctx.me.name, ctx.userColor(ctx.me.id))}</button>
      </div>
    </header>
    <main id="view"></main>`;

  const moreLink = app.querySelector('[data-more]');
  moreLink?.addEventListener('click', (e) => {
    e.preventDefault();
    openMenu(moreLink, more.map((k) => `<a href="#/${k}">${ROUTES[k].label}</a>`).join(''), true);
  });
  const userBtn = app.querySelector('[data-user-menu]');
  userBtn.addEventListener('click', () => {
    openMenu(userBtn, `
      <div class="menu-head"><strong>${esc(ctx.me.name)}</strong><div class="small muted">${esc(ctx.me.email)} · ${ctx.isManager ? 'Manager' : esc(ctx.position(ctx.me.position_id)?.name || 'Employee')}</div></div>
      ${ctx.isManager ? `<button data-act="theme">${ctx.settings.theme === 'classic' ? 'Switch to Bếp look' : 'Switch to classic look'}</button>` : ''}
      <button data-act="password">Change password</button>
      ${ctx.isManager ? '<a href="/kiosk.html">Tablet Time Clock</a>' : ''}
      <button data-act="logout">Sign out</button>`);
  });
}

function openMenu(anchor, html, fixedLeft = false) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = html;
  if (fixedLeft) {
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { position: 'fixed', left: `${Math.min(r.left, window.innerWidth - 236)}px`, top: `${r.bottom + 4}px`, right: 'auto' });
    document.body.append(menu);
  } else anchor.parentElement.append(menu);
  const off = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off); } };
  setTimeout(() => document.addEventListener('pointerdown', off));
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target.closest('a')) menu.remove();
    if (act === 'logout') { await api('/logout', { method: 'POST' }); ctx = null; menu.remove(); route(); }
    if (act === 'password') { menu.remove(); changePassword(); }
    if (act === 'theme') {
      menu.remove();
      const next = ctx.settings.theme === 'classic' ? 'bep' : 'classic';
      await api('/settings', { method: 'PUT', body: { theme: next } });
      await ctx.reload();
      toast(next === 'bep' ? 'Bếp look turned on for everyone' : 'Classic look turned on for everyone');
    }
  });
}

function changePassword() {
  modal({
    title: 'Change password',
    body: `
      <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" name="next" required minlength="8" autocomplete="new-password"><span class="hint">At least 8 characters</span></label>`,
    onSubmit: async (v) => { await api('/me/password', { method: 'POST', body: v }); toast('Password updated'); },
  });
}

const currentRoute = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');

async function route() {
  cleanup?.();
  cleanup = null;
  document.querySelectorAll('.menu, dialog.modal').forEach((m) => m.remove());
  if (!ctx) {
    try {
      ctx = buildCtx(await api('/bootstrap'));
    } catch {
      await api('/branding').then((b) => applyTheme(b.theme)).catch(() => {});
      login.render(app, async () => {
        ctx = buildCtx(await api('/bootstrap'));
        if (ctx.isManager && sessionStorage.getItem('tablet-setup') === '1') {
          sessionStorage.removeItem('tablet-setup');
          location.assign('/kiosk.html');
          return;
        }
        history.replaceState(null, '', '#/dashboard');
        await route();
      });
      return;
    }
  }
  applyTheme(ctx.settings.theme); // undo any unsaved preview from the Settings page
  let key = currentRoute();
  if (!allowed(key)) {
    key = key === 'pay' ? 'payroll' : key === 'payroll' ? 'pay' : 'dashboard';
    if (!allowed(key)) key = 'dashboard';
    history.replaceState(null, '', '#/' + key);
  }
  renderShell();
  document.title = `${ROUTES[key].label} · ShiftHub`;
  const view = document.getElementById('view');
  view.innerHTML = '<div class="page"><p class="muted">Loading…</p></div>';
  try {
    cleanup = (await ROUTES[key].page.render(view, ctx)) || null;
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page"><div class="alert">Could not load this page: ${esc(err.message)}</div></div>`;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:expired', () => {
  if (!ctx) return;
  ctx = null;
  toast('Your session ended. Please sign in again.', 'error');
  route();
});
route();
