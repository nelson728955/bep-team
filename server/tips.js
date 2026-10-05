import { db, getSettings } from './db.js';
import { addDays, msAt, punchHoursInWindow, round2 } from './util.js';

export const TIP_PERIODS = ['morning', 'night', 'all'];

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
      `SELECT p.*, u.name, u.position_id, pos.name AS position_name, pos.tip_points
         FROM punches p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN positions pos ON pos.id = u.position_id
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
