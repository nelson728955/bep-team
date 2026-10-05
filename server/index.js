import { syncScheduledPunches } from './scheduled-punches.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx, getSettings, DEFAULT_SETTINGS } from './db.js';
import { seed } from './seed.js';
import { computeTipSplit, TIP_PERIODS } from './tips.js';
import { computePayroll, savePayrollRun } from './payroll.js';
import {
  addDays, dateOfMs, hashPassword, isHm, isYmd, msAt, newToken, punchHours, round2,
  shiftHours, today, verifyPassword, weekStart,
} from './util.js';

const production = process.env.NODE_ENV === 'production';
// Employee access is enabled by default; set EMPLOYEE_ACCESS=false for manager-only mode.
const employeeAccess = process.env.EMPLOYEE_ACCESS !== 'false';
if (production && db.prepare('SELECT 1 FROM users WHERE email LIKE ?').get('%@shifthub.test')) throw new Error('Use a fresh production database without demo accounts.');
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  if (production) {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!email.includes('@') || password.length < 16) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 16 characters).');
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'manager')").run('Restaurant manager', email, hashPassword(password));
  } else seed();
}

syncScheduledPunches();
setInterval(() => { try { syncScheduledPunches(); } catch (error) { console.error('Scheduled attendance sync failed:', error.message); } }, 60000).unref();
const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
const appOrigin = appUrl ? new URL(appUrl).origin : null;
if (production && !appOrigin) throw new Error('Set APP_URL to your public website address.');
const app = express();
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (production && req.path.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers.origin !== appOrigin) return res.status(403).json({ error: 'Untrusted request origin' });
  }
  next();
});
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(here, '..', 'public')));

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const notFound = (what = 'Not found') => { throw new HttpError(404, what); };
const route = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) { next(err); }
};
const reqDate = (v, name = 'date') => (isYmd(v) ? v : bad(`Invalid ${name}`));
const reqTime = (v, name = 'time') => (isHm(v) ? v : bad(`Invalid ${name}`));
const num = (v, fallback = 0) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? fallback : Number(v));
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

