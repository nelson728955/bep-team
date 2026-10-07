import { db, getSettings } from './db.js';
import { addDays, msAt, punchHoursInWindow, round2 } from './util.js';

export const TIP_PERIODS = ['morning', 'night', 'all'];

export function manualTipSplit(date, amount, positionIds, period, allocations) {
  const foh = db.prepare("SELECT id FROM positions WHERE department='FOH'").all().map(p => p.id);
  const eligible = computeTipSplit(date, 1, 'hours', positionIds.filter(id => foh.includes(id)), period);
  const seen = new Set();
  const result = allocations.map(a => {
    const person = eligible.find(p => p.user_id === Number(a.user_id));
    const cents = Math.round(Number(a.amount) * 100);
    if (!person || seen.has(person.user_id) || !Number.isFinite(Number(a.amount)) || Number(a.amount) < 0 || Math.abs(Number(a.amount) * 100 - cents) > 0.00001) throw new Error('Enter valid amounts for eligible FOH workers only.');
    seen.add(person.user_id);
    return { ...person, amount: cents / 100, weight: person.hours };
  });
  if (result.reduce((sum,p) => sum + Math.round(p.amount * 100),0) !== Math.round(amount * 100)) throw new Error('Manual amounts must match the tip pool total.');
  return result.filter(p => p.amount > 0);
}

// A few minutes across the cutoff (clocking in at 3:55 for a 4:00 dinner shift)
// should not earn a share of the other pool.
const MIN_PERIOD_HOURS = 0.25;

/**
 * Split a tip pool among everyone who worked on `date` in one of `positionIds`.
 *  - period: 'morning' counts only hours before the split time, 'night' only hours after it,
 *            'all' the whole day. Doubles are split by the hours on each side of the cutoff.
 *  - hours:  share ∝ hours worked in the period
 *  - points: share ∝ hours × position tip points
 *  - equal:  everyone who worked in the period gets the same share
 */
export function computeTipSplit(date, amount, method, positionIds, period = 'all', splitTime = getSettings().tip_split_time || '16:00') {
  const ids = new Set(positionIds.map(Number));
  const dayStart = msAt(date, '00:00');
  const split = msAt(date, splitTime);
  const [from, to] = period === 'morning' ? [-Infinity, split] : period === 'night' ? [split, Infinity] : [-Infinity, Infinity];
  const rows = db
    .prepare(
      `SELECT p.*, u.name, COALESCE(s.position_id, u.position_id) AS position_id, pos.name AS position_name, pos.tip_points
         FROM punches p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN shifts s ON s.id = p.shift_id
         LEFT JOIN positions pos ON pos.id = COALESCE(s.position_id, u.position_id)
        WHERE p.clock_in >= ? AND p.clock_in < ?`
    )
    .all(dayStart, msAt(addDays(date, 1), '00:00'));

  const byUser = new Map();
  for (const r of rows) {
    if (!ids.has(r.position_id)) continue;
    const cur = byUser.get(r.user_id) || {
      user_id: r.user_id,
      name: r.name,
      position_name: r.position_name,
      tip_points: r.tip_points ?? 1,
      hours: 0,
    };
    cur.hours += punchHoursInWindow(r, from, to);
    byUser.set(r.user_id, cur);
  }

  const minHours = period === 'all' ? 0.01 : MIN_PERIOD_HOURS;
  const people = [...byUser.values()].map((p) => ({ ...p, hours: round2(p.hours) })).filter((p) => p.hours >= minHours);
  for (const p of people) {
    p.weight = method === 'equal' ? 1 : method === 'points' ? p.hours * p.tip_points : p.hours;
  }
  const total = people.reduce((s, p) => s + p.weight, 0);
  let assigned = 0;
  for (const p of people) {
    p.amount = total > 0 ? Math.floor((amount * p.weight * 100) / total) / 100 : 0;
    assigned += p.amount;
  }
  // Hand leftover cents to the largest shares so the pool is fully distributed.
  let cents = Math.round((amount - assigned) * 100);
  const sorted = [...people].sort((a, b) => b.weight - a.weight);
  for (let i = 0; cents > 0 && sorted.length; i = (i + 1) % sorted.length, cents--) {
    sorted[i].amount = round2(sorted[i].amount + 0.01);
  }
  for (const p of people) p.weight = round2(p.weight);
  return people.sort((a, b) => b.amount - a.amount);
}
