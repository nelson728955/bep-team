import {
  api, esc, money, hrs, fmtRange, addDays, today, weekStart, modal, toast, emptyState, confirmDialog,
} from '../ui.js';

const DISCLAIMER = "Source deductions are estimates using 2026 Québec and federal rates (Revenu Québec TP-1015.F and CRA T4127 methods, simplified). Check them against Revenu Québec's WebRAS calculator or your payroll provider before paying.";
const isLegacy = (s) => s.qpp_base === undefined; // stubs saved before Québec payroll (US estimate)
const cell = (v) => (v === undefined ? '<span class="muted">–</span>' : money(v));
const state = { preset: 'next', start: null, end: null };

export async function render(root, ctx) {
  return ctx.isManager ? renderManager(root, ctx) : renderEmployee(root, ctx);
}

function periodLength(ctx) {
  return { weekly: 7, biweekly: 14, semimonthly: 15 }[ctx.settings.pay_frequency] || 14;
}

function presetRange(preset, runs, ctx) {
  const wk = weekStart(today());
  if (preset === 'lastweek') return [addDays(wk, -7), addDays(wk, -1)];
  if (preset === 'last2') return [addDays(wk, -14), addDays(wk, -1)];
  if (preset === 'thisweek') return [wk, addDays(wk, 6)];
  const lastEnd = runs.reduce((m, r) => (r.end_date > m ? r.end_date : m), '');
  const s = lastEnd ? addDays(lastEnd, 1) : addDays(wk, -14);
  return [s, addDays(s, periodLength(ctx) - 1)];
}

