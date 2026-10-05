// Demo data so every screen has something to show on first run.
// Demo logins (all local-only test accounts):
//   Manager:   manager@shifthub.test / manager123
//   Employees: <firstname>@shifthub.test / employee123   (e.g. maya@shifthub.test)
import { db, tx } from './db.js';
import { computeTipSplit } from './tips.js';
import { computePayroll, savePayrollRun } from './payroll.js';
import { addDays, hashPassword, msAt, today, weekday, weekStart, round2 } from './util.js';

export const DEMO_MANAGER = { email: 'manager@shifthub.test', password: 'manager123' };
export const DEMO_EMPLOYEE_PASSWORD = 'employee123';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T = {
  L: ['10:30', '15:00', 0],
  D: ['16:00', '22:00', 30],
  DBL: ['11:00', '19:00', 30],
  AM: ['08:00', '15:00', 30],
  PM: ['14:30', '22:30', 30],
};

export function seed() {
  const rand = rng(42);
  const between = (a, b) => a + rand() * (b - a);
  const now = Date.now();
  const t0 = today();
  const wk = weekStart(t0);

  tx(() => {
    db.prepare("UPDATE settings SET value = 'Bếp · Cuisine Vietnamienne' WHERE key = 'restaurant_name'").run();

    const positions = [
      ['Server', 'FOH', '#2a78d6', 1],
      ['Bartender', 'FOH', '#4a3aa7', 1],
      ['Host', 'FOH', '#e87ba4', 0.5],
      ['Busser', 'FOH', '#1baf7a', 0.5],
      ['Line Cook', 'BOH', '#eb6834', 0],
      ['Prep Cook', 'BOH', '#eda100', 0],
      ['Dishwasher', 'BOH', '#008300', 0],
    ];
    const insPos = db.prepare('INSERT INTO positions (name, department, color, tip_points) VALUES (?, ?, ?, ?)');
    const pos = {};
    for (const p of positions) pos[p[0]] = Number(insPos.run(...p).lastInsertRowid);

    const insUser = db.prepare(
      `INSERT INTO users (name, email, phone, password_hash, role, position_id, hourly_rate, filing_status, hire_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const managerId = Number(
      insUser.run('Alex Morgan', DEMO_MANAGER.email, '555-0100', hashPassword(DEMO_MANAGER.password), 'manager', null, 0, 'married', '2019-03-01').lastInsertRowid
    );

    // name, position, rate, filing, pattern: [weekday, template]
    const staff = [
      ['Maya Chen', 'Server', 13.3, 'single', [[0, 'D'], [1, 'D'], [2, 'D'], [4, 'D'], [5, 'D']]],
      ['Jordan Blake', 'Server', 13.3, 'single', [[2, 'D'], [3, 'D'], [4, 'D'], [5, 'D'], [6, 'D']]],
      ['Ava Thompson', 'Server', 13.5, 'head', [[0, 'L'], [1, 'L'], [3, 'L'], [4, 'L'], [5, 'DBL'], [6, 'L']]],
      ['Priya Patel', 'Bartender', 14.5, 'single', [[1, 'D'], [2, 'D'], [3, 'D'], [4, 'D'], [5, 'D']]],
      ['Luis Ortega', 'Host', 16.6, 'single', [[0, 'L'], [3, 'D'], [4, 'D'], [5, 'D'], [6, 'D']]],
      ['Sam Rivera', 'Busser', 13.3, 'single', [[2, 'L'], [3, 'L'], [4, 'D'], [5, 'D'], [6, 'D']]],
      ['Marcus Green', 'Line Cook', 22, 'married', [[0, 'PM'], [1, 'PM'], [2, 'PM'], [3, 'PM'], [4, 'PM'], [5, 'PM']]],
      ['Elena Rossi', 'Line Cook', 20, 'single', [[1, 'AM'], [2, 'AM'], [3, 'AM'], [5, 'AM'], [6, 'AM']]],
      ['Tom Nguyen', 'Prep Cook', 18.5, 'married', [[0, 'AM'], [1, 'AM'], [2, 'AM'], [3, 'AM'], [4, 'AM']]],
      ['Dev Sharma', 'Dishwasher', 17, 'single', [[0, 'PM'], [3, 'PM'], [4, 'PM'], [5, 'PM'], [6, 'PM']]],
    ];
    const ids = {};
    const empPw = hashPassword(DEMO_EMPLOYEE_PASSWORD);
    staff.forEach(([name, p, rate, filing], i) => {
      const first = name.split(' ')[0].toLowerCase();
      ids[name] = Number(
        insUser.run(name, `${first}@shifthub.test`, `555-01${String(i + 1).padStart(2, '0')}`, empPw, 'employee', pos[p], rate, filing, `202${i % 5}-0${(i % 9) + 1}-15`).lastInsertRowid
      );
    });

    // ---- Shifts: 3 past weeks, this week (published), next week (draft) ----
    const insShift = db.prepare(
      'INSERT INTO shifts (user_id, position_id, date, start, end, break_min, notes, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const shifts = [];
    for (let w = -3; w <= 1; w++) {
      for (const [name, p, , , pattern] of staff) {
        for (const [wd, tpl] of pattern) {
          const date = addDays(wk, w * 7 + wd);
          if (w < 0 && rand() < 0.05) continue; // occasional variation in past weeks
          const [start, end, brk] = T[tpl];
          const id = Number(insShift.run(ids[name], pos[p], date, start, end, brk, null, w <= 0 ? 1 : 0).lastInsertRowid);
          shifts.push({ id, user_id: ids[name], date, start, end, break_min: brk });
        }
      }
    }
    const openSat = Number(insShift.run(null, pos.Server, addDays(wk, 5), '11:00', '19:00', 30, 'Private party, extra server needed', 1).lastInsertRowid);
    insShift.run(null, pos.Busser, addDays(wk, 11), '16:00', '22:00', 30, null, 0);

    // ---- Punches for every shift that has started ----
    const insPunch = db.prepare(
      'INSERT INTO punches (user_id, shift_id, clock_in, clock_out, break_min, approved) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const s of shifts) {
      const start = msAt(s.date, s.start);
      if (start > now) continue;
      let end = msAt(s.date, s.end);
      if (end <= start) end += 86400000;
      const late = s.user_id === ids['Jordan Blake'] && rand() < 0.35;
      const cin = start + Math.round(between(late ? 8 : -6, late ? 18 : 4)) * 60000;
      const cout = end + Math.round(between(-10, 15)) * 60000;
      const brk = s.break_min ? s.break_min + Math.round(between(0, 5)) : 0;
      const approved = s.date < wk ? 1 : 0;
      if (cout <= now) insPunch.run(s.user_id, s.id, cin, cout, brk, approved);
      else insPunch.run(s.user_id, s.id, cin, null, 0, 0);
    }

    // ---- Sales: 6 weeks back, 2 weeks ahead ----
    const base = [3100, 3700, 3300, 3700, 5000, 5250, 3850];
    const insSale = db.prepare('INSERT INTO sales (date, projected, actual, covers) VALUES (?, ?, ?, ?)');
    for (let i = -42; i <= 13; i++) {
      const date = addDays(t0, i);
      const projected = Math.round((base[weekday(date)] * between(0.96, 1.04)) / 10) * 10;
      const actual = i < 0 ? round2(projected * between(0.86, 1.14)) : null;
      insSale.run(date, projected, actual, actual ? Math.round(actual / 38) : null);
    }

    // ---- Tip pools for the last 3 weeks: lunch (morning) and dinner (night) ----
    const foh = [pos.Server, pos.Bartender, pos.Host, pos.Busser];
    const insPool = db.prepare(
      'INSERT INTO tip_pools (date, label, amount, method, period, position_ids, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insAlloc = db.prepare('INSERT INTO tip_allocations (pool_id, user_id, hours, weight, amount) VALUES (?, ?, ?, ?, ?)');
    for (let d = addDays(wk, -21); d < t0; d = addDays(d, 1)) {
      const sale = db.prepare('SELECT actual FROM sales WHERE date = ?').get(d);
      if (!sale?.actual) continue;
      for (const [period, label, share, time] of [['morning', 'Morning pool', between(0.035, 0.045), '15:30'], ['night', 'Night pool', between(0.085, 0.105), '23:30']]) {
        const amount = round2(sale.actual * share);
        const split = computeTipSplit(d, amount, 'points', foh, period, '16:00');
        if (!split.length) continue;
        const poolId = insPool.run(d, label, amount, 'points', period, JSON.stringify(foh), managerId, msAt(d, time)).lastInsertRowid;
        for (const x of split) insAlloc.run(poolId, x.user_id, x.hours, x.weight, x.amount);
      }
    }

    // ---- Time off, availability, shift requests ----
    const insTo = db.prepare('INSERT INTO time_off (user_id, start_date, end_date, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insTo.run(ids['Jordan Blake'], addDays(wk, 12), addDays(wk, 13), "Cousin's wedding out of town", 'pending', now - 86400000);
    insTo.run(ids['Ava Thompson'], addDays(wk, 9), addDays(wk, 9), 'Dentist appointment', 'approved', now - 3 * 86400000);
    insTo.run(ids['Sam Rivera'], addDays(wk, 16), addDays(wk, 20), 'Family vacation', 'pending', now - 7200000);

    const insAv = db.prepare('INSERT INTO availability (user_id, weekday, status, start, end) VALUES (?, ?, ?, ?, ?)');
    insAv.run(ids['Sam Rivera'], 0, 'unavailable', null, null);
    insAv.run(ids['Sam Rivera'], 1, 'unavailable', null, null);
    insAv.run(ids['Luis Ortega'], 0, 'partial', '10:00', '15:00');
    insAv.run(ids['Priya Patel'], 6, 'unavailable', null, null);
    insAv.run(ids['Priya Patel'], 0, 'unavailable', null, null);

    const insReq = db.prepare(
      'INSERT INTO shift_requests (shift_id, type, requester_id, target_id, claimer_id, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const mayaNext = shifts.find((s) => s.user_id === ids['Maya Chen'] && s.date > t0 && s.date < addDays(wk, 7));
    if (mayaNext) insReq.run(mayaNext.id, 'drop', ids['Maya Chen'], null, null, 'open', 'Have a school exam that evening', now - 5400000);
    if (addDays(wk, 5) >= t0) insReq.run(openSat, 'pickup', ids['Luis Ortega'], null, ids['Luis Ortega'], 'claimed', null, now - 3600000);

    // ---- Engage ----
    const insAnn = db.prepare('INSERT INTO announcements (author_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)');
    insAnn.run(managerId, 'New fall menu launches Friday', 'Tasting for all FOH staff Thursday at 3pm. Please review the new menu sheet in the back office before then.', 1, now - 2 * 86400000);
    insAnn.run(managerId, 'Reminder: clock out for breaks', 'Use the Start break button on the time clock for every meal break so payroll stays accurate.', 0, now - 5 * 86400000);

    const insMsg = db.prepare('INSERT INTO messages (author_id, body, created_at) VALUES (?, ?, ?)');
    insMsg.run(ids['Priya Patel'], 'We are low on limes, can someone grab a case from the walk-in before service?', now - 26 * 3600000);
    insMsg.run(ids['Tom Nguyen'], 'On it, restocked the bar fridge too.', now - 25.5 * 3600000);
    insMsg.run(managerId, 'Great work last night everyone. We hit a record Saturday!', now - 20 * 3600000);
    insMsg.run(ids['Maya Chen'], 'Anyone able to cover one of my shifts this week? Posted it on the swap board.', now - 90 * 60000);

    const insLog = db.prepare('INSERT INTO log_entries (date, author_id, category, body, created_at) VALUES (?, ?, ?, ?, ?)');
    insLog.run(addDays(t0, -1), managerId, 'general', 'Busy night, 2-top walk-ins waited ~25 min at 7:30. Consider adding a host on Fridays.', now - 14 * 3600000);
    insLog.run(addDays(t0, -1), managerId, 'maintenance', 'Dish machine rinse arm leaking. Technician booked for Thursday morning.', now - 13 * 3600000);
    insLog.run(addDays(t0, -2), managerId, '86', 'Ran out of short rib at 8:15pm. Increase prep par by 6 portions for weekends.', now - 38 * 3600000);
    insLog.run(t0, managerId, 'incident', 'Guest slipped near the bar entrance (no injury). Wet floor sign added; incident form filed.', now - 2 * 3600000);

    // ---- Task checklists ----
    const lists = [
      ['FOH Opening', 'FOH', 'opening', ['Unlock doors and disarm alarm', 'Wipe and set all tables', 'Stock host stand menus', 'Brew coffee and iced tea', 'Cut garnishes for the bar', 'Check restrooms are clean and stocked']],
      ['FOH Closing', 'FOH', 'closing', ['Roll silverware for tomorrow', 'Clean and restock server stations', 'Wipe down bar top and taps', 'Count and drop the cash drawer', 'Sweep dining room']],
      ['BOH Opening', 'BOH', 'opening', ['Record walk-in and freezer temps', 'Check prep list and pars', 'Turn on hoods, fryers, and grill', 'Set up the line with mise en place', 'Date and label all prep']],
      ['BOH Closing', 'BOH', 'closing', ['Wrap, label, and store all food', 'Clean flat-top and fryers', 'Sweep and mop kitchen floors', 'Take out trash and recycling', 'Record closing temps']],
    ];
    const insList = db.prepare('INSERT INTO task_lists (name, department, timing) VALUES (?, ?, ?)');
    const insTask = db.prepare('INSERT INTO tasks (list_id, text, sort) VALUES (?, ?, ?)');
    const insDone = db.prepare('INSERT INTO task_done (task_id, date, user_id, done_at) VALUES (?, ?, ?, ?)');
    for (const [name, dept, timing, items] of lists) {
      const listId = insList.run(name, dept, timing).lastInsertRowid;
      items.forEach((text, i) => {
        const taskId = insTask.run(listId, text, i).lastInsertRowid;
        if (timing === 'opening' && i < items.length - 1) insDone.run(taskId, t0, dept === 'FOH' ? ids['Ava Thompson'] : ids['Tom Nguyen'], now - 3600000);
      });
    }

    // ---- A completed payroll run for pay stubs ----
    savePayrollRun(computePayroll(addDays(wk, -21), addDays(wk, -8)), managerId);
  });
}
