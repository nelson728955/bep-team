import {
  api, esc, fmtTime, fmtDate, fmtDateLong, today, addDays, weekStart, WEEKDAYS, WEEKDAYS_LONG, hrs, shiftHours,
  modal, options, toast, avatar, emptyState, timeAgo,
} from '../ui.js';

const state = { tab: 'timeoff' };
const STATUS_PILL = {
  pending: 'pill-warn', approved: 'pill-good', denied: 'pill-bad', open: 'pill-info', claimed: 'pill-warn', cancelled: 'pill-muted',
};

export async function render(root, ctx) {
  const M = ctx.isManager;
  const [timeOff, swaps, availability] = await Promise.all([api('/timeoff'), api('/shift-requests'), api('/availability')]);
  const pendingTo = timeOff.filter((t) => t.status === 'pending').length;
  const pendingSwaps = swaps.filter((s) => s.status === 'claimed').length;

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Requests</h1><div class="sub">${M ? 'Approve time off and shift swaps, and see when your team is available.' : 'Request time off, trade shifts, and set your availability.'}</div></div>
      <div class="seg">
        <button data-tab="timeoff" class="${state.tab === 'timeoff' ? 'on' : ''}">Time off${M && pendingTo ? ` (${pendingTo})` : ''}</button>
        <button data-tab="swaps" class="${state.tab === 'swaps' ? 'on' : ''}">Shift swaps${M && pendingSwaps ? ` (${pendingSwaps})` : ''}</button>
        <button data-tab="availability" class="${state.tab === 'availability' ? 'on' : ''}">Availability</button>
      </div>
    </div>
    <div data-body></div>
  </div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(root, ctx); }));
  const body = root.querySelector('[data-body]');
  const rerender = () => render(root, ctx);
  if (state.tab === 'timeoff') timeOffTab(body, ctx, timeOff, rerender);
  else if (state.tab === 'swaps') await swapsTab(body, ctx, swaps, rerender);
  else availabilityTab(body, ctx, availability, rerender);
}

// ---------------------------------------------------------------- time off
function timeOffTab(el, ctx, rows, rerender) {
  const M = ctx.isManager;
  const days = (r) => Math.round((new Date(r.end_date) - new Date(r.start_date)) / 86400000) + 1;
  const range = (r) => (r.start_date === r.end_date ? fmtDateLong(r.start_date) : `${fmtDate(r.start_date)} – ${fmtDateLong(r.end_date)}`);
  const pending = rows.filter((r) => r.status === 'pending');
  const rest = M ? rows.filter((r) => r.status !== 'pending') : rows;

  el.innerHTML = `
    <div class="grid ${M ? 'grid-main' : ''}">
      <div class="card">
        <div class="card-head"><h2>${M ? 'All requests' : 'My time off'}</h2><button class="btn btn-primary btn-sm" data-new>${M ? '+ Add time off' : '+ Request time off'}</button></div>
        <div class="table-wrap"><table class="table">
          <thead><tr>${M ? '<th>Employee</th>' : ''}<th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead>
          <tbody>${rest.length ? rest.map((r) => `<tr>
            ${M ? `<td>${esc(ctx.userName(r.user_id))}</td>` : ''}
            <td class="nowrap">${range(r)}</td><td class="num">${days(r)}</td>
            <td>${esc(r.reason || '')}</td>
            <td><span class="pill ${STATUS_PILL[r.status]}">${r.status}</span></td>
            <td class="right nowrap">${M && r.status !== 'pending' ? `<button class="btn btn-sm btn-ghost" data-set="${r.id}" data-status="pending">Reopen</button>` : ''}
              ${!M && r.status === 'pending' ? `<button class="btn btn-sm btn-ghost" data-cancel="${r.id}">Cancel</button>` : ''}</td>
          </tr>`).join('') : `<tr><td colspan="6">${emptyState('No requests yet')}</td></tr>`}</tbody>
        </table></div>
      </div>
      ${M ? `<div class="card">
        <div class="card-head"><h2>Waiting for approval</h2><span class="pill pill-warn">${pending.length}</span></div>
        <ul class="list">${pending.length ? pending.map((r) => `<li style="flex-wrap:wrap">
          <div class="person" style="flex:1">${avatar(ctx.userName(r.user_id), ctx.userColor(r.user_id), 'sm')}<div class="meta">
            <div class="name">${esc(ctx.userName(r.user_id))}</div>
            <div class="role">${range(r)} · ${days(r)} day(s)${r.reason ? ` · ${esc(r.reason)}` : ''}</div>
            <div class="role">Requested ${timeAgo(r.created_at)}</div></div></div>
          <div class="toolbar"><button class="btn btn-sm" data-set="${r.id}" data-status="denied">Deny</button><button class="btn btn-sm btn-teal" data-set="${r.id}" data-status="approved">Approve</button></div>
        </li>`).join('') : `<li>${emptyState('All caught up')}</li>`}</ul>
      </div>` : ''}
    </div>`;

  el.querySelector('[data-new]').addEventListener('click', () => modal({
    title: M ? 'Add time off' : 'Request time off',
    body: `
      ${M ? `<label class="field"><span>Employee</span><select name="user_id" required>${options(ctx.activeUsers().filter((u) => u.role === 'employee').map((u) => [u.id, u.name]), '', { blank: 'Choose…' })}</select><span class="hint">Time off you add is approved automatically.</span></label>` : ''}
      <div class="row">
        <label class="field"><span>First day off</span><input type="date" name="start_date" min="${M ? '' : today()}" value="${addDays(today(), 7)}" required></label>
        <label class="field"><span>Last day off</span><input type="date" name="end_date" min="${M ? '' : today()}" value="${addDays(today(), 7)}" required></label>
      </div>
      <label class="field"><span>Reason (optional)</span><input type="text" name="reason" maxlength="300"></label>`,
    submitLabel: M ? 'Add' : 'Send request',
    onSubmit: async (v) => { await api('/timeoff', { method: 'POST', body: v }); toast(M ? 'Time off added' : 'Request sent to your manager'); rerender(); },
  }));
  el.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', async () => {
    await api('/timeoff/' + b.dataset.set, { method: 'PUT', body: { status: b.dataset.status } });
    toast(`Request ${b.dataset.status === 'pending' ? 'reopened' : b.dataset.status}`);
    rerender();
  }));
  el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    await api('/timeoff/' + b.dataset.cancel, { method: 'DELETE' });
    toast('Request cancelled');
    rerender();
  }));
}