const SESSION_DAYS = 14;
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));
}
function setSession(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${production ? "; Secure" : ""}`);
}

const publicUser = (u) => u && {
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, position_id: u.position_id,
  hourly_rate: u.hourly_rate, filing_status: u.filing_status, extra_withholding: u.extra_withholding,
  hire_date: u.hire_date, active: u.active, td1_federal: u.td1_federal, td1_quebec: u.td1_quebec,
};
const coworker = (u) => ({ id: u.id, name: u.name, role: u.role, position_id: u.position_id, active: u.active });

// ---------------------------------------------------------------- auth
const attempts = new Map();
setInterval(() => { for (const [ip, e] of attempts) if (e.until < Date.now()) attempts.delete(ip); }, 60000).unref();
app.post('/api/login', (req, res, next) => {
  let e = attempts.get(req.ip);
  if (!e || e.until < Date.now()) { e = { count: 0, until: Date.now() + 900000 }; attempts.set(req.ip, e); }
  if (++e.count > 20) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  next();
}, route((req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  if (!employeeAccess && user.role !== 'manager') {
    throw new HttpError(403, 'Employee access is currently disabled. Managers only.');
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, user.id, Date.now() + SESSION_DAYS * 86400000);
  setSession(res, token, SESSION_DAYS * 86400);
  return { user: publicUser(user) };
}));

// Public: lets the sign-in page show the restaurant's look before anyone logs in.
app.get('/api/branding', route(() => {
  const s = getSettings();
  return { theme: s.theme, restaurant_name: s.restaurant_name };
}));

app.post('/api/logout', route((req, res) => {
  const { sid } = parseCookies(req.headers.cookie);
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  setSession(res, '', 0);
  return { ok: true };
}));

app.use('/api', (req, res, next) => {
  const { sid } = parseCookies(req.headers.cookie);
  const row = sid && db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ? AND u.active = 1'
  ).get(sid, Date.now());
  if (!row) return res.status(401).json({ error: 'Please sign in' });
  if (!employeeAccess && row.role !== 'manager') return res.status(403).json({ error: 'Employee access is currently disabled. Managers only.' });
  req.user = row;
  req.isManager = row.role === 'manager';
  next();
});

const managerOnly = (req, res, next) => (req.isManager ? next() : res.status(403).json({ error: 'Managers only' }));

app.post('/api/me/password', route((req) => {
  const { current, next: pw } = req.body;
  if (!verifyPassword(String(current || ''), req.user.password_hash)) bad('Current password is incorrect');
  if (String(pw || '').length < 8) bad('New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), req.user.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- bootstrap
app.get('/api/bootstrap', route((req) => {
  const users = db.prepare('SELECT * FROM users ORDER BY name').all();
  return {
    me: publicUser(req.user),
    settings: getSettings(),
    positions: db.prepare('SELECT * FROM positions ORDER BY department DESC, name').all(),
    users: users.map(req.isManager ? publicUser : coworker),
  };
}));

// ---------------------------------------------------------------- settings / team
app.put('/api/settings', managerOnly, route((req) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  if (req.body.theme !== undefined && !['bep', 'classic'].includes(req.body.theme)) bad('Unknown theme');
  if (req.body.vacation_pay_mode !== undefined && !['accrue', 'each_pay'].includes(req.body.vacation_pay_mode)) bad('Unknown vacation pay option');
  if (req.body.tip_split_time !== undefined && !isHm(req.body.tip_split_time)) bad('Enter a valid time for the morning/night tip cutoff');
  if (req.body.shift_templates !== undefined) {
    let templates;
    try { templates = JSON.parse(req.body.shift_templates); } catch { bad('Invalid shift presets'); }
    if (!Array.isArray(templates) || templates.length > 20 || templates.some(t => !Array.isArray(t) || t.length !== 4 || typeof t[0] !== 'string' || !t[0].trim() || t[0].length > 40 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t[1]) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t[2]) || !Number.isInteger(t[3]) || t[3] < 0 || t[3] > 240)) bad('Check preset names, times and breaks (0–240 minutes).');
    up.run('shift_templates', JSON.stringify(templates));
  }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'shift_templates') continue;
    if (req.body[key] !== undefined) up.run(key, str(req.body[key], 200));
  }
  return getSettings();
}));

function userFields(b, existing = {}) {
  const role = ['manager', 'employee'].includes(b.role) ? b.role : existing.role || 'employee';
  const filing = ['single', 'married', 'head'].includes(b.filing_status) ? b.filing_status : existing.filing_status || 'single';
  const name = str(b.name ?? existing.name, 100);
  const email = str(b.email ?? existing.email, 200).toLowerCase();
  if (!name) bad('Name is required');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) bad('A valid email is required');
  return {
    name, email, role, filing_status: filing,
    phone: str(b.phone ?? existing.phone, 40) || null,
    position_id: b.position_id === undefined ? existing.position_id ?? null : num(b.position_id, null) || null,
    hourly_rate: Math.max(0, num(b.hourly_rate, existing.hourly_rate ?? (Number(getSettings().min_wage_tipped) || 13.30))),
    extra_withholding: Math.max(0, num(b.extra_withholding, existing.extra_withholding ?? 0)),
    td1_federal: b.td1_federal === undefined ? existing.td1_federal ?? null : num(b.td1_federal, null),
    td1_quebec: b.td1_quebec === undefined ? existing.td1_quebec ?? null : num(b.td1_quebec, null),
    hire_date: isYmd(b.hire_date) ? b.hire_date : existing.hire_date ?? null,
    active: b.active === undefined ? existing.active ?? 1 : b.active ? 1 : 0,
  };
}

app.post('/api/users', managerOnly, route((req) => {
  const f = userFields(req.body);
  const pw = String(req.body.password || '');
  if (pw.length < 8) bad('Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) bad('That email is already in use');
  const r = db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, role, position_id, hourly_rate, filing_status, extra_withholding, td1_federal, td1_quebec, hire_date, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(f.name, f.email, f.phone, hashPassword(pw), f.role, f.position_id, f.hourly_rate, f.filing_status, f.extra_withholding, f.td1_federal, f.td1_quebec, f.hire_date, f.active);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
}));

app.put('/api/users/:id', managerOnly, route((req) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) || notFound('Employee not found');
  const f = userFields(req.body, existing);
  if (existing.id === req.user.id && (f.role !== 'manager' || !f.active)) bad('You cannot remove your own manager access');
  const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(f.email, existing.id);
  if (clash) bad('That email is already in use');
  db.prepare(
    `UPDATE users SET name=?, email=?, phone=?, role=?, position_id=?, hourly_rate=?, filing_status=?, extra_withholding=?, td1_federal=?, td1_quebec=?, hire_date=?, active=? WHERE id=?`
  ).run(f.name, f.email, f.phone, f.role, f.position_id, f.hourly_rate, f.filing_status, f.extra_withholding, f.td1_federal, f.td1_quebec, f.hire_date, f.active, existing.id);
  if (req.body.password) {
    if (String(req.body.password).length < 8) bad('Password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  }
  if (!f.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id));
}));

function positionFields(b) {
  const name = str(b.name, 60) || bad('Position name is required');
  const department = b.department === 'BOH' ? 'BOH' : 'FOH';
  const color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#2a78d6';
  return { name, department, color, tip_points: Math.max(0, num(b.tip_points, 1)) };
}
app.post('/api/positions', managerOnly, route((req) => {
  const p = positionFields(req.body);
  const r = db.prepare('INSERT INTO positions (name, department, color, tip_points) VALUES (?, ?, ?, ?)').run(p.name, p.department, p.color, p.tip_points);
  return db.prepare('SELECT * FROM positions WHERE id = ?').get(r.lastInsertRowid);
}));
app.put('/api/positions/:id', managerOnly, route((req) => {
  const p = positionFields(req.body);
  db.prepare('UPDATE positions SET name=?, department=?, color=?, tip_points=? WHERE id=?').run(p.name, p.department, p.color, p.tip_points, req.params.id);
  return db.prepare('SELECT * FROM positions WHERE id = ?').get(req.params.id) || notFound();
}));
app.delete('/api/positions/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM positions WHERE id = ?').run(req.params.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- schedule
function laborForShifts(shifts) {
  const rates = new Map(db.prepare('SELECT id, hourly_rate FROM users').all().map((u) => [u.id, u.hourly_rate]));
  let hours = 0; let cost = 0;
  for (const s of shifts) {
    const h = shiftHours(s);
    hours += h;
    cost += h * (s.user_id ? rates.get(s.user_id) || 0 : 0);
  }
  return { hours: round2(hours), cost: round2(cost) };
}

function actualLabor(start, end) {
  const rows = db.prepare(
    `SELECT p.*, u.hourly_rate, pos.department FROM punches p JOIN users u ON u.id = p.user_id
       LEFT JOIN positions pos ON pos.id = u.position_id WHERE p.clock_in >= ? AND p.clock_in < ?`
  ).all(msAt(start, '00:00'), msAt(addDays(end, 1), '00:00'));
  const byDay = {};
  for (const r of rows) {
    const d = dateOfMs(r.clock_in);
    const h = punchHours(r);
    byDay[d] ??= { hours: 0, cost: 0, FOH: 0, BOH: 0 };
    byDay[d].hours += h;
    byDay[d].cost += h * r.hourly_rate;
    if (r.department) byDay[d][r.department] += h * r.hourly_rate;
  }
  for (const v of Object.values(byDay)) for (const k of Object.keys(v)) v[k] = round2(v[k]);
  return byDay;
}

app.get('/api/schedule', route((req) => {
  const start = weekStart(isYmd(req.query.start) ? req.query.start : today());
  const end = addDays(start, 6);
  const shifts = db.prepare(
    `SELECT * FROM shifts WHERE date BETWEEN ? AND ? ${req.isManager ? '' : 'AND published = 1'} ORDER BY date, start`
  ).all(start, end);
  const timeOff = db.prepare(
    `SELECT * FROM time_off WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`
  ).all(end, start);
  const availability = db.prepare('SELECT * FROM availability').all();
  const sales = db.prepare('SELECT * FROM sales WHERE date BETWEEN ? AND ?').all(start, end);
  const requests = db.prepare(
    `SELECT r.* FROM shift_requests r JOIN shifts s ON s.id = r.shift_id
      WHERE s.date BETWEEN ? AND ? AND r.status IN ('open','claimed')`
  ).all(start, end);
  const out = { start, end, shifts, timeOff, availability, requests };
  if (req.isManager) {
    out.sales = sales;
    out.actual = actualLabor(start, end);
    out.unpublished = shifts.filter((s) => !s.published).length;
  }
  return out;
}));

function shiftFields(b) {
  return {
    user_id: b.user_id ? num(b.user_id, null) : null,
    position_id: b.position_id ? num(b.position_id, null) : null,
    date: reqDate(b.date),
    start: reqTime(b.start, 'start time'),
    end: reqTime(b.end, 'end time'),
    break_min: Math.max(0, Math.min(240, num(b.break_min, 0))),
    notes: str(b.notes, 500) || null,
  };
}
app.post('/api/shifts', managerOnly, route((req) => {
  const s = shiftFields(req.body);
  const r = db.prepare(
    'INSERT INTO shifts (user_id, position_id, date, start, end, break_min, notes, published) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  ).run(s.user_id, s.position_id, s.date, s.start, s.end, s.break_min, s.notes);
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(r.lastInsertRowid);
}));
app.put('/api/shifts/:id', managerOnly, route((req) => {
  const s = shiftFields(req.body);
  const r = db.prepare(
    'UPDATE shifts SET user_id=?, position_id=?, date=?, start=?, end=?, break_min=?, notes=?, published=0 WHERE id=?'
  ).run(s.user_id, s.position_id, s.date, s.start, s.end, s.break_min, s.notes, req.params.id);
  if (!r.changes) notFound('Shift not found');
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
}));
app.delete('/api/shifts/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  return { ok: true };
}));
app.post('/api/schedule/publish', managerOnly, route((req) => {
  const start = weekStart(reqDate(req.body.start, 'week'));
  const r = db.prepare('UPDATE shifts SET published = 1 WHERE date BETWEEN ? AND ? AND published = 0').run(start, addDays(start, 6));
  syncScheduledPunches();
  return { published: r.changes };
}));
app.post('/api/schedule/clear', managerOnly, route((req) => {
  const start = weekStart(reqDate(req.body.start, 'week'));
  if (req.body.confirm !== true) bad('Confirm clearing this week’s schedule');
  let cleared = 0;
  tx(() => {
    cleared = db.prepare('DELETE FROM shifts WHERE date BETWEEN ? AND ?').run(start, addDays(start, 6)).changes;
  });
  return { cleared };
}));
app.post('/api/schedule/copy', managerOnly, route((req) => {
  const to = weekStart(reqDate(req.body.start, 'week'));
  const from = addDays(to, -7);
  const src = db.prepare('SELECT * FROM shifts WHERE date BETWEEN ? AND ?').all(from, addDays(from, 6));
  const ins = db.prepare(
    'INSERT INTO shifts (user_id, position_id, date, start, end, break_min, notes, published) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  );
  tx(() => {
    if (req.body.replace) db.prepare('DELETE FROM shifts WHERE date BETWEEN ? AND ?').run(to, addDays(to, 6));
    for (const s of src) ins.run(s.user_id, s.position_id, addDays(s.date, 7), s.start, s.end, s.break_min, s.notes);
  });
  return { copied: src.length };
}));

// ---------------------------------------------------------------- sales
app.get('/api/sales', managerOnly, route((req) => {
  const start = reqDate(req.query.start, 'start');
  const end = reqDate(req.query.end, 'end');
  return db.prepare('SELECT * FROM sales WHERE date BETWEEN ? AND ? ORDER BY date').all(start, end);
}));
app.put('/api/sales/:date', managerOnly, route((req) => {
  const date = reqDate(req.params.date);
  const cur = db.prepare('SELECT * FROM sales WHERE date = ?').get(date) || {};
  const pick = (k) => (req.body[k] === undefined ? cur[k] ?? null : req.body[k] === '' || req.body[k] === null ? null : Math.max(0, num(req.body[k])));
  db.prepare(
    'INSERT INTO sales (date, projected, actual, covers) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET projected=excluded.projected, actual=excluded.actual, covers=excluded.covers'
  ).run(date, pick('projected'), pick('actual'), pick('covers'));
  return db.prepare('SELECT * FROM sales WHERE date = ?').get(date);
}));

// ---------------------------------------------------------------- time clock
function openPunch(userId) {
  return db.prepare('SELECT * FROM punches WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1').get(userId);
}
function clockStatus(userId) {
  const t = today();
  const punch = openPunch(userId);
  const shifts = db.prepare('SELECT * FROM shifts WHERE user_id = ? AND date = ? AND published = 1 ORDER BY start').all(userId, t);
  const todays = db.prepare('SELECT * FROM punches WHERE user_id = ? AND clock_in >= ? ORDER BY clock_in').all(userId, msAt(t, '00:00'));
  return { punch: punch || null, shifts, today: todays, now: Date.now() };
}
app.get('/api/clock/status', route((req) => clockStatus(req.user.id)));

app.post('/api/clock/in', route((req) => {
  if (openPunch(req.user.id)) bad('You are already clocked in');
  const now = Date.now();
  const shift = db.prepare('SELECT * FROM shifts WHERE user_id = ? AND date = ? AND published = 1 ORDER BY ABS(? - start) LIMIT 1')
    .get(req.user.id, today(), new Date(now).toTimeString().slice(0, 5));
  if (shift) db.prepare('DELETE FROM punches WHERE shift_id = ? AND estimated = 1 AND approved = 0').run(shift.id);
  db.prepare('INSERT INTO punches (user_id, shift_id, clock_in) VALUES (?, ?, ?)').run(req.user.id, shift?.id ?? null, now);
  return clockStatus(req.user.id);
}));
app.post('/api/clock/break', route((req) => {
  const p = openPunch(req.user.id) || bad('You are not clocked in');
  const now = Date.now();
  if (p.break_start) {
    db.prepare('UPDATE punches SET break_min = break_min + ?, break_start = NULL WHERE id = ?').run((now - p.break_start) / 60000, p.id);
  } else {
    db.prepare('UPDATE punches SET break_start = ? WHERE id = ?').run(now, p.id);
  }
  return clockStatus(req.user.id);
}));
app.post('/api/clock/out', route((req) => {
  const p = openPunch(req.user.id) || bad('You are not clocked in');
  const now = Date.now();
  const extra = p.break_start ? (now - p.break_start) / 60000 : 0;
  db.prepare('UPDATE punches SET clock_out = ?, break_min = break_min + ?, break_start = NULL, note = COALESCE(?, note) WHERE id = ?')
    .run(now, extra, str(req.body?.note, 300) || null, p.id);
  return clockStatus(req.user.id);
}));

app.get('/api/punches', route((req) => {
  syncScheduledPunches();
  const start = reqDate(req.query.start, 'start');
  const end = reqDate(req.query.end, 'end');
  const userFilter = req.isManager ? (req.query.user ? Number(req.query.user) : null) : req.user.id;
  const rows = db.prepare(
    `SELECT p.*, s.start AS shift_start, s.end AS shift_end, s.date AS shift_date, s.break_min AS shift_break
       FROM punches p LEFT JOIN shifts s ON s.id = p.shift_id
      WHERE p.clock_in >= ? AND p.clock_in < ? ${userFilter ? 'AND p.user_id = ?' : ''}
      ORDER BY p.clock_in DESC`
  ).all(...[msAt(start, '00:00'), msAt(addDays(end, 1), '00:00'), ...(userFilter ? [userFilter] : [])]);
  return rows.map((p) => ({ ...p, hours: round2(punchHours(p)), date: dateOfMs(p.clock_in) }));
}));

function punchFields(b) {
  const date = reqDate(b.date);
  const clockIn = msAt(date, reqTime(b.in, 'clock-in time'));
  let clockOut = b.out ? msAt(date, reqTime(b.out, 'clock-out time')) : null;
  if (clockOut !== null && clockOut <= clockIn) clockOut += 86400000; // past midnight
  return { clockIn, clockOut, breakMin: Math.max(0, num(b.break_min, 0)), note: str(b.note, 300) || null };
}
app.post('/api/punches', managerOnly, route((req) => {
  const f = punchFields(req.body);
  const userId = num(req.body.user_id, 0) || bad('Pick an employee');
  const shift = db.prepare('SELECT id FROM shifts WHERE user_id = ? AND date = ? LIMIT 1').get(userId, req.body.date);
  db.prepare('INSERT INTO punches (user_id, shift_id, clock_in, clock_out, break_min, approved, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, shift?.id ?? null, f.clockIn, f.clockOut, f.breakMin, req.body.approved ? 1 : 0, f.note);
  return { ok: true };
}));
app.put('/api/punches/:id', managerOnly, route((req) => {
  const f = punchFields(req.body);
  const r = db.prepare('UPDATE punches SET clock_in=?, clock_out=?, break_min=?, break_start=NULL, note=?, approved=? WHERE id=?')
    .run(f.clockIn, f.clockOut, f.breakMin, f.note, req.body.approved ? 1 : 0, req.params.id);
  if (!r.changes) notFound('Punch not found');
  return { ok: true };
}));
app.delete('/api/punches/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM punches WHERE id = ?').run(req.params.id);
  return { ok: true };
}));
app.post('/api/punches/approve', managerOnly, route((req) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean);
  const up = db.prepare('UPDATE punches SET approved = 1 WHERE id = ? AND clock_out IS NOT NULL');
  let n = 0;
  tx(() => { for (const id of ids) n += up.run(id).changes; });
  return { approved: n };
}));

// ---------------------------------------------------------------- time off & availability
app.get('/api/timeoff', route((req) => {
  const sql = `SELECT * FROM time_off ${req.isManager ? '' : 'WHERE user_id = ?'} ORDER BY (status = 'pending') DESC, start_date DESC LIMIT 200`;
  return req.isManager ? db.prepare(sql).all() : db.prepare(sql).all(req.user.id);
}));
app.post('/api/timeoff', route((req) => {
  const start = reqDate(req.body.start_date, 'start date');
  const end = reqDate(req.body.end_date || start, 'end date');
  if (end < start) bad('End date is before start date');
  const userId = req.isManager && req.body.user_id ? Number(req.body.user_id) : req.user.id;
  const status = req.isManager && req.body.user_id ? 'approved' : 'pending';
  db.prepare('INSERT INTO time_off (user_id, start_date, end_date, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, start, end, str(req.body.reason, 300) || null, status, Date.now());
  return { ok: true };
}));
app.put('/api/timeoff/:id', managerOnly, route((req) => {
  const status = ['approved', 'denied', 'pending'].includes(req.body.status) ? req.body.status : bad('Invalid status');
  db.prepare('UPDATE time_off SET status = ? WHERE id = ?').run(status, req.params.id);
  return { ok: true };
}));
app.delete('/api/timeoff/:id', route((req) => {
  const row = db.prepare('SELECT * FROM time_off WHERE id = ?').get(req.params.id) || notFound();
  if (!req.isManager && (row.user_id !== req.user.id || row.status !== 'pending')) bad('Only pending requests can be cancelled');
  db.prepare('DELETE FROM time_off WHERE id = ?').run(row.id);
  return { ok: true };
}));

app.get('/api/availability', route((req) => {
  return req.isManager
    ? db.prepare('SELECT * FROM availability').all()
    : db.prepare('SELECT * FROM availability WHERE user_id = ?').all(req.user.id);
}));
app.put('/api/availability', route((req) => {
  const userId = req.isManager && req.body.user_id ? Number(req.body.user_id) : req.user.id;
  const days = Array.isArray(req.body.days) ? req.body.days : bad('Missing days');
  const up = db.prepare(
    'INSERT INTO availability (user_id, weekday, status, start, end) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, weekday) DO UPDATE SET status=excluded.status, start=excluded.start, end=excluded.end'
  );
  tx(() => {
    for (const d of days) {
      const wd = Number(d.weekday);
      if (!(wd >= 0 && wd <= 6)) continue;
      const status = ['available', 'unavailable', 'partial'].includes(d.status) ? d.status : 'available';
      const partial = status === 'partial';
      if (partial && (!isHm(d.start) || !isHm(d.end))) bad('Enter a time range for partial availability');
      up.run(userId, wd, status, partial ? d.start : null, partial ? d.end : null);
    }
  });
  return { ok: true };
}));

// ---------------------------------------------------------------- shift swaps / pickups
app.get('/api/shift-requests', route((req) => {
  const rows = db.prepare(
    `SELECT r.*, s.date, s.start, s.end, s.position_id, s.user_id AS shift_user_id, s.break_min
       FROM shift_requests r JOIN shifts s ON s.id = r.shift_id
      WHERE s.date >= ? ORDER BY s.date, s.start`
  ).all(addDays(today(), -14));
  if (req.isManager) return rows;
  const me = req.user.id;
  return rows.filter((r) =>
    r.requester_id === me || r.claimer_id === me ||
    (r.status === 'open' && r.type === 'drop' && (r.target_id === null || r.target_id === me)));
}));

app.post('/api/shift-requests', route((req) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND published = 1').get(req.body.shift_id) || notFound('Shift not found');
  if (shift.date < today()) bad('That shift has already happened');
  const active = db.prepare("SELECT 1 FROM shift_requests WHERE shift_id = ? AND status IN ('open','claimed')").get(shift.id);
  if (active) bad('There is already an active request for this shift');
  const now = Date.now();
  if (shift.user_id === null) {
    db.prepare("INSERT INTO shift_requests (shift_id, type, requester_id, claimer_id, status, note, created_at) VALUES (?, 'pickup', ?, ?, 'claimed', ?, ?)")
      .run(shift.id, req.user.id, req.user.id, str(req.body.note, 300) || null, now);
  } else {
    if (shift.user_id !== req.user.id) bad('You can only offer up your own shifts');
    const target = req.body.target_id ? Number(req.body.target_id) : null;
    db.prepare("INSERT INTO shift_requests (shift_id, type, requester_id, target_id, status, note, created_at) VALUES (?, 'drop', ?, ?, 'open', ?, ?)")
      .run(shift.id, req.user.id, target, str(req.body.note, 300) || null, now);
  }
  return { ok: true };
}));

app.post('/api/shift-requests/:id/:action', route((req) => {
  const r = db.prepare('SELECT * FROM shift_requests WHERE id = ?').get(req.params.id) || notFound();
  const me = req.user.id;
  const setStatus = (status, claimer = r.claimer_id) =>
    db.prepare('UPDATE shift_requests SET status = ?, claimer_id = ? WHERE id = ?').run(status, claimer, r.id);
  switch (req.params.action) {
    case 'claim':
      if (r.status !== 'open' || r.type !== 'drop') bad('This shift is no longer available');
      if (r.requester_id === me) bad('You cannot pick up your own shift');
      if (r.target_id && r.target_id !== me) bad('This swap was offered to someone else');
      setStatus('claimed', me);
      break;
    case 'cancel':
      if (!req.isManager && r.requester_id !== me && r.claimer_id !== me) bad('Not your request');
      if (!['open', 'claimed'].includes(r.status)) bad('Request is already closed');
      if (r.type === 'drop' && r.claimer_id === me && r.requester_id !== me) setStatus('open', null); // un-claim
      else setStatus('cancelled');
      break;
    case 'approve':
      if (!req.isManager) bad('Managers only');
      if (r.status !== 'claimed' || !r.claimer_id) bad('Nobody has claimed this shift yet');
      tx(() => {
        db.prepare('UPDATE shifts SET user_id = ? WHERE id = ?').run(r.claimer_id, r.shift_id);
        setStatus('approved');
      });
      break;
    case 'deny':
      if (!req.isManager) bad('Managers only');
      setStatus('denied');
      break;
    default:
      notFound();
  }
  return { ok: true };
}));

// ---------------------------------------------------------------- tips
function tipPoolsBetween(start, end, userId = null) {
  const pools = db.prepare('SELECT * FROM tip_pools WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC').all(start, end);
  const allocs = db.prepare(
    `SELECT a.* FROM tip_allocations a JOIN tip_pools t ON t.id = a.pool_id WHERE t.date BETWEEN ? AND ? ${userId ? 'AND a.user_id = ?' : ''}`
  ).all(...[start, end, ...(userId ? [userId] : [])]);
  const byPool = new Map();
  for (const a of allocs) {
    if (!byPool.has(a.pool_id)) byPool.set(a.pool_id, []);
    byPool.get(a.pool_id).push(a);
  }
  return pools
    .map((p) => ({ ...p, position_ids: JSON.parse(p.position_ids), allocations: byPool.get(p.id) || [] }))
    .filter((p) => !userId || p.allocations.length);
}
app.get('/api/tips', route((req) => {
  const start = reqDate(req.query.start, 'start');
  const end = reqDate(req.query.end, 'end');
  return tipPoolsBetween(start, end, req.isManager ? null : req.user.id);
}));
const PERIOD_LABEL = { morning: 'Morning pool', night: 'Night pool', all: 'Daily pool' };
function tipInput(b) {
  const date = reqDate(b.date);
  const amount = round2(num(b.amount, 0));
  if (amount <= 0) bad('Enter a tip amount');
  const method = ['hours', 'points', 'equal'].includes(b.method) ? b.method : 'hours';
  const period = TIP_PERIODS.includes(b.period) ? b.period : 'all';
  const positionIds = (b.position_ids || []).map(Number).filter(Boolean);
  if (!positionIds.length) bad('Pick at least one position to include');
  return { date, amount, method, period, positionIds, label: str(b.label, 80) || PERIOD_LABEL[period] };
}
app.post('/api/tips/preview', managerOnly, route((req) => {
  const t = tipInput(req.body);
  return computeTipSplit(t.date, t.amount, t.method, t.positionIds, t.period);
}));
// Accepts { pools: [...] } so morning and night tips are saved together (all or nothing).
app.post('/api/tips', managerOnly, route((req) => {
  const inputs = (Array.isArray(req.body.pools) ? req.body.pools : [req.body]).map(tipInput);
  if (!inputs.length) bad('Enter a tip amount');
  // A whole-day pool overlaps both halves, so it blocks (and is blocked by) either one.
  const exists = db.prepare("SELECT 1 FROM tip_pools WHERE date = ? AND (period = ? OR period = 'all' OR ? = 'all')");
  const plans = inputs.map((t) => {
    if (!req.body.force && exists.get(t.date, t.period, t.period)) {
      bad(`Tips for ${t.period === 'all' ? 'that day' : 'the ' + t.period} of ${t.date} were already distributed. Delete that pool first to redo it.`);
    }
    const split = computeTipSplit(t.date, t.amount, t.method, t.positionIds, t.period);
    if (!split.length) bad(`Nobody in those positions worked the ${t.period === 'all' ? 'day' : t.period} of ${t.date}`);
    return { t, split };
  });
  tx(() => {
    const pool = db.prepare('INSERT INTO tip_pools (date, label, amount, method, period, position_ids, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const ins = db.prepare('INSERT INTO tip_allocations (pool_id, user_id, hours, weight, amount) VALUES (?, ?, ?, ?, ?)');
    for (const { t, split } of plans) {
      const id = pool.run(t.date, t.label, t.amount, t.method, t.period, JSON.stringify(t.positionIds), req.user.id, Date.now()).lastInsertRowid;
      for (const x of split) ins.run(id, x.user_id, x.hours, x.weight, x.amount);
    }
  });
  return { ok: true, pools: plans.length };
}));
app.delete('/api/tips/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM tip_pools WHERE id = ?').run(req.params.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- payroll
app.get('/api/payroll/preview', managerOnly, route((req) => {
  const start = reqDate(req.query.start, 'start');
  const end = reqDate(req.query.end, 'end');
  if (end < start) bad('End date is before start date');
  return computePayroll(start, end);
}));
app.post('/api/payroll/run', managerOnly, route((req) => {
  const start = reqDate(req.body.start, 'start');
  const end = reqDate(req.body.end, 'end');
  const overlap = db.prepare('SELECT id FROM payroll_runs WHERE start_date <= ? AND end_date >= ?').get(end, start);
  if (overlap && !req.body.force) bad('A payroll run already covers part of this period. Delete it first or confirm to run anyway.');
  const result = computePayroll(start, end);
  if (!result.items.length) bad('Nothing to pay for this period');
  return { id: tx(() => savePayrollRun(result, req.user.id)) };
}));
app.get('/api/payroll/runs', managerOnly, route(() =>
  db.prepare('SELECT * FROM payroll_runs ORDER BY start_date DESC').all().map((r) => ({ ...r, totals: JSON.parse(r.totals_json) }))));
function runWithStubs(id) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id) || notFound('Payroll run not found');
  const stubs = db.prepare('SELECT * FROM pay_stubs WHERE run_id = ?').all(id).map((s) => ({ id: s.id, ...JSON.parse(s.data_json) }));
  return { ...run, totals: JSON.parse(run.totals_json), items: stubs };
}
app.get('/api/payroll/runs/:id', managerOnly, route((req) => runWithStubs(req.params.id)));
app.delete('/api/payroll/runs/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM payroll_runs WHERE id = ?').run(req.params.id);
  return { ok: true };
}));
app.get('/api/payroll/runs/:id/csv', managerOnly, (req, res, next) => {
  try {
    const run = runWithStubs(req.params.id);
    const cols = ['name', 'position_name', 'rate', 'regular_hours', 'overtime_hours', 'regular_pay', 'overtime_pay', 'tips', 'vacation_pay', 'gross', 'federal', 'quebec', 'qpp', 'ei', 'qpip', 'deductions', 'net', 'vacation_accrued', 'er_qpp', 'er_ei', 'er_qpip', 'er_hsf', 'er_cnt', 'er_cnesst'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(','), ...run.items.map((i) => cols.map((c) => q(i[c])).join(','))];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll_${run.start_date}_to_${run.end_date}.csv"`);
    res.send(lines.join('\r\n'));
  } catch (err) { next(err); }
});
app.get('/api/paystubs/mine', route((req) => {
  const rows = db.prepare(
    `SELECT s.id, s.data_json, r.start_date, r.end_date, r.created_at FROM pay_stubs s JOIN payroll_runs r ON r.id = s.run_id
      WHERE s.user_id = ? ORDER BY r.end_date DESC`
  ).all(req.user.id);
  return rows.map((r) => ({ id: r.id, start_date: r.start_date, end_date: r.end_date, created_at: r.created_at, ...JSON.parse(r.data_json) }));
}));

