import { biweeklyStart } from '../pay-period.js';
import { api, esc, money, hrs, fmtDate, fmtDateLong, fmtTime, fmtRange, weekStart, addDays, today, formValues, toast, emptyState, avatar, confirmDialog } from '../ui.js';

const METHODS = {
  points: ['By role points', 'Share = hours × the position’s tip points (set on the Team page).'],
  manual: ['Manual amounts', 'Enter the exact tips for each FOH employee who worked.'],
};
const tipDotRank = worker => worker.morning_eligible ? (worker.night_eligible ? 1 : 0) : worker.night_eligible ? 2 : 3;
const PERIOD_ORDER = { morning: 0, night: 1, all: 2 };
const state = { days: 14, mode: 'split', employeePeriod: 'range', employeeWeek: null }; // mode: split (morning + night) | day (whole day)

const periodPill = (p) => (p === 'morning' ? '<span class="pill pill-morning">Morning</span>'
  : p === 'night' ? '<span class="pill pill-night">Night</span>' : '<span class="pill pill-muted">Whole day</span>');

function periodTotals(pools, userId) {
  const out = { morning: 0, night: 0, all: 0, hours: 0, amount: 0 };
  for (const p of pools) for (const a of p.allocations) {
    if (userId && a.user_id !== userId) continue;
    out[p.period || 'all'] += a.amount;
    out.hours += a.hours;
    out.amount += a.amount;
  }
  return out;
}

