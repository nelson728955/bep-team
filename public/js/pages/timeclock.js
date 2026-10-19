import { biweeklyStart } from '../pay-period.js';
import {
  api, esc, hrs, money0, fmtTime, fmtClock, fmtDate, fmtRange, fmtDateLong, addDays, today, weekStart, hmOf,
  modal, options, toast, avatar, emptyState, confirmDialog,
} from '../ui.js';

const state = { start: weekStart(today()), user: '', view: 'week' };

export async function render(root, ctx) {
  const daily = state.view === 'day';
  const biweekly = state.view === 'biweek';
  const step = daily ? 1 : biweekly ? 14 : 7;
  const align = biweekly ? biweeklyStart : weekStart;
  const end = addDays(state.start, step - 1);
  const department = ['FOH', 'BOH'].includes(state.user) ? state.user : null;
  const [allPunches, clock] = await Promise.all([
    api(`/punches?start=${state.start}&end=${end}${ctx.isManager && state.user && !department ? '&user=' + state.user : ''}`),
    api('/clock/status'),
  ]);
  const punches = department && ctx.isManager ? allPunches.filter(p => ctx.position(ctx.user(p.user_id)?.position_id)?.department === department) : allPunches;
  const M = ctx.isManager;
  const grace = Number(ctx.settings.late_grace_min) || 5;
  const otLimit = Number(ctx.settings.ot_threshold) || 40;
  const openNow = M ? await api(`/punches?start=${addDays(today(), -1)}&end=${today()}`).then((r) => r.filter((p) => !p.clock_out)) : [];

  const flags = (p) => {
    const out = [];
    if (p.estimated) out.push(['pill-info', 'Scheduled estimate']);
    if (!p.shift_id) out.push(['pill-warn', 'No shift']);
    else {
      const late = Math.round((p.clock_in - new Date(`${p.shift_date}T${p.shift_start}`).getTime()) / 60000);
      if (late > grace) out.push(['pill-bad', `${late}m late`]);
      if (p.clock_out) {
        let schedEnd = new Date(`${p.shift_date}T${p.shift_end}`).getTime();
        if (p.shift_end <= p.shift_start) schedEnd += 86400000;
        const diff = Math.round((p.clock_out - schedEnd) / 60000);
        if (diff < -15) out.push(['pill-warn', `Left ${-diff}m early`]);
        if (diff > 20) out.push(['pill-warn', `${diff}m over`]);
      }
    }
    if (!p.clock_out) out.push(['pill-info', p.break_start ? 'On break' : 'On the clock']);
    return out.map(([c, l]) => `<span class="pill ${c}">${l}</span>`).join(' ');
  };

  const byUser = new Map();
  for (const p of punches) byUser.set(p.user_id, (byUser.get(p.user_id) || 0) + p.hours);
  const pendingIds = punches.filter((p) => !p.approved && p.clock_out).map((p) => p.id);
  const hourGroups = new Map();
  for (const [uid, hours] of byUser) {
    const user = ctx.user(uid);
    const position = ctx.position(user?.position_id);
    const key = user?.role === 'manager' ? 'manager' : position?.id ?? 'none';
    if (!hourGroups.has(key)) hourGroups.set(key, { name: key === 'manager' ? 'Managers' : position?.name || 'No position', position, manager: key === 'manager', people: [] });
    hourGroups.get(key).people.push({ uid, hours });
  }
  const groupRank = g => g.position?.department === 'FOH' ? 0 : g.position?.department === 'BOH' ? 1 : g.manager ? 2 : 3;
  let previousDepartment = null;
  const weeklyHours = new Map();
  punches.forEach(p => { const key = p.user_id + ':' + weekStart(p.date); weeklyHours.set(key,(weeklyHours.get(key)||0)+p.hours); });
  const isOvertime = uid => [...weeklyHours].some(([key,h])=>key.startsWith(uid+':') && h>otLimit);
  const groupedHours = [...hourGroups.values()].sort((a,b) => groupRank(a)-groupRank(b) || a.name.localeCompare(b.name)).map(group => {
    const department = group.position?.department || (group.manager ? 'Managers' : 'Other staff');
    const heading = department !== previousDepartment ? `<h2 class="clock-department-heading">${department === 'FOH' ? 'Front of House' : department === 'BOH' ? 'Back of House' : department}</h2>` : '';
    previousDepartment = department;
    const color = /^#[0-9a-f]{3,8}$/i.test(group.position?.color || '') ? group.position.color : '#7b8190';
    return `${heading}<section class="clock-role-group" style="--role-color:${color}"><h3><span class="tip-role-dot" aria-hidden="true"></span>${esc(group.name)}</h3><ul class="list">${group.people.sort((a,b)=>ctx.userName(a.uid).localeCompare(ctx.userName(b.uid))).map(({uid,hours:h})=>`<li><button class="employee-hours-link" data-history="${uid}" aria-label="View ${esc(ctx.userName(uid))} punch history"><span>${esc(ctx.userName(uid))}${!daily && isOvertime(uid) ? ' <span class="pill pill-bad">Overtime</span>' : ''}</span><span class="num"><strong>${hrs(h)}</strong> hrs${M ? ` <span class="muted">· ${money0(h * (ctx.user(uid)?.hourly_rate || 0))}</span>` : ''}</span></button></li>`).join('')}</ul></section>`;
  }).join('');

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Time Clock</h1><div class="sub">${M ? 'Published shifts appear automatically on their day as estimates. Confirm attendance, edit, and approve before payroll.' : 'Clock in and out, and review your hours.'}</div></div>
    </div>
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head">
          <div class="toolbar">
            <div class="seg"><button type="button" data-view="day" class="${daily ? 'on' : ''}">Day</button><button type="button" data-view="week" class="${state.view === 'week' ? 'on' : ''}">Week</button><button type="button" data-view="biweek" class="${biweekly ? 'on' : ''}">Biweekly</button></div>
            <button class="btn btn-sm" data-nav="-${step}" aria-label="Previous ${daily ? 'day' : biweekly ? 'two-week period' : 'week'}">‹</button>
            <strong>${daily ? fmtDateLong(state.start) : fmtRange(state.start, end)}</strong>
            <button class="btn btn-sm" data-nav="${step}" aria-label="Next ${daily ? 'day' : biweekly ? 'two-week period' : 'week'}">›</button>
            <button class="btn btn-sm" data-nav="today">${daily ? 'Today' : biweekly ? 'This biweek' : 'This week'}</button>
            <input type="date" data-date value="${state.start}" aria-label="Choose ${daily ? 'day' : 'a date in the week'}" style="width:auto">
          </div>
          ${M ? `<div class="toolbar">
            <select data-user style="width:auto;height:30px">${options([['FOH', 'Front of House'], ['BOH', 'Back of House'], ...ctx.activeUsers().map((u) => [u.id, u.name])], state.user, { blank: 'All employees' })}</select>
            <button class="btn btn-sm" data-add>+ Add punch</button>
            <button class="btn btn-sm btn-teal" data-approve-all ${pendingIds.length ? '' : 'disabled'}>Approve all (${pendingIds.length})</button>
          </div>` : ''}
        </div>
        <div class="table-wrap timeclock-table-wrap">
          <table class="table">
            <thead><tr>${M ? '<th>Employee</th>' : ''}<th>Date</th><th>Scheduled</th><th>In</th><th>Out</th><th class="num">Break</th><th class="num">Hours</th><th>Flags</th><th>Status</th>${M ? '<th class="punch-actions">Actions</th>' : ''}</tr></thead>
            <tbody>
              ${punches.length ? punches.map((p) => `<tr>
                ${M ? `<td><div class="person">${avatar(ctx.userName(p.user_id), ctx.userColor(p.user_id), 'sm')}<span class="name">${esc(ctx.userName(p.user_id))}</span></div></td>` : ''}
                <td class="nowrap">${fmtDate(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td class="nowrap muted">${p.shift_start ? `${fmtTime(p.shift_start)}–${fmtTime(p.shift_end)}` : '–'}</td>
                <td class="nowrap">${fmtClock(p.clock_in)}</td>
                <td class="nowrap">${p.clock_out ? fmtClock(p.clock_out) : '<span class="muted">–</span>'}</td>
                <td class="num">${Math.round(p.break_min)}m</td>
                <td class="num"><strong>${hrs(p.hours)}</strong></td>
                <td>${flags(p)}</td>
                <td>${p.approved ? '<span class="pill pill-good">Approved</span>' : p.clock_out ? '<span class="pill pill-warn">Pending</span>' : '<span class="pill pill-muted">Open</span>'}</td>
                ${M ? `<td class="right punch-actions">${!p.approved && p.clock_out ? `<button class="btn btn-sm" data-approve="${p.id}">Approve</button> ` : ''}<button class="btn btn-sm" data-edit="${p.id}">Edit</button></td>` : ''}
              </tr>`).join('') : `<tr><td colspan="10">${emptyState(daily ? 'No punches this day' : 'No punches this week')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stack">
        ${M ? '' : clockCard(ctx, clock)}
        ${M ? `<div class="card">
          <div class="card-head"><h2>On the clock now</h2><span class="pill pill-good">${openNow.length}</span></div>
          <ul class="list">${openNow.length ? openNow.map((p) => `<li><div class="person" style="flex:1">${avatar(ctx.userName(p.user_id), ctx.userColor(p.user_id), 'sm')}<div class="meta"><div class="name">${esc(ctx.userName(p.user_id))}</div><div class="role">In at ${fmtClock(p.clock_in)} · ${hrs(p.hours)} hrs so far</div></div></div>${p.break_start ? '<span class="pill pill-info">On break</span>' : ''}</li>`).join('') : `<li>${emptyState('Nobody is clocked in')}</li>`}</ul>
        </div>` : ''}
        <div class="card">
          <div class="card-head"><h2>${M ? (daily ? 'Hours this day' : biweekly ? 'Hours this biweek' : 'Hours this week') : (daily ? 'My day' : biweekly ? 'My biweek' : 'My week')}</h2></div>
          ${groupedHours || emptyState('No hours yet')}
        </div>
      </div>
    </div>
  </div>`;
  root.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => employeeHistory(ctx, Number(button.dataset.history), state.start)));

  root.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    const previous = state.view;
    state.view = button.dataset.view;
    if (state.view === 'biweek') state.start = biweeklyStart(state.start);
    else if (state.view === 'week') state.start = weekStart(state.start);
    else if (previous !== 'day' && state.start === weekStart(today())) state.start = today();
    render(root, ctx);
  }));
  root.querySelector('[data-date]').addEventListener('change', event => {
    if (!event.target.value) return;
    state.start = daily ? event.target.value : align(event.target.value);
    render(root, ctx);
  });
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    state.start = b.dataset.nav === 'today' ? (daily ? today() : align(today())) : addDays(state.start, Number(b.dataset.nav));
    render(root, ctx);
  }));
  root.querySelectorAll('[data-clock]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api('/clock/' + b.dataset.clock, { method: 'POST', body: {} });
      toast(b.dataset.clock === 'in' ? 'Clocked in' : b.dataset.clock === 'out' ? 'Clocked out' : 'Break updated');
      render(root, ctx);
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }));
  if (!M) return;

  root.querySelector('[data-user]').addEventListener('change', (e) => { state.user = e.target.value; render(root, ctx); });
  root.querySelector('[data-add]').addEventListener('click', () => punchModal(ctx, null, () => render(root, ctx)));
  root.querySelector('[data-approve-all]').addEventListener('click', async () => {
    if (!(await confirmDialog(`Approve ${pendingIds.length} completed punch(es) for this ${daily ? 'day' : biweekly ? 'two-week period' : 'week'}?`, { confirmLabel: 'Approve all' }))) return;
    const r = await api('/punches/approve', { method: 'POST', body: { ids: pendingIds } });
    toast(`Approved ${r.approved} punch(es)`);
    render(root, ctx);
  });
  root.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    await api('/punches/approve', { method: 'POST', body: { ids: [Number(b.dataset.approve)] } });
    toast('Punch approved');
    render(root, ctx);
  }));
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () =>
    punchModal(ctx, punches.find((p) => p.id === Number(b.dataset.edit)), () => render(root, ctx))));
}

