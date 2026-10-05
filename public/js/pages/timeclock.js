import {
  api, esc, hrs, money0, fmtTime, fmtClock, fmtDate, fmtRange, fmtDateLong, addDays, today, weekStart, hmOf,
  modal, options, toast, avatar, emptyState, confirmDialog,
} from '../ui.js';

const state = { start: weekStart(today()), user: '', view: 'week' };

export async function render(root, ctx) {
  const daily = state.view === 'day';
  const end = daily ? state.start : addDays(state.start, 6);
  const step = daily ? 1 : 7;
  const [punches, clock] = await Promise.all([
    api(`/punches?start=${state.start}&end=${end}${ctx.isManager && state.user ? '&user=' + state.user : ''}`),
    api('/clock/status'),
  ]);
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

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Time Clock</h1><div class="sub">${M ? 'Published shifts appear automatically on their day as estimates. Confirm attendance, edit, and approve before payroll.' : 'Clock in and out, and review your hours.'}</div></div>
    </div>
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head">
          <div class="toolbar">
            <div class="seg"><button type="button" data-view="day" class="${daily ? 'on' : ''}">Day</button><button type="button" data-view="week" class="${daily ? '' : 'on'}">Week</button></div>
            <button class="btn btn-sm" data-nav="-${step}" aria-label="Previous ${daily ? 'day' : 'week'}">‹</button>
            <strong>${daily ? fmtDateLong(state.start) : fmtRange(state.start, end)}</strong>
            <button class="btn btn-sm" data-nav="${step}" aria-label="Next ${daily ? 'day' : 'week'}">›</button>
            <button class="btn btn-sm" data-nav="today">${daily ? 'Today' : 'This week'}</button>
            <input type="date" data-date value="${state.start}" aria-label="Choose ${daily ? 'day' : 'a date in the week'}" style="width:auto">
          </div>
          ${M ? `<div class="toolbar">
            <select data-user style="width:auto;height:30px">${options(ctx.activeUsers().map((u) => [u.id, u.name]), state.user, { blank: 'All employees' })}</select>
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
          <div class="card-head"><h2>${M ? (daily ? 'Hours this day' : 'Hours this week') : (daily ? 'My day' : 'My week')}</h2></div>
          <ul class="list">${[...byUser.entries()].sort((a, b) => b[1] - a[1]).map(([uid, h]) => `<li>
            <div style="flex:1">${esc(ctx.userName(uid))}${!daily && h > otLimit ? ' <span class="pill pill-bad">Overtime</span>' : ''}</div>
            <span class="num"><strong>${hrs(h)}</strong> hrs${M ? ` <span class="muted">· ${money0(h * (ctx.user(uid)?.hourly_rate || 0))}</span>` : ''}</span></li>`).join('') || `<li>${emptyState('No hours yet')}</li>`}</ul>
        </div>
      </div>
    </div>
  </div>`;

  root.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    const previous = state.view;
    state.view = button.dataset.view;
    if (state.view === 'week') state.start = weekStart(state.start);
    else if (previous === 'week' && state.start === weekStart(today())) state.start = today();
    render(root, ctx);
  }));
  root.querySelector('[data-date]').addEventListener('change', event => {
    if (!event.target.value) return;
    state.start = daily ? event.target.value : weekStart(event.target.value);
    render(root, ctx);
  });
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    state.start = b.dataset.nav === 'today' ? (daily ? today() : weekStart(today())) : addDays(state.start, Number(b.dataset.nav));
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
    if (!(await confirmDialog(`Approve ${pendingIds.length} completed punch(es) for this ${daily ? 'day' : 'week'}?`, { confirmLabel: 'Approve all' }))) return;
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
