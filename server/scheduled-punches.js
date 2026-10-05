import { db, tx } from './db.js';
import { today, msAt, addDays } from './util.js';

// Published schedules provide estimates until a manager records actual attendance.
export function syncScheduledPunches() {
  const date = today();
  const shifts = db.prepare('SELECT s.* FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.published=1 AND s.date=? AND u.active=1').all(date);
  const linked = db.prepare('SELECT 1 FROM punches WHERE shift_id=?');
  const overlap = db.prepare('SELECT 1 FROM punches WHERE user_id=? AND clock_in < ? AND COALESCE(clock_out, ?) > ?');
  const insert = db.prepare('INSERT INTO punches (user_id,shift_id,clock_in,clock_out,break_min,approved,note,estimated) VALUES (?,?,?,?,?,0,?,1)');
  tx(() => {
    for (const shift of shifts) {
      const start = msAt(shift.date,shift.start);
      const end = msAt(shift.end <= shift.start ? addDays(shift.date,1) : shift.date,shift.end);
      if (linked.get(shift.id) || overlap.get(shift.user_id,end,Date.now(),start)) continue;
      insert.run(shift.user_id,shift.id,start,end,shift.break_min,'Estimated from published schedule — confirm actual attendance before approving.');
    }
  });
}
