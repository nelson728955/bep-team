import crypto from 'node:crypto';

// ---- Dates (local time, 'YYYY-MM-DD' strings; weeks start Monday) ----
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => ymd(new Date());
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const weekday = (s) => (parseYmd(s).getDay() + 6) % 7; // Mon=0 … Sun=6
export const weekStart = (s) => addDays(s, -weekday(s));
export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isHm = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
export const dateOfMs = (ms) => ymd(new Date(ms));
export const msAt = (dateStr, hm) => {
  const d = parseYmd(dateStr);
  const [h, m] = hm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

// ---- Hours ----
export function shiftHours(sh) {
  const [h1, m1] = sh.start.split(':').map(Number);
  const [h2, m2] = sh.end.split(':').map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins <= 0) mins += 1440; // overnight shift
  return Math.max(0, (mins - (sh.break_min || 0)) / 60);
}

export function punchHours(p, now = Date.now()) {
  const end = p.clock_out ?? now;
  let breakMin = p.break_min || 0;
  if (!p.clock_out && p.break_start) breakMin += (now - p.break_start) / 60000;
  return Math.max(0, (end - p.clock_in) / 3600000 - breakMin / 60);
}

/** Paid hours of a punch that fall inside [from, to); the break is spread evenly over the punch. */
export function punchHoursInWindow(p, from, to, now = Date.now()) {
  const end = p.clock_out ?? now;
  const span = end - p.clock_in;
  if (span <= 0) return 0;
  const overlap = Math.max(0, Math.min(end, to) - Math.max(p.clock_in, from));
  let breakMin = p.break_min || 0;
  if (!p.clock_out && p.break_start) breakMin += (now - p.break_start) / 60000;
  return Math.max(0, (overlap - breakMin * 60000 * (overlap / span)) / 3600000);
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- Passwords ----
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

export const newToken = () => crypto.randomBytes(32).toString('hex');