// ---------------------------------------------------------------- engage & log book
app.get('/api/announcements', route(() => db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 50').all()));
app.post('/api/announcements', managerOnly, route((req) => {
  const title = str(req.body.title, 120) || bad('Title is required');
  const body = str(req.body.body, 4000) || bad('Message is required');
  db.prepare('INSERT INTO announcements (author_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)').run(req.user.id, title, body, req.body.pinned ? 1 : 0, Date.now());
  return { ok: true };
}));
app.put('/api/announcements/:id', managerOnly, route((req) => {
  db.prepare('UPDATE announcements SET pinned = ? WHERE id = ?').run(req.body.pinned ? 1 : 0, req.params.id);
  return { ok: true };
}));
app.delete('/api/announcements/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  return { ok: true };
}));

app.get('/api/messages', route((req) => {
  const after = num(req.query.after, 0);
  return db.prepare('SELECT * FROM messages WHERE id > ? ORDER BY id DESC LIMIT 100').all(after).reverse();
}));
app.post('/api/messages', route((req) => {
  const body = str(req.body.body, 2000) || bad('Message is empty');
  db.prepare('INSERT INTO messages (author_id, body, created_at) VALUES (?, ?, ?)').run(req.user.id, body, Date.now());
  return { ok: true };
}));
app.delete('/api/messages/:id', route((req) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) || notFound();
  if (!req.isManager && m.author_id !== req.user.id) bad('You can only delete your own messages');
  db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
  return { ok: true };
}));

