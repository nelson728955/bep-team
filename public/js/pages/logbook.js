import { api, esc, fmtDateLong, addDays, today, money0, pct, hrs, timeAgo, options, toast, emptyState, confirmDialog } from '../ui.js';

const CATS = {
  general: ['General', 'pill-muted'],
  maintenance: ['Maintenance', 'pill-warn'],
  86: ["86'd item", 'pill-bad'],
  incident: ['Incident', 'pill-bad'],
  staff: ['Staff', 'pill-info'],
  guest: ['Guest feedback', 'pill-good'],
};

const state = { date: today() };

export async function render(root, ctx) {
  const weekAgo = addDays(state.date, -6);
  const [entries, rep] = await Promise.all([
    api(`/logbook?start=${weekAgo}&end=${state.date}`),
    api(`/reports?start=${state.date}&end=${state.date}`),
  ]);
  const day = entries.filter((e) => e.date === state.date);
  const earlier = entries.filter((e) => e.date !== state.date);
  const d = rep.days[0];

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Log Book</h1><div class="sub">Shift notes for managers: what happened, what broke, what ran out.</div></div>
      <div class="toolbar">
        <button class="btn" data-day="-1" aria-label="Previous day">‹</button>
        <input type="date" value="${state.date}" data-date style="width:auto">
        <button class="btn" data-day="1" aria-label="Next day">›</button>
        ${state.date !== today() ? '<button class="btn" data-day="today">Today</button>' : ''}
      </div>
    </div>
    <div class="grid grid-main">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>${fmtDateLong(state.date)}</h2></div>
          <form class="card-body" data-new style="border-bottom:1px solid var(--border)">
            <textarea name="body" required maxlength="4000" rows="3" placeholder="What should the next manager know?"></textarea>
            <div class="toolbar" style="margin-top:8px"><select name="category" style="width:auto">${options(Object.entries(CATS).map(([k, [l]]) => [k, l]), 'general')}</select><span class="spacer"></span><button class="btn btn-primary">Add entry</button></div>
          </form>
          ${day.length ? day.map(entryHtml(ctx)).join('') : emptyState('No entries for this day')}
        </div>
        ${earlier.length ? `<div class="card"><div class="card-head"><h2>Earlier this week</h2></div>${earlier.map(entryHtml(ctx, true)).join('')}</div>` : ''}
      </div>
      <div class="card">
        <div class="card-head"><h2>Day at a glance</h2></div>
        <ul class="list">
          <li><span style="flex:1">Sales</span><strong class="num">${d.sales !== null ? money0(d.sales) : '–'}</strong></li>
          <li><span style="flex:1">Projected</span><span class="num">${d.projected ? money0(d.projected) : '–'}</span></li>
          <li><span style="flex:1">Covers</span><span class="num">${d.covers ?? '–'}</span></li>
          <li><span style="flex:1">Labor</span><span class="num">${money0(d.labor_cost)} · ${hrs(d.labor_hours)} hrs</span></li>
          <li><span style="flex:1">Labor %</span><span class="num">${d.sales ? pct(d.labor_cost / d.sales) : '–'}</span></li>
          <li><span style="flex:1">Tips pooled</span><span class="num">${money0(d.tips)}</span></li>
        </ul>
      </div>
    </div>
  </div>`;

  const rerender = () => render(root, ctx);
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.day === 'today' ? today() : addDays(state.date, Number(b.dataset.day));
    rerender();
  }));
  root.querySelector('[data-date]').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; rerender(); } });
  const form = root.querySelector('[data-new]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/logbook', { method: 'POST', body: { date: state.date, category: form.category.value, body: form.body.value } });
    toast('Entry added');
    rerender();
  });
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this log entry?', { confirmLabel: 'Delete', danger: true }))) return;
    await api('/logbook/' + b.dataset.del, { method: 'DELETE' });
    rerender();
  }));
}

const entryHtml = (ctx, showDate = false) => (e) => {
  const [label, cls] = CATS[e.category] || CATS.general;
  return `<div class="announcement">
    <div class="toolbar"><span class="pill ${cls}">${label}</span>${showDate ? `<span class="small muted">${fmtDateLong(e.date)}</span>` : ''}</div>
    <div class="body" style="color:var(--text)">${esc(e.body)}</div>
    <div class="meta">${esc(ctx.userName(e.author_id))} · ${timeAgo(e.created_at)}<button class="btn btn-sm btn-ghost" data-del="${e.id}">Delete</button></div>
  </div>`;
};