// ---------------------------------------------------------------- swaps
async function swapsTab(el, ctx, rows, rerender) {
  const M = ctx.isManager;
  const me = ctx.me.id;
  const shiftLine = (r) => `${fmtDateLong(r.date)} · ${fmtTime(r.start)}–${fmtTime(r.end)} · ${esc(ctx.position(r.position_id)?.name || '')} · ${hrs(shiftHours(r))} hrs`;
  const describe = (r) => r.type === 'pickup'
    ? `${esc(ctx.userName(r.claimer_id))} wants to pick up an open shift`
    : r.claimer_id
      ? `${esc(ctx.userName(r.requester_id))} → ${esc(ctx.userName(r.claimer_id))}`
      : `${esc(ctx.userName(r.requester_id))} is offering this shift${r.target_id ? ` to ${esc(ctx.userName(r.target_id))}` : ''}`;
  const item = (r, actions) => `<li style="flex-wrap:wrap">
    <div style="flex:1;min-width:220px"><strong>${describe(r)}</strong><div class="small muted">${shiftLine(r)}</div>${r.note ? `<div class="small">“${esc(r.note)}”</div>` : ''}</div>
    <span class="pill ${STATUS_PILL[r.status]}">${r.status === 'claimed' ? 'needs approval' : r.status}</span>
    <div class="toolbar">${actions}</div></li>`;

  if (M) {
    const claimed = rows.filter((r) => r.status === 'claimed');
    const open = rows.filter((r) => r.status === 'open');
    const closed = rows.filter((r) => !['open', 'claimed'].includes(r.status)).slice(-15).reverse();
    el.innerHTML = `
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>Needs your approval</h2><span class="pill pill-warn">${claimed.length}</span></div>
          <ul class="list">${claimed.map((r) => item(r, `<button class="btn btn-sm" data-act="deny" data-id="${r.id}">Deny</button><button class="btn btn-sm btn-teal" data-act="approve" data-id="${r.id}">Approve</button>`)).join('') || `<li>${emptyState('No swaps to approve')}</li>`}</ul></div>
        <div class="stack">
          <div class="card"><div class="card-head"><h2>Posted, waiting for a taker</h2></div>
            <ul class="list">${open.map((r) => item(r, `<button class="btn btn-sm btn-ghost" data-act="cancel" data-id="${r.id}">Cancel</button>`)).join('') || `<li>${emptyState('Nothing posted')}</li>`}</ul></div>
          <div class="card"><div class="card-head"><h2>Recent</h2></div>
            <ul class="list">${closed.map((r) => item(r, '')).join('') || `<li>${emptyState('No history yet')}</li>`}</ul></div>
        </div>
      </div>`;
  } else {
    // Employees also see unclaimed open shifts from the next 3 weeks.
    const weeks = await Promise.all([0, 7, 14].map((n) => api('/schedule?start=' + addDays(weekStart(today()), n))));
    // The schedule payload lists every active request (not just mine), so shifts someone already claimed are hidden.
    const busy = new Set(weeks.flatMap((w) => w.requests).map((r) => r.shift_id));
    const openShifts = weeks.flatMap((w) => w.shifts).filter((s) => !s.user_id && s.date >= today() && !busy.has(s.id));
    const offers = rows.filter((r) => r.status === 'open' && r.type === 'drop' && r.requester_id !== me);
    const mine = rows.filter((r) => r.requester_id === me || r.claimer_id === me);
    el.innerHTML = `
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>Up for grabs</h2><span class="muted small">Shifts you can pick up</span></div>
          <ul class="list">
            ${offers.map((r) => item(r, `<button class="btn btn-sm btn-primary" data-act="claim" data-id="${r.id}">Pick up</button>`)).join('')}
            ${openShifts.map((s) => `<li style="flex-wrap:wrap"><div style="flex:1;min-width:220px"><strong>Open shift</strong><div class="small muted">${shiftLine(s)}</div>${s.notes ? `<div class="small">${esc(s.notes)}</div>` : ''}</div>
              <button class="btn btn-sm btn-primary" data-pickup="${s.id}">Request</button></li>`).join('')}
            ${!offers.length && !openShifts.length ? `<li>${emptyState('Nothing available right now')}</li>` : ''}
          </ul></div>
        <div class="card"><div class="card-head"><h2>My swap requests</h2><a class="small" href="#/schedule">Offer a shift from the schedule →</a></div>
          <ul class="list">${mine.map((r) => item(r, ['open', 'claimed'].includes(r.status) ? `<button class="btn btn-sm btn-ghost" data-act="cancel" data-id="${r.id}">${r.claimer_id === me && r.requester_id !== me ? 'Give back' : 'Cancel'}</button>` : '')).join('') || `<li>${emptyState('No requests', 'Tap one of your shifts on the schedule to offer it to a coworker.')}</li>`}</ul></div>
      </div>`;
    el.querySelectorAll('[data-pickup]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api('/shift-requests', { method: 'POST', body: { shift_id: Number(b.dataset.pickup) } });
        toast('Pickup requested. Waiting for manager approval.');
        rerender();
      } catch (e) { toast(e.message, 'error'); }
    }));
  }
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/shift-requests/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' });
      toast({ approve: 'Swap approved and schedule updated', deny: 'Swap denied', claim: 'Claimed. Waiting for manager approval.', cancel: 'Request updated' }[b.dataset.act]);
      rerender();
    } catch (e) { toast(e.message, 'error'); }
  }));
}