const LOG_CATEGORIES = ['general', 'maintenance', '86', 'incident', 'staff', 'guest'];
app.get('/api/logbook', managerOnly, route((req) => {
  const start = reqDate(req.query.start, 'start');
  const end = reqDate(req.query.end || start, 'end');
  return db.prepare('SELECT * FROM log_entries WHERE date BETWEEN ? AND ? ORDER BY date DESC, created_at DESC').all(start, end);
}));
app.post('/api/logbook', managerOnly, route((req) => {
  const date = reqDate(req.body.date);
  const category = LOG_CATEGORIES.includes(req.body.category) ? req.body.category : 'general';
  const body = str(req.body.body, 4000) || bad('Entry is empty');
  db.prepare('INSERT INTO log_entries (date, author_id, category, body, created_at) VALUES (?, ?, ?, ?, ?)').run(date, req.user.id, category, body, Date.now());
  return { ok: true };
}));
app.delete('/api/logbook/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM log_entries WHERE id = ?').run(req.params.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- tasks
app.get('/api/tasks', route((req) => {
  const date = isYmd(req.query.date) ? req.query.date : today();
  const lists = db.prepare("SELECT * FROM task_lists ORDER BY department, CASE timing WHEN 'opening' THEN 0 WHEN 'anytime' THEN 1 ELSE 2 END, name").all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort, id').all();
  const done = db.prepare('SELECT * FROM task_done WHERE date = ?').all(date);
  const doneBy = new Map(done.map((d) => [d.task_id, d]));
  return {
    date,
    lists: lists.map((l) => ({
      ...l,
      tasks: tasks.filter((t) => t.list_id === l.id).map((t) => ({ ...t, done: doneBy.get(t.id) || null })),
    })),
  };
}));
app.post('/api/tasks/toggle', route((req) => {
  const date = reqDate(req.body.date);
  const taskId = num(req.body.task_id, 0);
  const existing = db.prepare('SELECT 1 FROM task_done WHERE task_id = ? AND date = ?').get(taskId, date);
  if (existing) db.prepare('DELETE FROM task_done WHERE task_id = ? AND date = ?').run(taskId, date);
  else db.prepare('INSERT INTO task_done (task_id, date, user_id, done_at) VALUES (?, ?, ?, ?)').run(taskId, date, req.user.id, Date.now());
  return { ok: true };
}));
app.post('/api/task-lists', managerOnly, route((req) => {
  const name = str(req.body.name, 80) || bad('List name is required');
  const department = ['FOH', 'BOH', 'ALL'].includes(req.body.department) ? req.body.department : 'ALL';
  const timing = ['opening', 'closing', 'anytime'].includes(req.body.timing) ? req.body.timing : 'anytime';
  db.prepare('INSERT INTO task_lists (name, department, timing) VALUES (?, ?, ?)').run(name, department, timing);
  return { ok: true };
}));
app.delete('/api/task-lists/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM task_lists WHERE id = ?').run(req.params.id);
  return { ok: true };
}));
app.post('/api/task-lists/:id/tasks', managerOnly, route((req) => {
  const text = str(req.body.text, 200) || bad('Task text is required');
  const max = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM tasks WHERE list_id = ?').get(req.params.id).m;
  db.prepare('INSERT INTO tasks (list_id, text, sort) VALUES (?, ?, ?)').run(req.params.id, text, max + 1);
  return { ok: true };
}));
app.delete('/api/tasks/:id', managerOnly, route((req) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  return { ok: true };
}));

