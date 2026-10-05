// Shared helpers: API, formatting, dates, modals, toasts, charts.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (res.status === 401 && path !== '/login') {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  if (!res.ok) throw new Error((isJson && data.error) || 'Request failed');
  return data;
}

// ---- theme ----
export const THEMES = { bep: "Bếp", classic: "Classic" };
const CLASSIC_ICON = document.getElementById("favicon")?.getAttribute("href");
/** Switch between the restaurant (Bếp) look and the original ShiftHub look. */
export function applyTheme(theme) {
  const t = THEMES[theme] ? theme : "bep";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("shifthub-theme", t); } catch { /* storage unavailable */ }
  const icon = document.getElementById("favicon");
  if (icon) icon.setAttribute("href", t === "bep" ? "/img/bep-logo.png" : CLASSIC_ICON);
}

// ---- formatting ----
export const money = (n) =>
  (n < 0 ? '−$' : '$') + Math.abs(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = (n) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n || 0)).toLocaleString('en-US');
export const pct = (n, digits = 1) => (n === null || n === undefined || !isFinite(n) ? '–' : (n * 100).toFixed(digits) + '%');
export const hrs = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2);
export const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// ---- dates (local, 'YYYY-MM-DD'; weeks start Monday) ----
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => ymd(new Date());
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const weekday = (s) => (parseYmd(s).getDay() + 6) % 7;
export const weekStart = (s) => addDays(s, -weekday(s));
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const fmtDate = (s, opts = { month: 'short', day: 'numeric' }) => parseYmd(s).toLocaleDateString('en-US', opts);
export const fmtDateLong = (s) => fmtDate(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const fmtRange = (a, b) => `${fmtDate(a)} – ${fmtDate(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
export function fmtTime(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)}${suffix}` : `${h12}${suffix}`;
}
export const fmtClock = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '–');
export const hmOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function shiftHours(s) {
  const [h1, m1] = s.start.split(':').map(Number);
  const [h2, m2] = s.end.split(':').map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins <= 0) mins += 1440;
  return Math.max(0, (mins - (s.break_min || 0)) / 60);
}
export function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- forms ----
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) {
        out[el.name] ??= [];
        if (el.checked) out[el.name].push(el.value);
      } else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.value;
  }
  return out;
}

export const options = (items, selected, { blank } = {}) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  items.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`).join('');

// ---- toasts ----
export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

// ---- modal ----
/**
 * Opens a modal with a form. `onSubmit(values, form)` may return a promise; the modal
 * closes when it resolves and shows the error message when it rejects.
 * `extra` renders buttons on the left of the footer (e.g. Delete): [{label, className, onClick}]
 */
export function modal({ title, body, submitLabel = 'Save', onSubmit, extra = [], wide = false, onOpen, cancelLabel = 'Cancel' }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' modal-wide' : '');
  dlg.innerHTML = `
    <form method="dialog" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="modal-body">${body}</div>
      <p class="form-error" hidden></p>
      <footer>
        <div class="footer-left">${extra.map((b, i) => `<button type="button" class="btn ${b.className || ''}" data-extra="${i}">${esc(b.label)}</button>`).join('')}</div>
        <div class="footer-right">
          <button type="button" class="btn" data-close>${esc(cancelLabel)}</button>
          ${onSubmit ? `<button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>` : ''}
        </div>
      </footer>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const errEl = dlg.querySelector('.form-error');
  const close = () => { dlg.close(); dlg.remove(); };
  const showError = (e) => { errEl.textContent = e.message || String(e); errEl.hidden = false; };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  extra.forEach((b, i) => dlg.querySelector(`[data-extra="${i}"]`).addEventListener('click', async () => {
    try { errEl.hidden = true; if ((await b.onClick(close, form)) !== false) close(); } catch (e) { showError(e); }
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    errEl.hidden = true;
    try {
      if ((await onSubmit(formValues(form), form)) !== false) close();
    } catch (err) { showError(err); } finally { btn.disabled = false; }
  });
  dlg.showModal();
  onOpen?.(form, dlg);
  return { close, form, dlg };
}

