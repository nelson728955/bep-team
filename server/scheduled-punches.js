import { db, tx } from './db.js';
import { today, msAt, addDays } from './util.js';

// Published schedules provide estimates until a manager records actual attendance.
export function syncScheduledPunches() {
  const date = today();
  const shifts = db.prepare('SELECT s.* FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.published=1 AND s.date=? AND u.active=1').all(date);
  const linked = db.prepare('SELECT 1 FROM punches WHERE shift_id=?');
  const suppressed = db.prepare('SELECT 1 FROM suppressed_scheduled_punches WHERE shift_id=? AND user_id=?');
  const overlap = db.prepare('SELECT 1 FROM punches WHERE user_id=? AND clock_in < ? AND COALESCE(clock_out, ?) > ?');
  const insert = db.prepare('INSERT INTO punches (user_id,shift_id,clock_in,clock_out,break_min,approved,note,estimated) VALUES (?,?,?,?,?,0,?,1)');
  tx(() => {
    for (const shift of shifts) {
      const start = msAt(shift.date,shift.start);
      const end = msAt(shift.end <= shift.start ? addDays(shift.date,1) : shift.date,shift.end);
      if (suppressed.get(shift.id, shift.user_id) || linked.get(shift.id) || overlap.get(shift.user_id,end,Date.now(),start)) continue;
      insert.run(shift.user_id,shift.id,start,end,shift.break_min,'Estimated from published schedule — confirm actual attendance before approving.');
    }
  });
}

export function deletePunch(id) {
  return tx(() => {
    const punch = db.prepare('SELECT * FROM punches WHERE id=?').get(id);
    if (!punch) return false;
    // Suppress regeneration even when a scheduled estimate was edited or approved.
    if (punch.shift_id != null) {
      db.prepare('INSERT OR IGNORE INTO suppressed_scheduled_punches (shift_id,user_id) VALUES (?,?)').run(punch.shift_id, punch.user_id);
    }
    db.prepare('DELETE FROM punches WHERE id=?').run(id);
    return true;
  });
}