// ---------------------------------------------------------------- reports & dashboard
function report(start, end) {
  const sales = new Map(db.prepare('SELECT * FROM sales WHERE date BETWEEN ? AND ?').all(start, end).map((s) => [s.date, s]));
  const labor = actualLabor(start, end);
  const tipsByDay = new Map(db.prepare('SELECT date, SUM(amount) AS total FROM tip_pools WHERE date BETWEEN ? AND ? GROUP BY date').all(start, end).map((r) => [r.date, r.total]));
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const s = sales.get(d) || {};
    const l = labor[d] || { hours: 0, cost: 0, FOH: 0, BOH: 0 };
    days.push({
      date: d, projected: s.projected ?? null, sales: s.actual ?? null, covers: s.covers ?? null,
      labor_cost: l.cost, labor_hours: l.hours, foh_cost: l.FOH, boh_cost: l.BOH, tips: round2(tipsByDay.get(d) || 0),
    });
  }
  const sum = (k) => round2(days.reduce((a, d) => a + (d[k] || 0), 0));
  const withSales = days.filter((d) => d.sales !== null);
  const laborOnSalesDays = round2(withSales.reduce((a, d) => a + d.labor_cost, 0));
  const totals = {
    sales: sum('sales'),
    projected_on_sales_days: round2(withSales.reduce((a, d) => a + (d.projected || 0), 0)),
    labor_cost: sum('labor_cost'),
    labor_hours: sum('labor_hours'),
    covers: sum('covers'),
    tips: sum('tips'),
    labor_pct: sum('sales') ? laborOnSalesDays / sum('sales') : null,
    splh: sum('labor_hours') ? sum('sales') / sum('labor_hours') : null,
    avg_check: sum('covers') ? sum('sales') / sum('covers') : null,
    foh_cost: sum('foh_cost'),
    boh_cost: sum('boh_cost'),
  };

  const punches = db.prepare('SELECT * FROM punches WHERE clock_in >= ? AND clock_in < ?').all(msAt(start, '00:00'), msAt(addDays(end, 1), '00:00'));
  const tipsByUser = new Map(db.prepare(
    'SELECT a.user_id, SUM(a.amount) AS total FROM tip_allocations a JOIN tip_pools t ON t.id = a.pool_id WHERE t.date BETWEEN ? AND ? GROUP BY a.user_id'
  ).all(start, end).map((r) => [r.user_id, r.total]));
  const users = db.prepare('SELECT u.id, u.name, u.hourly_rate, u.position_id FROM users u').all();
  const employees = users.map((u) => {
    const mine = punches.filter((p) => p.user_id === u.id);
    const hours = round2(mine.reduce((a, p) => a + punchHours(p), 0));
    return { user_id: u.id, name: u.name, position_id: u.position_id, hours, shifts: mine.length, labor_cost: round2(hours * u.hourly_rate), tips: round2(tipsByUser.get(u.id) || 0) };
  }).filter((e) => e.hours > 0 || e.tips > 0).sort((a, b) => b.hours - a.hours);
  return { start, end, days, totals, employees };
}
app.get('/api/reports', managerOnly, route((req) => {
  const start = reqDate(req.query.start, 'start');
  const end = reqDate(req.query.end, 'end');
  if (end < start) bad('End date is before start date');
  return report(start, end);
}));