export async function render(root, ctx) {
  const end = today();
  const start = addDays(end, -(state.days - 1));
  const pools = (await api(`/tips?start=${start}&end=${end}`))
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]));
  const cutoff = ctx.settings.tip_split_time || '16:00';
  if (!ctx.isManager) return renderEmployee(root, ctx, pools, start, end, cutoff);

  const t = periodTotals(pools);
  const tipPositions = ctx.positions.filter((p) => p.tip_points > 0);
  const split = false;

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Tip Jar</h1><div class="sub">Pool tips by shift and split them fairly. Distributed tips are added to payroll automatically.</div></div>
      <select data-range style="width:auto">${[7, 14, 30, 60].map((n) => `<option value="${n}" ${n === state.days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select>
    </div>
    <div class="grid grid-main">
      <div class="stack">
        <form class="card" data-pool novalidate>
          <div class="card-head"><h2>Distribute tips</h2></div>
          <div class="card-body">
            <label class="field"><span>Date worked</span><input type="date" name="date" value="${today()}" max="${today()}" required></label>
            <input type="hidden" name="method" value="manual">
            <p class="small muted">Enter each person's tips for this date. Everyone with recorded hours is included.</p><p class="small muted"><span class="tip-period-dot tip-period-am" aria-hidden="true"></span> Morning · <span class="tip-period-dot tip-period-pm" aria-hidden="true"></span> Night</p>
            <div data-manual></div>
            <div class="toolbar"><button type="button" class="btn" data-preview>Preview split</button><button class="btn btn-primary" data-save disabled>Distribute tips</button></div>
            <div data-result style="margin-top:14px"></div>
          </div>
        </form>

        <div class="card">
          <div class="card-head"><h2>Pool history</h2><span class="muted small">${[['Morning', t.morning], ['Night', t.night], ['Whole day', t.all]].filter(([, v]) => v).map(([l, v]) => `${l} ${money(v)}`).join(' · ') || money(0)}</span></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Shift</th><th>Split</th><th class="num">People</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>${pools.length ? pools.map((p) => `<tr data-open="${p.id}" style="cursor:pointer">
              <td class="nowrap">${fmtDate(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${periodPill(p.period)}</td>
              <td>${(METHODS[p.method]?.[0] || ({hours: 'By hours worked', equal: 'Equal split'}[p.method]) || p.method)}</td><td class="num">${p.allocations.length}</td><td class="num"><strong>${money(p.amount)}</strong></td>
              <td class="right"><button class="btn btn-sm btn-ghost" data-del="${p.id}">Delete</button></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No tip pools in this range')}</td></tr>`}</tbody>
          </table></div>
        </div>
      </div>

      <div class="card" data-employee-tips></div>
    </div>
  </div>`;

  const panel = root.querySelector('[data-employee-tips]');
  let panelRequest = 0;
  const drawEmployeeTips = async () => {
    const request = ++panelRequest;
    const selected = state.employeeWeek;
    const periodDays = state.employeePeriod === 'biweek' ? 14 : 7;
    const alignPeriod = state.employeePeriod === 'biweek' ? biweeklyStart : weekStart;
    let selectedPools = pools;
    if (selected) {
      panel.innerHTML = '<div class="card-body">Loading tips…</div>';
      try { selectedPools = await api('/tips?start=' + selected + '&end=' + addDays(selected, periodDays - 1)); }
      catch (e) { if (request === panelRequest) panel.innerHTML = '<div class="card-body">' + esc(e.message) + '<button class="btn" data-retry>Retry</button></div>'; panel.querySelector('[data-retry]')?.addEventListener('click', drawEmployeeTips); return; }
    }
    if (request !== panelRequest || !root.contains(panel)) return;
    const byUser = new Map();
    for (const p of selectedPools) for (const allocation of p.allocations) {
      const row = byUser.get(allocation.user_id) || { amount: 0, hours: 0, morning: 0, night: 0 };
      row.amount += allocation.amount; row.hours += allocation.hours;
      if (p.period === 'morning' || p.period === 'night') row[p.period] += allocation.amount;
      byUser.set(allocation.user_id, row);
    }
    panel.innerHTML = `<div class="card-head"><h2>Tips by employee</h2></div>
      <div class="card-body" style="padding-bottom:0">
        <label class="field"><span>View tips for</span><select data-employee-period aria-label="Employee tips period">
          <option value="range" ${!selected ? 'selected' : ''}>Last ${state.days} days</option>
          <option value="week" ${state.employeePeriod === 'week' ? 'selected' : ''}>Week by week</option>
          <option value="biweek" ${state.employeePeriod === 'biweek' ? 'selected' : ''}>Biweekly</option>
        </select></label>
        ${selected ? `<div class="toolbar" style="flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-sm" data-week-step="-${periodDays}" aria-label="Previous week">‹</button>
          <span class="small" style="flex:1;text-align:center">${fmtRange(selected, addDays(selected, periodDays - 1))}</span>
          <button class="btn btn-sm" data-week-step="${periodDays}" aria-label="Next week" ${selected >= alignPeriod(today()) ? 'disabled' : ''}>›</button>
          <label class="field" style="width:100%;margin:0"><span>Choose a date in the period</span><input data-week-date type="date" value="${selected}" max="${today()}"></label>
        </div>` : ''}
      </div>
      <ul class="list">${[...byUser.entries()].sort((a,b)=>b[1].amount-a[1].amount).map(([uid,v])=>`<li>
        <div class="person" style="flex:1">${avatar(ctx.userName(uid),ctx.userColor(uid),'sm')}<div class="meta"><div class="name">${esc(ctx.userName(uid))}</div>
        ${v.morning || v.night ? `<div class="role">Morning ${money(v.morning)} · Night ${money(v.night)}</div>` : ''}
        <div class="role">${hrs(v.hours)} hrs · ${money(v.hours ? v.amount/v.hours : 0)}/hr</div></div></div>
        <strong class="num">${money(v.amount)}</strong></li>`).join('') || `<li>${emptyState(selected ? 'No tips for this period' : 'No tips yet')}</li>`}</ul>`;
    panel.querySelector('[data-employee-period]').addEventListener('change', e => { state.employeePeriod = e.target.value; state.employeeWeek = e.target.value === 'biweek' ? biweeklyStart(today()) : e.target.value === 'week' ? weekStart(today()) : null; drawEmployeeTips(); });
    panel.querySelectorAll('[data-week-step]').forEach(button => button.addEventListener('click', () => { state.employeeWeek = addDays(state.employeeWeek, Number(button.dataset.weekStep)); drawEmployeeTips(); }));
    panel.querySelector('[data-week-date]')?.addEventListener('change', e => { if (e.target.value && e.target.value <= today()) { state.employeeWeek = alignPeriod(e.target.value); drawEmployeeTips(); } });
  };
  drawEmployeeTips();

  const rerender = () => render(root, ctx);
  root.querySelector('[data-range]').addEventListener('change', (e) => { state.days = Number(e.target.value); rerender(); });
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; rerender(); }));

  const form = root.querySelector('[data-pool]');
  const result = form.querySelector('[data-result]');
  const saveBtn = form.querySelector('[data-save]');
  const periods = split ? ['morning', 'night'] : ['all'];
  const manualPanel = form.querySelector('[data-manual]');
  let loadVersion = 0;
  async function loadManual() {
    const version = ++loadVersion;
    const v = formValues(form);
    manualPanel.innerHTML = '<p>Loading workers…</p>';
    saveBtn.disabled = true;
    try {
      const workers = await Promise.all(periods.map(period => api('/tips/workers', {method:'POST',body:{date:v.date,period}})));
      if(version !== loadVersion) return;
      manualPanel.innerHTML = periods.map((period,i) => {
        const groups = new Map();
        workers[i].forEach(worker => {
          const position = ctx.position(worker.position_id);
          const key = worker.position_id ?? 'none';
          if (!groups.has(key)) groups.set(key, { position, name: worker.position_name || 'No position', workers: [] });
          groups.get(key).workers.push(worker);
        });
        const rank = group => group.position?.department === 'FOH' ? 0 : group.position?.department === 'BOH' ? 1 : 2;
        let lastDepartment = null;
        return [...groups.values()].sort((a,b) => rank(a)-rank(b) || a.name.localeCompare(b.name)).map(group => {
          const department = group.position?.department || 'Other';
          const departmentHeading = department !== lastDepartment ? `<h2 class="tip-department-heading">${department === 'FOH' ? 'Front of House' : department === 'BOH' ? 'Back of House' : 'Other staff'}</h2>` : '';
          lastDepartment = department;
          const color = /^#[0-9a-f]{3,8}$/i.test(group.position?.color || '') ? group.position.color : '#7b8190';
          return `${departmentHeading}<section class="tip-role-group" style="--role-color:${color}" aria-label="${esc(group.name)}"><h3><span class="tip-role-dot" aria-hidden="true"></span>${esc(group.name)} <span class="muted small">· ${group.workers.length} ${group.workers.length === 1 ? 'person' : 'people'}</span></h3>${group.workers.sort((a,b)=>tipDotRank(a)-tipDotRank(b) || a.name.localeCompare(b.name)).map(worker => `<label class="field"><span>${esc(worker.name)} <span class="tip-period-dots">${worker.morning_eligible ? '<span class="tip-period-dot tip-period-am" role="img" aria-label="At least 2 hours before cutoff" title="At least 2 hours before cutoff"></span>' : ''}${worker.night_eligible ? '<span class="tip-period-dot tip-period-pm" role="img" aria-label="At least 2 hours after cutoff" title="At least 2 hours after cutoff"></span>' : ''}</span> · ${hrs(worker.hours)} hrs</span><input type="number" min="0" step="0.01" value="0.00" data-manual-user="${worker.user_id}" data-period="${period}" aria-label="${esc(worker.name)} tips"></label>`).join('')}</section>`;
        }).join('') || '<p class="muted">No hours recorded for this date.</p>';
      }).join('');
    } catch(error) { if(version === loadVersion) manualPanel.innerHTML = `<div class="alert">${esc(error.message)}</div>`; }
  }
  form.addEventListener('change', e => { if (e.target.name === 'date' || e.target.name === 'method') loadManual(); });

  // One pool per period that has an amount entered.
  const buildPools = () => {
    const v = formValues(form);
    if (!v.date) throw new Error('Pick the date worked');
    const list = periods.map(p => {
      const allocations = [...manualPanel.querySelectorAll(`[data-period="${p}"]`)].map(input => ({user_id:Number(input.dataset.manualUser),amount:Number(input.value)}));
      const manual = v.method === 'manual';
      return {date:v.date,period:p,amount:manual ? Math.round(allocations.reduce((s,a)=>s+a.amount,0)*100)/100 : Number(v[p]),method:v.method,position_ids:manual ? ctx.positions.map(p=>p.id) : v.position_ids,allocations};
    }).filter(p=>p.amount>0);
    if (!list.length) throw new Error(split ? 'Enter morning tips, night tips, or both' : 'Enter the tips for the day');
    return { list, method: v.method };
  };

  form.addEventListener('input', () => { saveBtn.disabled = true; });
  await loadManual();
  form.querySelector('[data-preview]').addEventListener('click', async () => {
    try {
      const { list, method } = buildPools();
      const splits = await Promise.all(list.map((p) => api('/tips/preview', { method: 'POST', body: p })));
      const empty = list.filter((_, i) => !splits[i].length).map((p) => p.period);
      if (empty.length) {
        result.innerHTML = `<div class="alert">Nobody in those positions worked the ${empty.map((p) => (p === 'all' ? 'day' : p)).join(' or ')} on that date.</div>`;
        return;
      }
      result.innerHTML = previewTable(list, splits, method);
      saveBtn.disabled = false;
    } catch (e) { result.innerHTML = `<div class="alert">${esc(e.message)}</div>`; saveBtn.disabled = true; }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { list } = buildPools();
      await api('/tips', { method: 'POST', body: { pools: list } });
      toast(list.length > 1 ? 'Morning and night tips distributed' : 'Tips distributed. They will appear on the next payroll.');
      rerender();
    } catch (err) { result.innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
  });
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!(await confirmDialog('Delete this tip pool? Employees will lose these tips from payroll if it has not been run yet.', { confirmLabel: 'Delete', danger: true }))) return;
    await api('/tips/' + b.dataset.del, { method: 'DELETE' });
    rerender();
  }));
  root.querySelectorAll('[data-open]').forEach((tr) => tr.addEventListener('click', () => {
    const p = pools.find((x) => x.id === Number(tr.dataset.open));
    const next = tr.nextElementSibling;
    if (next?.dataset.detail) { next.remove(); return; }
    tr.insertAdjacentHTML('afterend', `<tr data-detail="1"><td colspan="6" style="background:var(--surface-2)">
      ${p.allocations.sort((a, b) => b.amount - a.amount).map((a) => `<div class="toolbar" style="padding:3px 0"><span style="flex:1">${esc(ctx.userName(a.user_id))}</span><span class="muted small">${hrs(a.hours)} hrs</span><strong class="num" style="width:90px;text-align:right">${money(a.amount)}</strong></div>`).join('')}
    </td></tr>`);
  }));
}

/** One table for a single pool, or a combined morning/night table with per-person totals. */
function previewTable(list, splits, method) {
  if (list.length === 1) {
    const s = splits[0];
    return `<table class="table"><thead><tr><th>Employee</th><th>Position</th><th class="num">Hours</th>${method === 'points' ? '<th class="num">Points</th>' : ''}<th class="num">Share</th></tr></thead>
      <tbody>${s.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.position_name || '')}</td><td class="num">${hrs(x.hours)}</td>${method === 'points' ? `<td class="num">${x.weight}</td>` : ''}<td class="num"><strong>${money(x.amount)}</strong></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="${method === 'points' ? 4 : 3}">${list[0].period === 'all' ? 'Whole day' : list[0].period === 'morning' ? 'Morning' : 'Night'} total</td><td class="num">${money(list[0].amount)}</td></tr></tfoot></table>`;
  }
  const people = new Map();
  list.forEach((p, i) => splits[i].forEach((x) => {
    const row = people.get(x.user_id) || { name: x.name, position: x.position_name, morning: null, night: null };
    row[p.period] = x;
    people.set(x.user_id, row);
  }));
  const rows = [...people.values()].map((r) => ({ ...r, total: (r.morning?.amount || 0) + (r.night?.amount || 0) })).sort((a, b) => b.total - a.total);
  const cell = (x) => (x ? `<td class="num muted">${hrs(x.hours)}h</td><td class="num">${money(x.amount)}</td>` : '<td class="num muted">–</td><td class="num muted">–</td>');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Employee</th><th class="num" colspan="2">${periodPill('morning')}</th><th class="num" colspan="2">${periodPill('night')}</th><th class="num">Total</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><strong>${esc(r.name)}</strong><div class="small muted">${esc(r.position || '')}</div></td>${cell(r.morning)}${cell(r.night)}<td class="num"><strong>${money(r.total)}</strong></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td></td><td class="num">${money(list[0].amount)}</td><td></td><td class="num">${money(list[1].amount)}</td><td class="num">${money(list[0].amount + list[1].amount)}</td></tr></tfoot>
  </table></div>`;
}

function renderEmployee(root, ctx, pools, start, end, cutoff) {
  const mine = pools.map((p) => ({ ...p, mine: p.allocations.find((a) => a.user_id === ctx.me.id) })).filter((p) => p.mine);
  const t = periodTotals(pools, ctx.me.id);
  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>My Tips</h1><div class="sub">${fmtDate(start)} – ${fmtDateLong(end)} · morning is before ${fmtTime(cutoff)}, night is after</div></div>
      <select data-range style="width:auto">${[7, 14, 30, 60].map((n) => `<option value="${n}" ${n === state.days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select>
    </div>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="card stat"><div class="label">Total tips</div><div class="value">${money(t.amount)}</div><div class="foot">${hrs(t.hours)} tipped hours</div></div>
      <div class="card stat"><div class="label">Morning tips</div><div class="value">${money(t.morning)}</div></div>
      <div class="card stat"><div class="label">Night tips</div><div class="value">${money(t.night)}</div></div>
      <div class="card stat"><div class="label">Average per hour</div><div class="value">${money(t.hours ? t.amount / t.hours : 0)}</div></div>
    </div>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Shift</th><th>Split</th><th class="num">Pool total</th><th class="num">My hours</th><th class="num">My share</th></tr></thead>
      <tbody>${mine.length ? mine.map((p) => `<tr><td>${fmtDate(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${periodPill(p.period)}</td><td>${(METHODS[p.method]?.[0] || ({hours: 'By hours worked', equal: 'Equal split'}[p.method]) || p.method)}</td>
        <td class="num">${money(p.amount)}</td><td class="num">${hrs(p.mine.hours)}</td><td class="num"><strong>${money(p.mine.amount)}</strong></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No tips in this period')}</td></tr>`}</tbody>
    </table></div></div>
  </div>`;
  root.querySelector('[data-range]').addEventListener('change', (e) => { state.days = Number(e.target.value); render(root, ctx); });
}