export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title: 'Please confirm',
      body: `<p>${esc(message)}</p>`,
      submitLabel: confirmLabel,
      onSubmit: () => { answered = true; resolve(true); },
    });
    if (danger) m.form.querySelector('[type=submit]').classList.add('btn-danger');
    m.dlg.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

// ---- tooltip (any element with data-tip) ----
const tipEl = () => document.getElementById('tooltip');
document.addEventListener('pointerover', (e) => {
  const t = e.target.closest('[data-tip]');
  const el = tipEl();
  if (!t) { el.classList.remove('show'); return; }
  el.innerHTML = t.dataset.tip;
  el.classList.add('show');
});
document.addEventListener('pointermove', (e) => {
  const el = tipEl();
  if (!el.classList.contains('show')) return;
  const pad = 14;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = e.clientX + pad;
  let y = e.clientY - h - pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y < 8) y = e.clientY + pad;
  el.style.transform = `translate(${x}px, ${y}px)`;
});
document.addEventListener('pointerleave', () => tipEl().classList.remove('show'), true);

// ---- charts (SVG) ----
/**
 * Vertical bar chart, one series. data: [{label, value, tip, muted, marker}]
 * `marker` draws a thin horizontal tick on the bar (e.g. projected value).
 * `refLine` draws a thin labelled reference line (e.g. a target).
 */
export function barChart(data, { height = 180, format = money0, colorVar = '--series-1', refLine = null, markerLabel = null } = {}) {
  const W = 640;
  const H = height;
  const m = { t: 12, r: 8, b: 26, l: 48 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const values = data.flatMap((d) => [d.value || 0, d.marker || 0]).concat(refLine ? [refLine.value] : []);
  const max = niceMax(Math.max(1, ...values));
  const step = iw / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(36, step - 2)); // keeps a ≥2px gap between bars
  const y = (v) => m.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(format(t))}</text>`;
  }
  data.forEach((d, i) => {
    const cx = m.l + step * i + step / 2;
    const v = d.value || 0;
    const top = y(v);
    const h = Math.max(0, m.t + ih - top);
    if (h > 0) {
      const r = Math.min(4, bw / 2, h);
      svg += `<path class="bar${d.muted ? ' muted' : ''}" style="fill:var(${colorVar})" d="M${cx - bw / 2},${m.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${m.t + ih} Z"/>`;
    }
    if (d.marker) svg += `<line class="marker" x1="${cx - bw / 2 - 3}" x2="${cx + bw / 2 + 3}" y1="${y(d.marker)}" y2="${y(d.marker)}"/>`;
    if (data.length <= 16 || i % Math.ceil(data.length / 12) === 0) {
      svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
    }
    svg += `<rect class="hit" x="${cx - step / 2}" y="${m.t}" width="${step}" height="${ih}" data-tip="${esc(d.tip ?? `${d.label}: ${format(v)}`)}"/>`;
  });
  if (refLine) {
    svg += `<line class="refline" x1="${m.l}" x2="${W - m.r}" y1="${y(refLine.value)}" y2="${y(refLine.value)}"/>`;
    svg += `<text class="axis ref-label" x="${W - m.r}" y="${y(refLine.value) - 5}" text-anchor="end">${esc(refLine.label)}</text>`;
  }
  svg += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/></svg>`;
  const legend = markerLabel
    ? `<div class="legend"><span><i class="sw" style="background:var(${colorVar})"></i>Actual</span><span><i class="sw sw-line"></i>${esc(markerLabel)}</span></div>`
    : '';
  return legend + svg;
}

function niceMax(v) {
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const s of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * mag >= v) return s * mag;
  return 10 * mag;
}

export const avatar = (name, color = '#6b5fb5', size = '') =>
  `<span class="avatar ${size}" style="--av:${esc(color)}">${esc(initials(name))}</span>`;

export function emptyState(title, text = '') {
  return `<div class="empty"><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
}

export function downloadCsv(filename, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