// ---------------------------------------------------------------- availability
function availabilityTab(el, ctx, rows, rerender) {
  const M = ctx.isManager;
  const get = (uid, wd) => rows.find((r) => r.user_id === uid && r.weekday === wd) || { status: 'available' };
  const label = (a) => (a.status === 'unavailable' ? '<span class="pill pill-bad">Unavailable</span>'
    : a.status === 'partial' ? `<span class="pill pill-warn">${fmtTime(a.start)}–${fmtTime(a.end)}</span>`
      : '<span class="pill pill-good">Any time</span>');

  if (M) {
    const staff = ctx.activeUsers().filter((u) => u.role === 'employee');
    el.innerHTML = `<div class="card"><div class="card-head"><h2>Team availability</h2><span class="muted small">Click a row to edit</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Employee</th>${WEEKDAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
      <tbody>${staff.map((u) => `<tr data-edit="${u.id}" style="cursor:pointer"><td><div class="person">${avatar(u.name, ctx.userColor(u.id), 'sm')}<span class="name">${esc(u.name)}</span></div></td>${WEEKDAYS.map((_, i) => `<td>${label(get(u.id, i))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    el.querySelectorAll('[data-edit]').forEach((tr) => tr.addEventListener('click', () => editAvailability(ctx, Number(tr.dataset.edit), get, rerender)));
  } else {
    el.innerHTML = `<div class="card" style="max-width:720px"><div class="card-head"><h2>My weekly availability</h2><button class="btn btn-primary btn-sm" data-edit>Edit</button></div>
      <ul class="list">${WEEKDAYS_LONG.map((d, i) => `<li><div style="flex:1">${d}</div>${label(get(ctx.me.id, i))}</li>`).join('')}</ul></div>`;
    el.querySelector('[data-edit]').addEventListener('click', () => editAvailability(ctx, ctx.me.id, get, rerender));
  }
}

function editAvailability(ctx, uid, get, rerender) {
  const m = modal({
    title: uid === ctx.me.id ? 'My availability' : `${ctx.userName(uid)}'s availability`,
    wide: true,
    body: `<table class="table"><tbody>${WEEKDAYS_LONG.map((d, i) => {
      const a = get(uid, i);
      return `<tr data-day="${i}"><td style="width:120px"><strong>${d}</strong></td>
        <td><select name="status_${i}" style="width:auto">${options([['available', 'Available any time'], ['partial', 'Available between…'], ['unavailable', 'Unavailable']], a.status)}</select></td>
        <td><div class="toolbar" data-times ${a.status === 'partial' ? '' : 'hidden'}><input type="time" name="start_${i}" value="${a.start || '10:00'}" style="width:130px"> to <input type="time" name="end_${i}" value="${a.end || '16:00'}" style="width:130px"></div></td></tr>`;
    }).join('')}</tbody></table>`,
    onSubmit: async (v) => {
      const days = WEEKDAYS.map((_, i) => ({ weekday: i, status: v[`status_${i}`], start: v[`start_${i}`], end: v[`end_${i}`] }));
      await api('/availability', { method: 'PUT', body: { user_id: uid, days } });
      toast('Availability saved');
      rerender();
    },
  });
  m.form.addEventListener('change', (e) => {
    const row = e.target.closest('[data-day]');
    if (row && e.target.name.startsWith('status_')) row.querySelector('[data-times]').hidden = e.target.value !== 'partial';
  });
}
