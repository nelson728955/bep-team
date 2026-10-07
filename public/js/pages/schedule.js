import {
  api, esc, money0, pct, hrs, fmtTime, fmtDate, fmtRange, fmtDateLong, addDays, today, weekStart, weekday,
  WEEKDAYS, shiftHours, modal, options, toast, confirmDialog, avatar,
} from '../ui.js';

const TEMPLATES = [
  ['Lunch', '10:30', '15:00', 0],
  ['Dinner', '16:00', '22:00', 0],
  ['Double', '11:00', '19:00', 0],
  ['BOH AM', '08:00', '15:00', 0],
  ['BOH PM', '14:30', '22:30', 0],
];

const state = { start: weekStart(today()), dept: 'ALL', mineOnly: false };

export async function render(root, ctx) {
  const data = await api('/schedule?start=' + state.start);
  const days = [...Array(7)].map((_, i) => addDays(data.start, i));
  const t = today();
  const M = ctx.isManager;
  const target = Number(ctx.settings.labor_target_pct) / 100;
  const otLimit = Number(ctx.settings.ot_threshold) || 40;

  const deptOf = (u) => ctx.position(u.position_id)?.department || 'Other';
  const people = ctx.activeUsers()
    .filter((u) => u.role === 'employee' || data.shifts.some((s) => s.user_id === u.id))
    .filter((u) => state.dept === 'ALL' || deptOf(u) === state.dept)
    .filter((u) => !state.mineOnly || u.id === ctx.me.id);
  const groups = [['FOH', 'Front of House'], ['BOH', 'Back of House'], ['Other', 'Other']]
    .map(([k, label]) => ({ k, label, users: people.filter((u) => deptOf(u) === k) }))
    .filter((g) => g.users.length);

  const shiftDept = (s) => ctx.position(s.position_id)?.department || (s.user_id ? deptOf(ctx.user(s.user_id) || {}) : 'Other');
  const visibleShifts = data.shifts.filter((s) => state.dept === 'ALL' || shiftDept(s) === state.dept);
  const shiftsFor = (uid, date) => visibleShifts.filter((s) => s.user_id === uid && s.date === date);
  const offFor = (uid, date) => data.timeOff.find((o) => o.user_id === uid && o.start_date <= date && o.end_date >= date);
  const availFor = (uid, date) => data.availability.find((a) => a.user_id === uid && a.weekday === weekday(date));
  const reqFor = (shiftId) => data.requests.find((r) => r.shift_id === shiftId);
  const rate = (uid) => ctx.user(uid)?.hourly_rate || 0;
  const sales = new Map((data.sales || []).map((s) => [s.date, s]));

  const chip = (s) => {
    const cutoff = ctx.settings.tip_split_time || '16:00';
    const overnight = s.end <= s.start;
    const placement = s.start >= cutoff ? 'shift-pm' : !overnight && s.end <= cutoff ? 'shift-am' : 'shift-full';
    const p = ctx.position(s.position_id);
    const req = reqFor(s.id);
    const mine = s.user_id === ctx.me.id;
    let flag = '';
    if (req?.type === 'drop' && req.status === 'open') flag = 'Up for grabs';
    else if (req?.status === 'claimed') flag = `${M ? esc(ctx.userName(req.claimer_id)) + ' wants it' : 'Swap pending approval'}`;
    const tip = `<strong>${fmtTime(s.start)}–${fmtTime(s.end)}</strong> · ${esc(p?.name || 'No position')}<br>${hrs(shiftHours(s))} hrs${s.break_min ? `, ${s.break_min}m break` : ''}${s.notes ? `<br>${esc(s.notes)}` : ''}${!s.published ? '<br><em>Draft, not published</em>' : ''}`;
    return `<button class="chip ${placement} ${s.published ? '' : 'draft'} ${mine && !M ? 'mine' : ''}" ${M ? 'draggable="true"' : ''} style="--c:${esc(p?.color || '#888')}" data-shift="${s.id}" data-tip="${esc(tip)}">
      <div class="t">${fmtTime(s.start)} – ${fmtTime(s.end)}</div>
      <div class="p">${esc(p?.name || '')}</div>
      ${flag ? `<div class="flag">${flag}</div>` : ''}</button>`;
  };

  const cell = (uid, date) => {
    const off = uid && offFor(uid, date);
    const av = uid && availFor(uid, date);
    const unavail = av?.status === 'unavailable';
    return `<td class="${M ? 'can-add' : ''} ${unavail ? 'unavail' : ''}" data-cell data-user="${uid ?? ''}" data-date="${date}">
      <div class="cell">
        ${off ? `<span class="tag-off">Time off</span>` : ''}
        ${unavail ? '<span class="tag-avail">Unavailable</span>' : ''}
        ${av?.status === 'partial' ? `<span class="tag-avail">Avail ${fmtTime(av.start)}–${fmtTime(av.end)}</span>` : ''}
        ${(uid ? shiftsFor(uid, date) : visibleShifts.filter((s) => !s.user_id && s.date === date)).map(chip).join('')}
      </div></td>`;
  };

  const userRow = (u) => {
    const mine = visibleShifts.filter((s) => s.user_id === u.id);
    const h = mine.reduce((a, s) => a + shiftHours(s), 0);
    return `<tr><td class="emp"><div class="person">${avatar(u.name, ctx.userColor(u.id), 'sm')}<div class="meta">
        <div class="name">${esc(u.name)}</div>
        <div class="hours ${h > otLimit ? 'ot' : ''}">${hrs(h)} hrs${M ? ` · ${money0(h * rate(u.id))}` : ''}${h > otLimit ? ' · overtime' : ''}</div></div></div></td>
      ${days.map((d) => cell(u.id, d)).join('')}</tr>`;
  };

  const groupRow = (g) => {
    const ids = new Set(g.users.map((u) => u.id));
    const gs = visibleShifts.filter((s) => ids.has(s.user_id));
    const h = gs.reduce((a, s) => a + shiftHours(s), 0);
    const c = gs.reduce((a, s) => a + shiftHours(s) * rate(s.user_id), 0);
    return `<tr class="group"><td colspan="8">${esc(g.label)} <span class="muted">· ${hrs(h)} hrs${M ? ` · ${money0(c)}` : ''}</span></td></tr>`;
  };

  const headCount = (d) => new Set(visibleShifts.filter((s) => s.date === d && s.user_id).map((s) => s.user_id)).size;

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div class="toolbar">
        <button class="btn" data-nav="-7" aria-label="Previous week">‹</button>
        <strong class="btn" style="cursor:default">${fmtRange(days[0], days[6])}</strong>
        <button class="btn" data-nav="7" aria-label="Next week">›</button>
        <button class="btn btn-primary" data-nav="today">Today</button>
        ${M ? `<span class="${data.unpublished ? 'pill pill-warn' : 'pill pill-good'}">${data.unpublished ? `${data.unpublished} unpublished` : 'Published'}</span>` : ''}
      </div>
      <div class="toolbar">
        <select data-dept style="width:auto">${options([['ALL', 'All departments'], ['FOH', 'Front of House'], ['BOH', 'Back of House']], state.dept)}</select>
        ${M ? `
          <button class="btn btn-danger" data-clear ${data.shifts.length ? '' : 'disabled'}>Clear schedule</button>
          <button class="btn" data-copy>Copy last week</button>
          <button class="btn btn-teal" data-publish ${data.unpublished ? '' : 'disabled'}>Publish schedule</button>`
        : `<div class="seg"><button class="${state.mineOnly ? '' : 'on'}" data-mine="0">Everyone</button><button class="${state.mineOnly ? 'on' : ''}" data-mine="1">Just me</button></div>`}
      </div>
    </div>

    <div class="sched-wrap">
      <table class="sched">
        <colgroup><col class="first">${days.map(() => '<col>').join('')}</colgroup>
        <thead><tr>
          <th class="first">${M ? '<a class="btn btn-sm" href="#/team">+ Add employees</a>' : '<span class="muted small">Tap your shift to swap or give it away</span>'}</th>
          ${days.map((d) => `<th class="${d === t ? 'is-today' : ''}"><div class="dayhead"><div class="dayname">${WEEKDAYS[weekday(d)]}</div><div class="daydate">${fmtDate(d)}</div></div>
            <div class="dayinfo"><span>${M && sales.get(d)?.projected ? money0(sales.get(d).projected) : ''}</span><span title="People scheduled">👤 ${headCount(d)}</span></div></th>`).join('')}
        </tr></thead>
        <tbody>
          <tr class="open-row"><td class="emp"><strong>Open shifts</strong><div class="hours">Anyone can request</div></td>${days.map((d) => cell(null, d)).join('')}</tr>
          ${groups.map((g) => groupRow(g) + g.users.map(userRow).join('')).join('')}
          ${!groups.length ? '<tr><td colspan="8"><div class="empty">No employees match this filter.</div></td></tr>' : ''}
        </tbody>
      </table>
    </div>
    ${M ? budgetTool(ctx, data, days, visibleShifts, sales, target) : ''}
  </div>`;

  // ---- events ----
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    state.start = b.dataset.nav === 'today' ? weekStart(today()) : addDays(state.start, Number(b.dataset.nav));
    render(root, ctx);
  }));
  root.querySelector('[data-dept]').addEventListener('change', (e) => { state.dept = e.target.value; render(root, ctx); });
  root.querySelectorAll('[data-mine]').forEach((b) => b.addEventListener('click', () => { state.mineOnly = b.dataset.mine === '1'; render(root, ctx); }));

  root.querySelector('.sched').addEventListener('click', (e) => {
    const chipEl = e.target.closest('[data-shift]');
    if (chipEl) {
      const s = data.shifts.find((x) => x.id === Number(chipEl.dataset.shift));
      if (M) shiftModal(ctx, data, s, () => render(root, ctx));
      else employeeShiftModal(ctx, s, reqFor(s.id), () => render(root, ctx));
      return;
    }
    const c = e.target.closest('[data-cell]');
    if (c && M) shiftModal(ctx, data, { user_id: c.dataset.user ? Number(c.dataset.user) : null, date: c.dataset.date }, () => render(root, ctx));
  });

  if (M) {
    let draggedShift = null;
    let copying = false;
    let ignoreClickUntil = 0;
    const cells = [...root.querySelectorAll('[data-cell]')];
    const clearHighlights = () => cells.forEach(cell => cell.style.removeProperty('box-shadow'));
    const canCopyTo = (cell) => draggedShift && cell &&
      cell.dataset.user === String(draggedShift.user_id ?? '') && cell.dataset.date !== draggedShift.date;
    root.querySelector('.sched').addEventListener('click', e => {
      if (Date.now() < ignoreClickUntil) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
    root.querySelectorAll('[data-shift]').forEach(chip => {
      chip.addEventListener('dragstart', e => {
        if (copying) { e.preventDefault(); return; }
        draggedShift = data.shifts.find(s => s.id === Number(chip.dataset.shift));
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', String(draggedShift.id));
        cells.filter(canCopyTo).forEach(cell => cell.style.boxShadow = 'inset 0 0 0 2px var(--accent, #ffb52b)');
      });
      chip.addEventListener('dragend', () => {
        draggedShift = null;
        ignoreClickUntil = Date.now() + 250;
        clearHighlights();
      });
    });
    cells.forEach(cell => {
      cell.addEventListener('dragover', e => {
        if (!copying && canCopyTo(cell)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      });
      cell.addEventListener('drop', async e => {
        if (copying || !canCopyTo(cell)) return;
        e.preventDefault();
        const source = draggedShift;
        draggedShift = null;
        copying = true;
        clearHighlights();
        try {
          await api('/shifts', { method: 'POST', body: {
            user_id: source.user_id, position_id: source.position_id, date: cell.dataset.date,
            start: source.start, end: source.end, break_min: source.break_min, notes: source.notes,
          } });
          toast('Shift copied as a draft');
          await render(root, ctx);
        } catch (error) { toast(error.message, 'error'); }
        finally { copying = false; }
      });
    });
    root.querySelector('[data-clear]').addEventListener('click', async () => {
      if (!(await confirmDialog(`Clear all ${data.shifts.length} shifts for ${fmtRange(days[0], days[6])}? This removes draft, published, and open shifts across ALL departments for this week. This cannot be undone. Time Clock entries (including scheduled estimates), tips, and payroll records will remain; review those separately if needed.`, { confirmLabel: 'Clear this week', danger: true }))) return;
      const button = root.querySelector('[data-clear]');
      button.disabled = true;
      try {
        const result = await api('/schedule/clear', { method: 'POST', body: { start: data.start, confirm: true } });
        toast(`Cleared ${result.cleared} shifts`);
        await render(root, ctx);
      } catch (error) { toast(error.message, 'error'); button.disabled = false; }
    });
    root.querySelector('[data-publish]').addEventListener('click', async () => {
      if (!(await confirmDialog(`Publish ${data.unpublished} shift(s) for ${fmtRange(days[0], days[6])}? Employees will be able to see them.`, { confirmLabel: 'Publish' }))) return;
      const r = await api('/schedule/publish', { method: 'POST', body: { start: data.start } });
      toast(`Published ${r.published} shift(s)`);
      render(root, ctx);
    });
    root.querySelector('[data-copy]').addEventListener('click', () => {
      modal({
        title: 'Copy last week',
        body: `<p>Copy every shift from ${fmtRange(addDays(days[0], -7), addDays(days[6], -7))} into this week as drafts.</p>
          <label class="check"><input type="checkbox" name="replace"> Replace this week's existing shifts</label>`,
        submitLabel: 'Copy shifts',
        onSubmit: async (v) => {
          const r = await api('/schedule/copy', { method: 'POST', body: { start: data.start, replace: v.replace } });
          toast(`Copied ${r.copied} shift(s) as drafts`);
          render(root, ctx);
        },
      });
    });
    root.querySelectorAll('[data-sale]').forEach((inp) => inp.addEventListener('change', async () => {
      try {
        await api('/sales/' + inp.dataset.date, { method: 'PUT', body: { [inp.dataset.sale]: inp.value } });
        render(root, ctx);
      } catch (err) { toast(err.message, 'error'); }
    }));
  }
}