async function renderManager(root, ctx) {
  const runs = await api('/payroll/runs');
  if (state.preset !== 'custom' || !state.start) [state.start, state.end] = presetRange(state.preset, runs, ctx);
  const p = await api(`/payroll/preview?start=${state.start}&end=${state.end}`);
  const inProgress = state.end >= today();

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Payroll</h1><div class="sub">Wages from approved timesheets, overtime over ${p.settings.ot_threshold} hrs/week at ${p.settings.ot_multiplier}×, plus distributed tips.</div></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <div class="toolbar">
          <select data-preset style="width:auto">
            ${[['next', 'Next pay period'], ['lastweek', 'Last week'], ['last2', 'Last 2 weeks'], ['thisweek', 'This week'], ['custom', 'Custom dates']].map(([v, l]) => `<option value="${v}" ${state.preset === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <input type="date" data-start value="${state.start}" style="width:auto">
          <span class="muted">to</span>
          <input type="date" data-end value="${state.end}" style="width:auto">
        </div>
        <button class="btn btn-teal" data-run ${p.items.length ? '' : 'disabled'}>Run payroll for ${fmtRange(state.start, state.end)}</button>
      </div>
      <div class="card-body" style="padding-bottom:0">
        ${inProgress ? '<div class="alert alert-info">This period has not ended yet. Hours still to be worked are not included.</div>' : ''}
        ${p.warnings.map((w) => `<div class="alert">${esc(w)} ${/minimum/.test(w) ? '<a href="#/team">Update wage →</a>' : /punch/.test(w) ? '<a href="#/timeclock">Review timesheets →</a>' : ''}</div>`).join('')}
        <div class="grid grid-4" style="margin-bottom:16px">
          <div class="card stat"><div class="label">Gross pay</div><div class="value">${money(p.totals.gross)}</div><div class="foot">${p.totals.employees} employees</div></div>
          <div class="card stat"><div class="label">Hours</div><div class="value">${hrs(p.totals.regular_hours + p.totals.overtime_hours)}</div><div class="foot">${hrs(p.totals.overtime_hours)} overtime</div></div>
          <div class="card stat"><div class="label">Tips paid out</div><div class="value">${money(p.totals.tips)}</div></div>
          <div class="card stat"><div class="label">Total employer cost</div><div class="value">${money(p.totals.gross + p.totals.employer_taxes + p.totals.vacation_accrued)}</div><div class="foot">${money(p.totals.employer_taxes)} contributions · ${money(p.totals.vacation_accrued)} vacation accrued</div></div>
        </div>
      </div>
      ${payTable(p.items, p.totals, true)}
      <p class="small muted" style="padding:12px 16px;margin:0">${DISCLAIMER}</p>
    </div>
    ${p.items.length ? remittanceCard(p.totals) : ''}

    <div class="card">
      <div class="card-head"><h2>Payroll history</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Pay period</th><th class="num">Employees</th><th class="num">Hours</th><th class="num">Gross</th><th class="num">Net</th><th>Run on</th><th></th></tr></thead>
        <tbody>${runs.length ? runs.map((r) => `<tr>
          <td><strong>${fmtRange(r.start_date, r.end_date)}</strong></td>
          <td class="num">${r.totals.employees}</td><td class="num">${hrs(r.totals.regular_hours + r.totals.overtime_hours)}</td>
          <td class="num">${money(r.totals.gross)}</td><td class="num">${money(r.totals.net)}</td>
          <td class="muted">${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td class="right nowrap"><button class="btn btn-sm" data-view="${r.id}">View stubs</button>
            <a class="btn btn-sm btn-ghost" href="/api/payroll/runs/${r.id}/csv">CSV</a>
            <button class="btn btn-sm btn-ghost" data-del="${r.id}">Delete</button></td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No payroll runs yet')}</td></tr>`}</tbody>
      </table></div>
    </div>
  </div>`;

  const rerender = () => render(root, ctx);
  root.querySelector('[data-preset]').addEventListener('change', (e) => { state.preset = e.target.value; if (state.preset !== 'custom') state.start = null; rerender(); });
  const onDate = () => {
    const s = root.querySelector('[data-start]').value;
    const e = root.querySelector('[data-end]').value;
    if (s && e && s <= e) { state.preset = 'custom'; state.start = s; state.end = e; rerender(); }
  };
  root.querySelector('[data-start]').addEventListener('change', onDate);
  root.querySelector('[data-end]').addEventListener('change', onDate);
  root.querySelector('[data-run]').addEventListener('click', async () => {
    if (!(await confirmDialog(`Run payroll for ${fmtRange(state.start, state.end)}? This saves pay stubs for ${p.totals.employees} employees (net ${money(p.totals.net)}).`, { confirmLabel: 'Run payroll' }))) return;
    const run = (force) => api('/payroll/run', { method: 'POST', body: { start: state.start, end: state.end, force } });
    try {
      await run(false);
    } catch (e) {
      if (!/already covers/.test(e.message)) return toast(e.message, 'error');
      if (!(await confirmDialog(e.message, { confirmLabel: 'Run anyway' }))) return;
      await run(true);
    }
    toast('Payroll saved. Employees can now see their pay stubs.');
    state.preset = 'next'; state.start = null;
    rerender();
  });
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
    const run = await api('/payroll/runs/' + b.dataset.view);
    const m = modal({
      title: `Payroll · ${fmtRange(run.start_date, run.end_date)}`,
      wide: true,
      body: `<p class="small muted">Click an employee to open their pay stub.</p>${payTable(run.items, run.totals, false)}`,
      cancelLabel: 'Close',
    });
    m.dlg.querySelectorAll('[data-stub]').forEach((tr) => tr.addEventListener('click', () =>
      stubModal(ctx, { ...run.items.find((i) => i.user_id === Number(tr.dataset.stub)), start_date: run.start_date, end_date: run.end_date })));
  }));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this payroll run and its pay stubs? Use this only if the run was a mistake.', { confirmLabel: 'Delete', danger: true }))) return;
    await api('/payroll/runs/' + b.dataset.del, { method: 'DELETE' });
    toast('Payroll run deleted');
    rerender();
  }));
}

function payTable(items, totals, preview) {
  if (!items.length) return emptyState('Nothing to pay', 'No approved hours or tips in this period.');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Employee</th><th class="num">Rate</th><th class="num">Reg hrs</th><th class="num">OT hrs</th><th class="num">Wages</th><th class="num">Tips</th><th class="num">Gross</th><th class="num">Federal</th><th class="num">Québec</th><th class="num">QPP</th><th class="num">EI</th><th class="num">QPIP</th><th class="num">Net pay</th></tr></thead>
    <tbody>${items.map((i) => `<tr ${preview ? '' : `data-stub="${i.user_id}" style="cursor:pointer"`}>
      <td><strong>${esc(i.name)}</strong><div class="small muted">${esc(i.position_name || '')}</div></td>
      <td class="num">${money(i.rate)}</td><td class="num">${hrs(i.regular_hours)}</td>
      <td class="num">${i.overtime_hours ? `<span class="pill pill-warn">${hrs(i.overtime_hours)}</span>` : '0.00'}</td>
      <td class="num">${money(i.regular_pay + i.overtime_pay + (i.vacation_pay || 0))}</td><td class="num">${money(i.tips)}</td>
      <td class="num"><strong>${money(i.gross)}</strong></td>
      <td class="num">${cell(i.federal)}</td><td class="num">${cell(i.quebec)}</td><td class="num">${cell(i.qpp)}</td><td class="num">${cell(i.ei)}</td><td class="num">${cell(i.qpip)}</td>
      <td class="num"><strong>${money(i.net)}</strong></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td></td><td class="num">${hrs(totals.regular_hours)}</td><td class="num">${hrs(totals.overtime_hours)}</td>
      <td class="num">${money(totals.gross - totals.tips)}</td><td class="num">${money(totals.tips)}</td><td class="num">${money(totals.gross)}</td>
      <td class="num">${cell(totals.federal)}</td><td class="num">${cell(totals.quebec)}</td><td class="num">${cell(totals.qpp)}</td><td class="num">${cell(totals.ei)}</td><td class="num">${cell(totals.qpip)}</td>
      <td class="num">${money(totals.net)}</td></tr></tfoot>
  </table></div>${items.some(isLegacy) ? '<p class="small muted" style="padding:8px 16px 0">This run was made before Québec payroll was set up. Its deductions used US rules and should not be relied on.</p>' : ''}`;
}

/** What gets remitted for this pay: employee deductions plus the employer's share. */
function remittanceCard(t) {
  const row = (label, emp, er, note = '') => `<tr><td>${label}${note ? `<div class="small muted">${note}</div>` : ''}</td><td class="num">${emp === null ? '–' : money(emp)}</td><td class="num">${er === null ? '–' : money(er)}</td><td class="num"><strong>${money((emp || 0) + (er || 0))}</strong></td></tr>`;
  const rq = t.quebec + t.qpp + t.qpip + t.er_qpp + t.er_qpip + t.er_hsf + t.er_cnt;
  const cra = t.federal + t.ei + t.er_ei;
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-head"><h2>Remittances for this pay</h2><span class="muted small">Employee deductions + employer contributions</span></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>To Revenu Québec</th><th class="num">Employee</th><th class="num">Employer</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${row('Québec income tax', t.quebec, null)}
        ${row('QPP', t.qpp, t.er_qpp, 'Employer matches the employee contribution')}
        ${row('QPIP', t.qpip, t.er_qpip)}
        ${row('Health Services Fund (HSF)', null, t.er_hsf)}
        ${row('Labour standards (CNT, 0.06%)', null, t.er_cnt)}
        <tr><td><strong>Total to Revenu Québec</strong></td><td></td><td></td><td class="num"><strong>${money(rq)}</strong></td></tr>
      </tbody>
      <thead><tr><th>To the Canada Revenue Agency</th><th class="num">Employee</th><th class="num">Employer</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${row('Federal income tax', t.federal, null)}
        ${row('Employment Insurance', t.ei, t.er_ei, 'Employer pays 1.4× the employee premium')}
        <tr><td><strong>Total to the CRA</strong></td><td></td><td></td><td class="num"><strong>${money(cra)}</strong></td></tr>
      </tbody>
      ${t.er_cnesst ? `<tbody>${row('CNESST workplace insurance', null, t.er_cnesst, 'Paid to the CNESST')}</tbody>` : ''}
    </table></div>
    ${t.vacation_accrued ? `<p class="small muted" style="padding:10px 16px;margin:0">Vacation pay of ${money(t.vacation_accrued)} was accrued this period (4%, or 6% after 3 years of service). It is paid when employees take their vacation.</p>` : ''}
  </div>`;
}

function stubHtml(ctx, s) {
  const otRate = s.overtime_hours ? s.overtime_pay / s.overtime_hours : s.rate * 1.5;
  const line = (label, v) => `<tr><td>${label}</td><td>${money(v)}</td></tr>`;
  const deductions = isLegacy(s)
    ? line('Federal income tax', s.federal) + line('Other (US estimate)', s.deductions - s.federal)
    : line('Federal income tax (after 16.5% Québec abatement)', s.federal) + line('Québec income tax', s.quebec)
      + line(`Québec Pension Plan (QPP)${s.qpp2 ? ' incl. QPP2' : ''}`, s.qpp) + line('Employment Insurance (EI)', s.ei) + line('Québec Parental Insurance Plan (QPIP)', s.qpip);
  return `<div class="stub">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div><strong>${esc(ctx.settings.restaurant_name)}</strong><div class="small muted">Earnings statement</div></div>
      <div class="right"><strong>${esc(s.name)}</strong><div class="small muted">${esc(s.position_name || '')}</div><div class="small muted">Pay period ${fmtRange(s.start_date, s.end_date)}</div></div>
    </div>
    <h3>Earnings</h3>
    <table><tbody>
      ${line(`Regular: ${hrs(s.regular_hours)} hrs × ${money(s.rate)}`, s.regular_pay)}
      ${s.overtime_hours ? line(`Overtime: ${hrs(s.overtime_hours)} hrs × ${money(otRate)}`, s.overtime_pay) : ''}
      ${line('Tips (distributed by employer)', s.tips)}
      ${s.vacation_pay ? line(`Vacation pay (${Math.round(s.vacation_rate * 100)}%)`, s.vacation_pay) : ''}
      <tr><td><strong>Gross pay</strong></td><td><strong>${money(s.gross)}</strong></td></tr>
    </tbody></table>
    <h3>Deductions (estimated)</h3>
    <table><tbody>
      ${deductions}
      <tr><td><strong>Total deductions</strong></td><td><strong>${money(s.deductions)}</strong></td></tr>
    </tbody></table>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding:12px 14px;background:var(--good-soft,#e1f4e9);border-radius:8px">
      <strong>Net pay</strong><span class="net">${money(s.net)}</span></div>
    ${s.vacation_accrued ? `<p class="small" style="margin-top:10px">Vacation pay accrued this period: <strong>${money(s.vacation_accrued)}</strong> (${Math.round(s.vacation_rate * 100)}%, paid when you take your vacation)</p>` : ''}
    <p class="small muted" style="margin-top:12px">${isLegacy(s) ? 'This stub was made before Québec payroll was set up and used US estimates.' : DISCLAIMER}</p>
  </div>`;
}

function stubModal(ctx, s) {
  const html = stubHtml(ctx, s);
  modal({
    title: 'Pay stub',
    body: html,
    cancelLabel: 'Close',
    extra: [{
      label: 'Print', onClick: () => {
        const w = window.open('', '_blank', 'width=720,height=900');
        if (!w) { toast('Allow pop-ups to print', 'error'); return false; }
        w.document.write(`<!doctype html><title>Pay stub · ${esc(s.name)}</title><link rel="stylesheet" href="/css/app.css"><body style="background:#fff;padding:32px;max-width:680px;margin:auto">${html}</body>`);
        w.document.close();
        w.onload = () => w.print();
        return false;
      },
    }],
  });
}

async function renderEmployee(root, ctx) {
  const stubs = await api('/paystubs/mine');
  const year = String(new Date().getFullYear());
  const ytd = stubs.filter((s) => s.end_date.startsWith(year));
  const sum = (k) => ytd.reduce((a, s) => a + s[k], 0);
  const me = ctx.user(ctx.me.id);
  root.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h1>My Pay</h1><div class="sub">Pay stubs are posted after each payroll run.</div></div></div>
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="card stat"><div class="label">${year} gross (YTD)</div><div class="value">${money(sum('gross'))}</div></div>
      <div class="card stat"><div class="label">${year} tips (YTD)</div><div class="value">${money(sum('tips'))}</div></div>
      <div class="card stat"><div class="label">${year} net (YTD)</div><div class="value">${money(sum('net'))}</div></div>
      <div class="card stat"><div class="label">Hourly rate</div><div class="value">${money(ctx.me.hourly_rate ?? me?.hourly_rate)}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Pay stubs</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Pay period</th><th class="num">Hours</th><th class="num">Tips</th><th class="num">Gross</th><th class="num">Net</th><th></th></tr></thead>
        <tbody>${stubs.length ? stubs.map((s) => `<tr>
          <td><strong>${fmtRange(s.start_date, s.end_date)}</strong></td><td class="num">${hrs(s.regular_hours + s.overtime_hours)}</td>
          <td class="num">${money(s.tips)}</td><td class="num">${money(s.gross)}</td><td class="num"><strong>${money(s.net)}</strong></td>
          <td class="right"><button class="btn btn-sm" data-stub="${s.id}">View</button></td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No pay stubs yet')}</td></tr>`}</tbody>
      </table></div></div>
  </div>`;
  root.querySelectorAll('[data-stub]').forEach((b) => b.addEventListener('click', () => stubModal(ctx, stubs.find((s) => s.id === Number(b.dataset.stub)))));
}