app.get('/api/dashboard', route((req) => {
  const t = today();
  const settings = getSettings();
  const grace = (Number(settings.late_grace_min) || 5) * 60000;
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 3').all();
  const now = Date.now();

  if (!req.isManager) {
    const me = req.user.id;
    const nowHm = new Date(now).toTimeString().slice(0, 5);
    const upcoming = db.prepare('SELECT * FROM shifts WHERE user_id = ? AND date >= ? AND published = 1 ORDER BY date, start LIMIT 7').all(me, t)
      .filter((s) => s.date > t || s.end > nowHm || s.end <= s.start) // drop today's shifts that already ended
      .slice(0, 6);
    const wk = weekStart(t);
    const weekPunches = db.prepare('SELECT * FROM punches WHERE user_id = ? AND clock_in >= ?').all(me, msAt(wk, '00:00'));
    const weekTips = db.prepare('SELECT COALESCE(SUM(a.amount),0) AS t FROM tip_allocations a JOIN tip_pools p ON p.id = a.pool_id WHERE a.user_id = ? AND p.date >= ?').get(me, wk).t;
    const openShifts = db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE user_id IS NULL AND published = 1 AND date >= ?').get(t).n;
    const swapOffers = db.prepare("SELECT COUNT(*) AS n FROM shift_requests r JOIN shifts s ON s.id = r.shift_id WHERE r.type = 'drop' AND r.status = 'open' AND r.requester_id != ? AND (r.target_id IS NULL OR r.target_id = ?) AND s.date >= ?").get(me, me, t).n;
    return {
      role: 'employee', upcoming, clock: clockStatus(me), announcements,
      week_hours: round2(weekPunches.reduce((a, p) => a + punchHours(p, now), 0)),
      week_scheduled: round2(db.prepare('SELECT * FROM shifts WHERE user_id = ? AND date BETWEEN ? AND ? AND published = 1').all(me, wk, addDays(wk, 6)).reduce((a, s) => a + shiftHours(s), 0)),
      week_tips: round2(weekTips), open_shifts: openShifts + swapOffers,
    };
  }

  const shifts = db.prepare('SELECT * FROM shifts WHERE date = ? AND user_id IS NOT NULL ORDER BY start').all(t);
  const punches = db.prepare('SELECT * FROM punches WHERE clock_in >= ? OR clock_out IS NULL').all(msAt(t, '00:00'));
  const roster = shifts.map((s) => {
    const p = punches.find((x) => x.user_id === s.user_id && (x.shift_id === s.id || !x.shift_id));
    const startMs = msAt(t, s.start);
    let status = 'upcoming';
    if (p && !p.clock_out) status = p.break_start ? 'on_break' : 'working';
    else if (p && p.clock_out) status = 'done';
    else if (now > startMs + grace) status = 'late';
    const lateBy = p ? Math.round((p.clock_in - startMs) / 60000) : Math.round((now - startMs) / 60000);
    return { shift: s, punch: p || null, status, late_minutes: lateBy > (grace / 60000) ? lateBy : 0 };
  });
  const unscheduled = punches.filter((p) => !p.clock_out && !shifts.some((s) => s.user_id === p.user_id));
  const sale = db.prepare('SELECT * FROM sales WHERE date = ?').get(t) || {};
  const scheduledLabor = laborForShifts(shifts);
  const pending = {
    time_off: db.prepare("SELECT COUNT(*) AS n FROM time_off WHERE status = 'pending'").get().n,
    swaps: db.prepare("SELECT COUNT(*) AS n FROM shift_requests WHERE status = 'claimed'").get().n,
    punches: db.prepare('SELECT COUNT(*) AS n FROM punches WHERE approved = 0 AND clock_out IS NOT NULL').get().n,
    unpublished: db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE published = 0 AND date >= ?').get(t).n,
  };
  const taskRows = db.prepare('SELECT COUNT(*) AS total, (SELECT COUNT(*) FROM task_done WHERE date = ?) AS done FROM tasks').get(t);
  return {
    role: 'manager', today: t, roster, unscheduled, announcements, pending,
    sales_today: { projected: sale.projected ?? null, actual: sale.actual ?? null },
    scheduled_labor: scheduledLabor,
    clocked_in: punches.filter((p) => !p.clock_out).length,
    trend: report(addDays(t, -14), addDays(t, -1)).days,
    tasks: taskRows,
    labor_target_pct: Number(settings.labor_target_pct) || 0,
  };
}));

// ---------------------------------------------------------------- errors & SPA
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = Number(process.env.PORT) || 3100;
app.listen(PORT, () => console.log(`ShiftHub running at http://localhost:${PORT}`));
