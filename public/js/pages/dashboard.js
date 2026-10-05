import {
  api, esc, money, money0, pct, hrs, fmtTime, fmtClock, fmtDate, fmtDateLong, weekday, WEEKDAYS,
  barChart, avatar, emptyState, timeAgo, today, shiftHours, toast,
} from '../ui.js';

const STATUS = {
  working: ['pill-good', 'Working'],
  on_break: ['pill-info', 'On break'],
  done: ['pill-muted', 'Clocked out'],
  late: ['pill-bad', 'Late / no-show'],
  upcoming: ['pill-muted', 'Not yet in'],
};

export async function render(root, ctx) {
  const d = await api('/dashboard');
  if (d.role === 'employee') return renderEmployee(root, ctx, d);

  const target = d.labor_target_pct / 100;
  const sched = d.scheduled_labor;
  const proj = d.sales_today.projected;
  const schedPct = proj ? sched.cost / proj : null;
  const pendingTotal = d.pending.time_off + d.pending.swaps;
  const trend = d.trend;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>${greet}, ${esc(ctx.me.name.split(' ')[0])}</h1><div class="sub">${fmtDateLong(d.today)} · ${esc(ctx.settings.restaurant_name)}</div></div>
      <div class="toolbar">
        <a class="btn" href="#/schedule">Open schedule</a>
        <a class="btn btn-primary" href="#/timeclock">Timesheets</a>
      </div>
    </div>

    <div class="grid grid-4">
      <div class="card stat"><div class="label">Projected sales today</div><div class="value">${proj ? money0(proj) : '–'}</div>
        <div class="foot">${d.sales_today.actual ? `Actual so far ${money0(d.sales_today.actual)}` : 'Enter actuals in Reports at close'}</div></div>
      <div class="card stat"><div class="label">Scheduled labor today</div><div class="value">${money0(sched.cost)}</div>
        <div class="foot">${hrs(sched.hours)} hrs · <strong class="${schedPct > target ? 'pill pill-bad' : 'pill pill-good'}">${pct(schedPct)}</strong> of sales (target ${pct(target, 0)})</div></div>
      <div class="card stat"><div class="label">Clocked in now</div><div class="value">${d.clocked_in}</div>
        <div class="foot">${d.roster.filter((r) => r.status === 'late').length} late or missing today</div></div>
      <div class="card stat"><div class="label">Needs your attention</div><div class="value">${pendingTotal + d.pending.punches}</div>
        <div class="foot"><a href="#/requests">${d.pending.time_off} time off</a> · <a href="#/requests">${d.pending.swaps} swaps</a> · <a href="#/timeclock">${d.pending.punches} punches</a></div></div>
    </div>

    ${d.pending.unpublished ? `<div class="alert alert-info" style="margin-top:16px">You have <strong>${d.pending.unpublished}</strong> unpublished shift(s) coming up. Employees can't see them until you publish. <a href="#/schedule">Review schedule →</a></div>` : ''}

    <div class="grid grid-main" style="margin-top:16px">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Sales, last 14 days</h2><span class="muted small">Total ${money0(trend.reduce((a, x) => a + (x.sales || 0), 0))}</span></div>
          <div class="card-body">${barChart(trend.map((x) => ({
            label: WEEKDAYS[weekday(x.date)][0] + ' ' + fmtDate(x.date, { day: 'numeric' }),
            value: x.sales || 0,
            marker: x.projected || 0,
            tip: `<strong>${fmtDateLong(x.date)}</strong><br>Actual ${money0(x.sales)}<br>Projected ${money0(x.projected)}`,
          })), { markerLabel: 'Projected' })}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Labor % of sales, last 14 days</h2><span class="muted small">Target ${pct(target, 0)}</span></div>
          <div class="card-body">${barChart(trend.map((x) => {
            const p = x.sales ? x.labor_cost / x.sales : 0;
            return {
              label: WEEKDAYS[weekday(x.date)][0] + ' ' + fmtDate(x.date, { day: 'numeric' }),
              value: p,
              muted: p <= target,
              tip: `<strong>${fmtDateLong(x.date)}</strong><br>Labor ${money0(x.labor_cost)} (${hrs(x.labor_hours)} hrs)<br>${pct(p)} of ${money0(x.sales)} sales`,
            };
          }), { format: (v) => pct(v, 0), colorVar: '--series-2', refLine: { value: target, label: `Target ${pct(target, 0)}` }, height: 150 })}
          <p class="small muted" style="margin:8px 0 0">Days over target are shown in full color.</p></div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Today's team</h2><a class="small" href="#/timeclock">Time clock →</a></div>
          <ul class="list">
            ${d.roster.length ? d.roster.map((r) => {
              const u = ctx.user(r.shift.user_id);
              const [cls, label] = STATUS[r.status];
              return `<li>
                <div class="person" style="flex:1">${avatar(u?.name, ctx.userColor(u?.id), 'sm')}
                  <div class="meta"><div class="name">${esc(u?.name)}</div>
                  <div class="role">${fmtTime(r.shift.start)}–${fmtTime(r.shift.end)} · ${esc(ctx.position(r.shift.position_id)?.name || '')}
                  ${r.punch ? ` · in ${fmtClock(r.punch.clock_in)}` : ''}</div></div></div>
                <span class="pill ${cls}">${label}${r.late_minutes && r.status !== 'late' ? ` · ${r.late_minutes}m late` : ''}</span></li>`;
            }).join('') : `<li>${emptyState('Nobody is scheduled today')}</li>`}
            ${d.unscheduled.map((p) => `<li><div class="person" style="flex:1">${avatar(ctx.userName(p.user_id), ctx.userColor(p.user_id), 'sm')}<div class="meta"><div class="name">${esc(ctx.userName(p.user_id))}</div><div class="role">Not scheduled · in ${fmtClock(p.clock_in)}</div></div></div><span class="pill pill-warn">Unscheduled</span></li>`).join('')}
          </ul>
        </div>
        <div class="card">
          <div class="card-head"><h2>Today's checklists</h2><a class="small" href="#/tasks">Open →</a></div>
          <div class="card-body">
            <div class="progress"><i style="width:${d.tasks.total ? (d.tasks.done / d.tasks.total) * 100 : 0}%"></i></div>
            <p class="small muted" style="margin:8px 0 0">${d.tasks.done} of ${d.tasks.total} tasks complete</p>
          </div>
        </div>
        ${announcementsCard(d.announcements, ctx)}
      </div>
    </div>
  </div>`;
}

function announcementsCard(list, ctx) {
  return `<div class="card">
    <div class="card-head"><h2>Announcements</h2><a class="small" href="#/engage">All →</a></div>
    ${list.length ? list.map((a) => `<div class="announcement">
      <h3>${a.pinned ? '📌 ' : ''}${esc(a.title)}</h3>
      <div class="body">${esc(a.body)}</div>
      <div class="meta">${esc(ctx.userName(a.author_id))} · ${timeAgo(a.created_at)}</div></div>`).join('') : emptyState('No announcements')}
  </div>`;
}

function renderEmployee(root, ctx, d) {
  const clock = d.clock;
  const p = clock.punch;
  const next = d.upcoming[0];
  const state = !p ? 'out' : p.break_start ? 'break' : 'in';

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Hi, ${esc(ctx.me.name.split(' ')[0])}</h1><div class="sub">${fmtDateLong(today())}</div></div>
    </div>
    <div class="grid grid-main">
      <div class="stack">
        <div class="card clock-card">
          <div class="clock-time" data-now>${fmtClock(Date.now())}</div>
          <div class="clock-date">${clock.shifts.length ? `Today: ${clock.shifts.map((s) => `${fmtTime(s.start)}–${fmtTime(s.end)} ${esc(ctx.position(s.position_id)?.name || '')}`).join(', ')}` : 'No shift scheduled today'}</div>
          <div class="clock-status"><span class="pill ${state === 'in' ? 'pill-good' : state === 'break' ? 'pill-info' : 'pill-muted'}">${state === 'in' ? `Clocked in since ${fmtClock(p.clock_in)}` : state === 'break' ? 'On break' : 'Clocked out'}</span></div>
          <div class="clock-actions">
            ${state === 'out' ? '<button class="btn btn-primary btn-lg" data-clock="in">Clock in</button>' : `
              <button class="btn btn-lg" data-clock="break">${state === 'break' ? 'End break' : 'Start break'}</button>
              <button class="btn btn-teal btn-lg" data-clock="out">Clock out</button>`}
          </div>
        </div>
        <div class="grid grid-3">
          <div class="card stat"><div class="label">Hours this week</div><div class="value">${hrs(d.week_hours)}</div><div class="foot">of ${hrs(d.week_scheduled)} scheduled</div></div>
          <div class="card stat"><div class="label">Tips this week</div><div class="value">${money(d.week_tips)}</div><div class="foot"><a href="#/tips">See breakdown</a></div></div>
          <div class="card stat"><div class="label">Shifts up for grabs</div><div class="value">${d.open_shifts}</div><div class="foot"><a href="#/requests">Pick one up</a></div></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Upcoming shifts</h2><a class="small" href="#/schedule">Full schedule →</a></div>
          <ul class="list">${d.upcoming.length ? d.upcoming.map((s) => `<li>
            <span class="dot" style="background:${esc(ctx.position(s.position_id)?.color || '#999')}"></span>
            <div style="flex:1"><strong>${fmtDateLong(s.date)}</strong><div class="small muted">${fmtTime(s.start)}–${fmtTime(s.end)} · ${esc(ctx.position(s.position_id)?.name || '')}${s.notes ? ' · ' + esc(s.notes) : ''}</div></div>
            <span class="num muted">${hrs(shiftHours(s))} h</span></li>`).join('') : `<li>${emptyState('No upcoming shifts', 'Your manager has not published any shifts for you yet.')}</li>`}</ul>
        </div>
      </div>
      <div class="stack">
        ${next ? `<div class="card card-body"><div class="small muted">NEXT SHIFT</div><h2 style="margin-top:4px">${fmtDateLong(next.date)}</h2><p class="muted" style="margin:4px 0 0">${fmtTime(next.start)}–${fmtTime(next.end)} · ${esc(ctx.position(next.position_id)?.name || '')}</p></div>` : ''}
        ${announcementsCard(d.announcements, ctx)}
      </div>
    </div>
  </div>`;

  root.querySelectorAll('[data-clock]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api('/clock/' + b.dataset.clock, { method: 'POST', body: {} });
      toast(b.dataset.clock === 'in' ? 'Clocked in. Have a great shift!' : b.dataset.clock === 'out' ? 'Clocked out. See you next time!' : 'Break updated');
      render(root, ctx);
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }));
  const timer = setInterval(() => { const el = root.querySelector('[data-now]'); if (el) el.textContent = fmtClock(Date.now()); }, 10000);
  return () => clearInterval(timer);
}
