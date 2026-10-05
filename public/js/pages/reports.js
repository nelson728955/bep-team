import {
  api, esc, money, money0, pct, hrs, fmtDate, fmtDateLong, fmtRange, addDays, today, weekday, WEEKDAYS, WEEKDAYS_LONG,
  barChart, toast, emptyState, downloadCsv, avatar,
} from '../ui.js';

const state = { days: 30, start: null, end: null };

export async function render(root, ctx) {
  if (!state.start) { state.end = addDays(today(), -1); state.start = addDays(state.end, -(state.days - 1)); }
  const r = await api(`/reports?start=${state.start}&end=${state.end}`);
  const T = r.totals;
  const target = Number(ctx.settings.labor_target_pct) / 100;
  const vsProj = T.projected_on_sales_days ? T.sales / T.projected_on_sales_days - 1 : null;
  const salesDays = r.days.filter((d) => d.sales !== null);
  const lbl = (d) => (r.days.length <= 14 ? WEEKDAYS[weekday(d.date)] + ' ' : '') + fmtDate(d.date, { month: 'numeric', day: 'numeric' });

  // Average sales by weekday
  const byWd = WEEKDAYS.map((_, i) => {
    const ds = salesDays.filter((d) => weekday(d.date) === i);
    const sales = ds.reduce((a, d) => a + d.sales, 0);
    const labor = ds.reduce((a, d) => a + d.labor_cost, 0);
    return { i, n: ds.length, avg: ds.length ? sales / ds.length : 0, laborPct: sales ? labor / sales : null };
  });
  const maxWd = Math.max(1, ...byWd.map((w) => w.avg));
  const maxHrs = Math.max(1, ...r.employees.map((e) => e.hours));

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Reports</h1><div class="sub">${fmtRange(state.start, state.end)} · labor is from actual punches at base rate</div></div>
      <div class="toolbar">
        <div class="seg">${[7, 14, 30, 90].map((n) => `<button data-days="${n}" class="${state.days === n ? 'on' : ''}">${n}d</button>`).join('')}</div>
        <input type="date" data-start value="${state.start}" style="width:auto"><span class="muted">to</span><input type="date" data-end value="${state.end}" style="width:auto">
        <button class="btn" data-csv>Export CSV</button>
      </div>
    </div>

    <div class="grid grid-4">
      <div class="card stat"><div class="label">Net sales</div><div class="value">${money0(T.sales)}</div>
        <div class="foot">${vsProj === null ? 'No projections' : `<span class="pill ${vsProj >= 0 ? 'pill-good' : 'pill-bad'}">${vsProj >= 0 ? '▲' : '▼'} ${pct(Math.abs(vsProj))}</span> vs projected`}</div></div>
      <div class="card stat"><div class="label">Labor cost</div><div class="value">${money0(T.labor_cost)}</div>
        <div class="foot"><span class="pill ${T.labor_pct > target ? 'pill-bad' : 'pill-good'}">${pct(T.labor_pct)}</span> of sales · target ${pct(target, 0)}</div></div>
      <div class="card stat"><div class="label">Sales per labor hour</div><div class="value">${T.splh ? money0(T.splh) : '–'}</div>
        <div class="foot">${hrs(T.labor_hours)} labor hours</div></div>
      <div class="card stat"><div class="label">Covers</div><div class="value">${Math.round(T.covers).toLocaleString()}</div>
        <div class="foot">Avg check ${T.avg_check ? money(T.avg_check) : '–'} · Tips ${money0(T.tips)}</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Daily sales</h2></div>
        <div class="card-body">${barChart(r.days.map((d) => ({
          label: lbl(d), value: d.sales || 0, marker: d.projected || 0,
          tip: `<strong>${fmtDateLong(d.date)}</strong><br>Sales ${d.sales !== null ? money0(d.sales) : '–'}<br>Projected ${d.projected ? money0(d.projected) : '–'}${d.covers ? `<br>${d.covers} covers` : ''}`,
        })), { markerLabel: 'Projected' })}</div></div>
      <div class="card"><div class="card-head"><h2>Daily labor % of sales</h2></div>
        <div class="card-body">${barChart(r.days.map((d) => {
          const p = d.sales ? d.labor_cost / d.sales : 0;
          return { label: lbl(d), value: p, muted: p <= target, tip: `<strong>${fmtDateLong(d.date)}</strong><br>${pct(p)} · ${money0(d.labor_cost)} labor<br>FOH ${money0(d.foh_cost)} · BOH ${money0(d.boh_cost)}` };
        }), { format: (v) => pct(v, 0), colorVar: '--series-2', refLine: { value: target, label: `Target ${pct(target, 0)}` } })}
        <p class="small muted" style="margin:8px 0 0">Full-color bars are over target.</p></div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Average day by weekday</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Day</th><th class="num">Avg sales</th><th style="width:40%"></th><th class="num">Labor %</th></tr></thead>
        <tbody>${byWd.map((w) => `<tr><td>${WEEKDAYS_LONG[w.i]}</td><td class="num">${w.n ? money0(w.avg) : '–'}</td>
          <td><div class="hbar"><i style="width:${(w.avg / maxWd) * 100}%"></i></div></td>
          <td class="num">${w.laborPct > target ? `<span class="pill pill-bad">${pct(w.laborPct)}</span>` : pct(w.laborPct)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>Labor by department</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Department</th><th class="num">Labor cost</th><th class="num">% of sales</th><th class="num">Share of labor</th></tr></thead>
        <tbody>
          <tr><td>Front of House</td><td class="num">${money0(T.foh_cost)}</td><td class="num">${pct(T.sales ? T.foh_cost / T.sales : null)}</td><td class="num">${pct(T.labor_cost ? T.foh_cost / T.labor_cost : null)}</td></tr>
          <tr><td>Back of House</td><td class="num">${money0(T.boh_cost)}</td><td class="num">${pct(T.sales ? T.boh_cost / T.sales : null)}</td><td class="num">${pct(T.labor_cost ? T.boh_cost / T.labor_cost : null)}</td></tr>
        </tbody>
        <tfoot><tr><td>Total</td><td class="num">${money0(T.labor_cost)}</td><td class="num">${pct(T.labor_pct)}</td><td class="num">100%</td></tr></tfoot></table></div></div>
    </div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h2>By employee</h2></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Employee</th><th class="num">Shifts</th><th class="num">Hours</th><th style="width:22%"></th><th class="num">Labor cost</th><th class="num">Tips</th><th class="num">Tips / hr</th></tr></thead>
      <tbody>${r.employees.length ? r.employees.map((e) => `<tr>
        <td><div class="person">${avatar(e.name, ctx.userColor(e.user_id), 'sm')}<div class="meta"><div class="name">${esc(e.name)}</div><div class="role">${esc(ctx.position(e.position_id)?.name || '')}</div></div></div></td>
        <td class="num">${e.shifts}</td><td class="num">${hrs(e.hours)}</td>
        <td><div class="hbar"><i style="width:${(e.hours / maxHrs) * 100}%"></i></div></td>
        <td class="num">${money0(e.labor_cost)}</td><td class="num">${money0(e.tips)}</td><td class="num">${e.hours ? money(e.tips / e.hours) : '–'}</td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No hours in this range')}</td></tr>`}</tbody></table></div></div>

    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Daily sales log</h2><span class="muted small">Enter actual sales and covers at close</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th class="num">Projected</th><th class="num">Actual sales</th><th class="num">Covers</th><th class="num">Labor</th><th class="num">Labor %</th><th class="num">Tips</th></tr></thead>
      <tbody>${[...r.days].reverse().map((d) => `<tr>
        <td class="nowrap">${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td class="num">${d.projected ? money0(d.projected) : '–'}</td>
        <td class="num"><input class="inline-input" style="width:110px" type="number" min="0" step="0.01" data-date="${d.date}" data-k="actual" value="${d.sales ?? ''}" aria-label="Actual sales ${d.date}"></td>
        <td class="num"><input class="inline-input" style="width:80px" type="number" min="0" step="1" data-date="${d.date}" data-k="covers" value="${d.covers ?? ''}" aria-label="Covers ${d.date}"></td>
        <td class="num">${money0(d.labor_cost)}</td>
        <td class="num">${d.sales ? pct(d.labor_cost / d.sales) : '–'}</td>
        <td class="num">${money0(d.tips)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;

  const rerender = () => render(root, ctx);
  root.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    state.days = Number(b.dataset.days);
    state.start = null;
    rerender();
  }));
  const onDate = () => {
    const s = root.querySelector('[data-start]').value;
    const e = root.querySelector('[data-end]').value;
    if (s && e && s <= e) { state.start = s; state.end = e; state.days = 0; rerender(); }
  };
  root.querySelector('[data-start]').addEventListener('change', onDate);
  root.querySelector('[data-end]').addEventListener('change', onDate);
  root.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', async () => {
    try {
      await api('/sales/' + inp.dataset.date, { method: 'PUT', body: { [inp.dataset.k]: inp.value } });
      toast('Saved');
      rerender();
    } catch (e) { toast(e.message, 'error'); }
  }));
  root.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(`report_${state.start}_to_${state.end}.csv`, [
    ['Date', 'Projected sales', 'Actual sales', 'Covers', 'Labor hours', 'Labor cost', 'Labor %', 'FOH labor', 'BOH labor', 'Tips'],
    ...r.days.map((d) => [d.date, d.projected ?? '', d.sales ?? '', d.covers ?? '', d.labor_hours, d.labor_cost, d.sales ? (d.labor_cost / d.sales * 100).toFixed(1) : '', d.foh_cost, d.boh_cost, d.tips]),
  ]));
}