function budgetTool(ctx, data, days, shifts, sales, target) {
  const rate = (uid) => ctx.user(uid)?.hourly_rate || 0;
  const dept = state.dept;
  const col = days.map((d) => {
    const ds = shifts.filter((s) => s.date === d && s.user_id);
    const h = ds.reduce((a, s) => a + shiftHours(s), 0);
    const cost = ds.reduce((a, s) => a + shiftHours(s) * rate(s.user_id), 0);
    const act = data.actual[d];
    const actualCost = act ? (dept === 'ALL' ? act.cost : act[dept] || 0) : 0;
    const s = sales.get(d) || {};
    return { d, h, cost, actualCost, projected: s.projected, actual: s.actual };
  });
  const sum = (k) => col.reduce((a, c) => a + (c[k] || 0), 0);
  const cls = (p) => (p === null || !isFinite(p) ? '' : p > target ? 'over' : 'under');
  const ratio = (a, b) => (b ? a / b : null);
  const t = today();
  const salesIn = (c, k) => (k === 'actual' && c.d > t
    ? '<span class="muted">–</span>'
    : `<input class="inline-input" type="number" min="0" step="1" data-sale="${k}" data-date="${c.d}" value="${c[k] ?? ''}" placeholder="$" aria-label="${k} sales ${c.d}">`);
  const totalActualSales = sum('actual');
  const actualCostOnSalesDays = col.filter((c) => c.actual).reduce((a, c) => a + c.actualCost, 0);

  return `
  <div class="budget card">
    <div class="budget-tabs"><span>Budget tool</span></div>
    <div class="table-wrap">
      <table class="sched">
        <colgroup><col class="first">${days.map(() => '<col>').join('')}<col></colgroup>
        <thead><tr><th class="first">${dept === 'ALL' ? 'All departments' : dept === 'FOH' ? 'Front of House' : 'Back of House'}</th>${days.map((d) => `<th><span class="small">${WEEKDAYS[weekday(d)]} ${fmtDate(d, { day: 'numeric' })}</span></th>`).join('')}<th><span class="small">Week</span></th></tr></thead>
        <tbody>
          <tr><td class="label">Projected sales</td>${col.map((c) => `<td>${salesIn(c, 'projected')}</td>`).join('')}<td class="v"><strong>${money0(sum('projected'))}</strong></td></tr>
          <tr><td class="label">Actual sales</td>${col.map((c) => `<td>${salesIn(c, 'actual')}</td>`).join('')}<td class="v"><strong>${money0(totalActualSales)}</strong></td></tr>
          <tr><td class="label">Scheduled hours</td>${col.map((c) => `<td class="v">${hrs(c.h)}</td>`).join('')}<td class="v"><strong>${hrs(sum('h'))}</strong></td></tr>
          <tr><td class="label">Scheduled labor</td>${col.map((c) => `<td class="v">${money0(c.cost)}</td>`).join('')}<td class="v"><strong>${money0(sum('cost'))}</strong></td></tr>
          <tr><td class="label">Scheduled labor % <span class="muted small">(target ${pct(target, 0)})</span></td>${col.map((c) => { const p = ratio(c.cost, c.projected); return `<td class="v ${cls(p)}">${pct(p)}</td>`; }).join('')}<td class="v ${cls(ratio(sum('cost'), sum('projected')))}"><strong>${pct(ratio(sum('cost'), sum('projected')))}</strong></td></tr>
          <tr><td class="label">Actual labor</td>${col.map((c) => `<td class="v">${c.d > t ? '–' : money0(c.actualCost)}</td>`).join('')}<td class="v"><strong>${money0(sum('actualCost'))}</strong></td></tr>
          <tr><td class="label">Actual labor %</td>${col.map((c) => { const p = ratio(c.actualCost, c.actual); return `<td class="v ${cls(p)}">${c.actual ? pct(p) : '–'}</td>`; }).join('')}<td class="v ${cls(ratio(actualCostOnSalesDays, totalActualSales))}"><strong>${totalActualSales ? pct(ratio(actualCostOnSalesDays, totalActualSales)) : '–'}</strong></td></tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

function savedTemplates(ctx) {
  try { return JSON.parse(ctx.settings.shift_templates || 'null') || TEMPLATES; } catch { return TEMPLATES; }
}
function templateButtons(ctx) {
  return savedTemplates(ctx).map(([n,s,e,b]) => `<button type="button" class="btn btn-sm" data-tpl="${esc(s)}|${esc(e)}|${b}">${esc(n)} ${fmtTime(s)}–${fmtTime(e)}</button>`).join('');
}
function editTemplates(ctx, saved) {
  let nextId = 0;
  const row = ([name,start,end,br]) => {
    const id = nextId++;
    return `<div data-preset-row style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px">
      <div class="row">
        <label class="field"><span>Name</span><input type="text" data-name name="name_${id}" value="${esc(name)}" maxlength="40" required></label>
        <label class="field"><span>Start</span><input type="time" data-start name="start_${id}" value="${esc(start)}" required></label>
        <label class="field"><span>End</span><input type="time" data-end name="end_${id}" value="${esc(end)}" required></label>
        <label class="field"><span>Unpaid break (min)</span><input type="number" data-break name="break_${id}" value="${br}" min="0" max="240" step="1" required></label>
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-remove-preset aria-label="Remove preset">Remove preset</button>
    </div>`;
  };
  const m = modal({
    title: 'Edit shift presets',
    body: '<p class="small muted">Saved for all managers. Existing shifts stay unchanged.</p><div data-preset-list>' + savedTemplates(ctx).map(row).join('') + '</div><button type="button" class="btn" data-add-preset>+ Add preset</button><p class="small muted">Up to 20 presets. Changes apply when you save.</p>',
    submitLabel: 'Save presets',
    onSubmit: async (_,form) => {
      const updated = [...form.querySelectorAll('[data-preset-row]')].map(r => [r.querySelector('[data-name]').value.trim(),r.querySelector('[data-start]').value,r.querySelector('[data-end]').value,Number(r.querySelector('[data-break]').value)]);
      if (updated.some(t => !t[0])) throw new Error('Enter a name for each preset.');
      const settings = await api('/settings', { method: 'PUT', body: { shift_templates: JSON.stringify(updated) } });
      if (settings.shift_templates !== JSON.stringify(updated)) {
        throw new Error('The running server has not saved these presets. Restart the app (Ctrl+C, then npm start), refresh the page, and try again.');
      }
      ctx.settings.shift_templates = settings.shift_templates;
      saved(); toast('Shift presets saved');
    },
  });
  const list = m.form.querySelector('[data-preset-list]');
  const add = m.form.querySelector('[data-add-preset]');
  const updateLimit = () => { add.disabled = list.children.length >= 20; };
  add.addEventListener('click', () => {
    if (list.children.length >= 20) return;
    list.insertAdjacentHTML('beforeend', row(['','16:00','22:00',0]));
    list.lastElementChild.querySelector('[data-name]').focus(); updateLimit();
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-preset]');
    if (button) { button.closest('[data-preset-row]').remove(); updateLimit(); }
  });
  updateLimit();
}
function shiftModal(ctx, data, shift, done) {
  const isNew = !shift.id;
  const u = shift.user_id ? ctx.user(shift.user_id) : null;
  const defPos = shift.position_id ?? u?.position_id ?? '';
  const employees = ctx.activeUsers().map((x) => [x.id, x.name + (ctx.position(x.position_id) ? ` (${ctx.position(x.position_id).name})` : '')]);
  const m = modal({
    title: isNew ? `Add shift · ${fmtDateLong(shift.date)}` : 'Edit shift',
    body: `
      <div data-presets style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${templateButtons(ctx)}<button type="button" class="btn btn-sm btn-ghost" data-edit-presets>Edit presets</button></div>
      <div class="row">
        <label class="field"><span>Employee</span><select name="user_id">${options(employees, shift.user_id, { blank: 'Open shift (unassigned)' })}</select></label>
        <label class="field"><span>Position</span><select name="position_id">${options(ctx.positions.map((p) => [p.id, `${p.name} · ${p.department}`]), defPos, { blank: 'None' })}</select></label>
      </div>
      <div class="row">
        <label class="field"><span>Date</span><input type="date" name="date" value="${shift.date}" required></label>
        <label class="field"><span>Start</span><input type="time" name="start" value="${shift.start || '16:00'}" required></label>
        <label class="field"><span>End</span><input type="time" name="end" value="${shift.end || '22:00'}" required></label>
        <label class="field"><span>Unpaid break (min)</span><input type="number" name="break_min" min="0" max="240" value="${shift.break_min ?? 0}"></label>
      </div>
      <label class="field"><span>Notes</span><input type="text" name="notes" maxlength="500" value="${esc(shift.notes || '')}" placeholder="Optional, visible to the employee"></label>
      <div data-warn></div>
      <p class="small muted" data-summary></p>`,
    submitLabel: isNew ? 'Add shift' : 'Save changes',
    extra: isNew ? [] : [{
      label: 'Delete', className: 'btn-danger', onClick: async () => {
        await api('/shifts/' + shift.id, { method: 'DELETE' });
        toast('Shift deleted');
        done();
      },
    }],
    onSubmit: async (v) => {
      await api(isNew ? '/shifts' : '/shifts/' + shift.id, { method: isNew ? 'POST' : 'PUT', body: v });
      toast(isNew ? 'Shift added as a draft' : 'Shift updated (republish to notify staff)');
      done();
    },
  });
  const f = m.form;
  const refresh = () => {
    let matchedPreset = false;
    f.querySelectorAll('[data-tpl]').forEach(button => {
      const [start, end, br] = button.dataset.tpl.split('|');
      const selected = !matchedPreset && f.start.value === start && f.end.value === end && Number(f.break_min.value) === Number(br);
      button.classList.toggle('preset-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (selected) matchedPreset = true;
    });
    const uid = Number(f.user_id.value) || null;
    const date = f.date.value;
    const warn = [];
    if (uid && date) {
      const off = data.timeOff.find((o) => o.user_id === uid && o.start_date <= date && o.end_date >= date);
      if (off) warn.push(`${ctx.userName(uid)} has approved time off on this day.`);
      const av = data.availability.find((a) => a.user_id === uid && a.weekday === weekday(date));
      if (av?.status === 'unavailable') warn.push(`${ctx.userName(uid)} is marked unavailable on ${WEEKDAYS[weekday(date)]}s.`);
      if (av?.status === 'partial' && (f.start.value < av.start || f.end.value > av.end)) warn.push(`${ctx.userName(uid)} is only available ${fmtTime(av.start)}–${fmtTime(av.end)} on ${WEEKDAYS[weekday(date)]}s.`);
      const overlap = data.shifts.find((s) => s.id !== shift.id && s.user_id === uid && s.date === date && s.start < f.end.value && f.start.value < s.end);
      if (overlap) warn.push(`Overlaps another shift (${fmtTime(overlap.start)}–${fmtTime(overlap.end)}).`);
      const weekHrs = data.shifts.filter((s) => s.id !== shift.id && s.user_id === uid).reduce((a, s) => a + shiftHours(s), 0);
      const thisHrs = f.start.value && f.end.value ? shiftHours({ start: f.start.value, end: f.end.value, break_min: Number(f.break_min.value) }) : 0;
      if (weekHrs + thisHrs > (Number(ctx.settings.ot_threshold) || 40)) warn.push(`This puts ${ctx.userName(uid)} at ${hrs(weekHrs + thisHrs)} hrs this week (overtime).`);
    }
    f.querySelector('[data-warn]').innerHTML = warn.map((w) => `<div class="alert">${esc(w)}</div>`).join('');
    if (f.start.value && f.end.value) {
      const h = shiftHours({ start: f.start.value, end: f.end.value, break_min: Number(f.break_min.value) });
      const r = uid ? ctx.user(uid)?.hourly_rate || 0 : 0;
      f.querySelector('[data-summary]').textContent = `${hrs(h)} paid hours${uid ? ` · est. ${money0(h * r)} labor` : ''}`;
    }
  };
  f.addEventListener('input', refresh);
  f.user_id.addEventListener('change', () => {
    const nu = ctx.user(f.user_id.value);
    if (nu?.position_id) f.position_id.value = nu.position_id;
  });
  f.querySelector('[data-presets]').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-edit-presets')) {
      editTemplates(ctx, () => { f.querySelector('[data-presets]').innerHTML = templateButtons(ctx) + '<button type="button" class="btn btn-sm btn-ghost" data-edit-presets>Edit presets</button>'; });
    } else if (button.dataset.tpl) {
      const [start,end,br] = button.dataset.tpl.split('|');
      f.start.value = start; f.end.value = end; f.break_min.value = br; refresh();
    }
  });
  refresh();
}

function employeeShiftModal(ctx, s, req, done) {
  const p = ctx.position(s.position_id);
  const past = s.date < today();
  const head = `<p><strong>${fmtDateLong(s.date)}</strong><br>${fmtTime(s.start)}–${fmtTime(s.end)} · ${esc(p?.name || '')} · ${hrs(shiftHours(s))} hrs${s.notes ? `<br><span class="muted">${esc(s.notes)}</span>` : ''}</p>`;

  if (!s.user_id) {
    return modal({
      title: 'Open shift',
      body: head + (req ? '<div class="alert alert-info">Someone has already requested this shift.</div>' : past ? '' : '<p>Request this shift and your manager will confirm.</p>'),
      submitLabel: 'Request shift',
      onSubmit: req || past ? null : async () => {
        await api('/shift-requests', { method: 'POST', body: { shift_id: s.id } });
        toast('Pickup requested. Waiting for manager approval.');
        done();
      },
    });
  }
  if (s.user_id !== ctx.me.id) {
    const canClaim = req?.type === 'drop' && req.status === 'open' && (!req.target_id || req.target_id === ctx.me.id);
    return modal({
      title: `${ctx.userName(s.user_id)}'s shift`,
      body: head + (canClaim ? `<div class="alert alert-info">${esc(ctx.userName(s.user_id))} is offering this shift.${req.note ? ` “${esc(req.note)}”` : ''}</div>` : ''),
      submitLabel: 'Pick up shift',
      onSubmit: canClaim ? async () => {
        await api(`/shift-requests/${req.id}/claim`, { method: 'POST' });
        toast('You claimed the shift. Waiting for manager approval.');
        done();
      } : null,
    });
  }
  if (req) {
    return modal({
      title: 'Your shift',
      body: head + `<div class="alert alert-info">${req.status === 'claimed' ? `${esc(ctx.userName(req.claimer_id))} wants to take this shift. Waiting for manager approval.` : 'This shift is posted for coworkers to pick up.'}</div>`,
      submitLabel: 'Cancel my request',
      onSubmit: async () => {
        await api(`/shift-requests/${req.id}/cancel`, { method: 'POST' });
        toast('Request cancelled');
        done();
      },
    });
  }
  const coworkers = ctx.activeUsers().filter((u) => u.id !== ctx.me.id && u.role === 'employee').map((u) => [u.id, u.name]);
  modal({
    title: 'Your shift',
    body: head + (past ? '<p class="muted">This shift has already happened.</p>' : `
      <label class="field"><span>Offer this shift to</span><select name="target_id">${options(coworkers, '', { blank: 'Anyone (post it on the swap board)' })}</select></label>
      <label class="field"><span>Note (optional)</span><input type="text" name="note" maxlength="300" placeholder="e.g. Have a family event"></label>
      <p class="small muted">You're still responsible for the shift until a manager approves the swap.</p>`),
    submitLabel: 'Offer shift',
    onSubmit: past ? null : async (v) => {
      await api('/shift-requests', { method: 'POST', body: { shift_id: s.id, ...v } });
      toast('Shift offered to coworkers');
      done();
    },
  });
}