function clockCard(ctx, clock) {
  const p = clock.punch;
  const st = !p ? 'out' : p.break_start ? 'break' : 'in';
  return `<div class="card clock-card">
    <div class="clock-time">${fmtClock(Date.now())}</div>
    <div class="clock-date">${fmtDateLong(today())}</div>
    <div class="clock-status"><span class="pill ${st === 'in' ? 'pill-good' : st === 'break' ? 'pill-info' : 'pill-muted'}">${st === 'in' ? `Clocked in at ${fmtClock(p.clock_in)}` : st === 'break' ? 'On break' : 'Clocked out'}</span></div>
    <div class="clock-actions">
      ${st === 'out' ? '<button class="btn btn-primary btn-lg" data-clock="in">Clock in</button>' : `
        <button class="btn btn-lg" data-clock="break">${st === 'break' ? 'End break' : 'Start break'}</button>
        <button class="btn btn-teal btn-lg" data-clock="out">Clock out</button>`}
    </div>
    <div class="clock-elapsed">${clock.shifts.length ? `Scheduled today: ${clock.shifts.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)}`).join(', ')}` : 'No shift scheduled today'}</div>
  </div>`;
}

function punchModal(ctx, p, done) {
  const isNew = !p;
  modal({
    title: isNew ? 'Add punch' : `Edit punch · ${ctx.userName(p.user_id)}`,
    body: `
      ${isNew ? `<label class="field"><span>Employee</span><select name="user_id" required>${options(ctx.activeUsers().map((u) => [u.id, u.name]), '', { blank: 'Choose…' })}</select></label>` : ''}
      <div class="row">
        <label class="field"><span>Date</span><input type="date" name="date" value="${p ? p.date : today()}" required></label>
        <label class="field"><span>Clock in</span><input type="time" name="in" value="${p ? hmOf(p.clock_in) : ''}" required></label>
        <label class="field"><span>Clock out</span><input type="time" name="out" value="${p?.clock_out ? hmOf(p.clock_out) : ''}"></label>
        <label class="field"><span>Break (min)</span><input type="number" name="break_min" min="0" value="${p ? Math.round(p.break_min) : 0}"></label>
      </div>
      <label class="field"><span>Note</span><input type="text" name="note" maxlength="300" value="${esc(p?.note || '')}" placeholder="Reason for the change"></label>
      <label class="check"><input type="checkbox" name="approved" ${p?.approved || isNew ? 'checked' : ''}> Approved for payroll</label>`,
    submitLabel: isNew ? 'Add punch' : 'Save',
    extra: isNew ? [] : [{
      label: 'Delete', className: 'btn-danger', onClick: async () => {
        await api('/punches/' + p.id, { method: 'DELETE' });
        toast('Punch deleted');
        done();
      },
    }],
    onSubmit: async (v) => {
      await api(isNew ? '/punches' : '/punches/' + p.id, { method: isNew ? 'POST' : 'PUT', body: v });
      toast('Timesheet updated');
      done();
    },
  });
}

async function employeeHistory(ctx, userId, selectedDate) {
  let start = weekStart(selectedDate), length = 7, requestId = 0;
  const m = modal({title: `${ctx.userName(userId)} · Punch history`, wide: true, body: '<div data-history-content></div>'});
  const panel = m.form.querySelector('[data-history-content]');
  const draw = async () => {
    const version = ++requestId;
    const end = addDays(start, length - 1);
    panel.innerHTML = `<div class="toolbar" style="margin-bottom:16px"><select data-length aria-label="Period length"><option value="7" ${length === 7 ? 'selected' : ''}>Weekly</option><option value="14" ${length === 14 ? 'selected' : ''}>Biweekly (2 weeks)</option></select><button type="button" class="btn" data-step="-${length}" aria-label="Previous period">‹</button><strong>${fmtRange(start,end)}</strong><button type="button" class="btn" data-step="${length}" aria-label="Next period">›</button><button type="button" class="btn" data-current>This week</button><label class="field" style="margin:0"><span>Week starting</span><input type="date" data-history-date value="${start}"></label></div><div data-history-rows role="status">Loading punches…</div>`;
    panel.querySelector('[data-length]').onchange = e => { length = Number(e.target.value); start = length === 14 ? biweeklyStart(start) : weekStart(start); draw(); };
    panel.querySelectorAll('[data-step]').forEach(button => button.onclick = () => { start = addDays(start,Number(button.dataset.step)); draw(); });
    panel.querySelector('[data-current]').onclick = () => { start = length === 14 ? biweeklyStart(today()) : weekStart(today()); draw(); };
    panel.querySelector('[data-history-date]').onchange = e => { if(e.target.value) {start = length === 14 ? biweeklyStart(e.target.value) : weekStart(e.target.value);draw();} };
    try {
      const rows = await api(`/punches?start=${start}&end=${end}&user=${userId}`);
      if(version !== requestId || !m.dlg.isConnected) return;
      const hours = rows.reduce((sum,p)=>sum+p.hours,0);
      panel.querySelector('[data-history-rows]').innerHTML = `<p><strong>${hrs(hours)} hours</strong> · ${rows.length} punches · ${hrs(rows.filter(p=>p.approved).reduce((sum,p)=>sum+p.hours,0))} approved hours</p><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Break</th><th>Hours</th><th>Status</th></tr></thead><tbody>${rows.map(p=>`<tr><td class="nowrap">${fmtDate(p.date,{weekday:'short',month:'short',day:'numeric'})}</td><td class="nowrap">${fmtClock(p.clock_in)}</td><td class="nowrap">${p.clock_out ? fmtClock(p.clock_out) : 'Still clocked in'}</td><td>${Math.round(p.break_min)}m</td><td>${hrs(p.hours)}</td><td>${p.estimated ? '<span class="pill pill-info">Estimate</span> ' : ''}${p.approved?'Approved':p.clock_out?'Pending':'Open'}</td></tr>`).join('') || '<tr><td colspan="6">No punches in this period.</td></tr>'}</tbody></table></div>`;
    } catch(error) { if(version === requestId && m.dlg.isConnected) panel.querySelector('[data-history-rows]').textContent=error.message; }
  };
  await draw();
}
