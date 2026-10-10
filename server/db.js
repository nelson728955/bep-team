import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudDatabase } from './cloud-db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'shifthub.db');

const cloudUrl = process.env.TURSO_DATABASE_URL;
if (cloudUrl && !process.env.TURSO_AUTH_TOKEN && !cloudUrl.startsWith('file:')) throw new Error('Set TURSO_AUTH_TOKEN for the cloud database.');
if (!cloudUrl && process.env.RENDER && process.env.NODE_ENV === 'production') throw new Error('Set TURSO_DATABASE_URL to keep hosted data persistent.');
if (!cloudUrl) fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = cloudUrl ? cloudDatabase(cloudUrl, process.env.TURSO_AUTH_TOKEN) : new DatabaseSync(DB_PATH);
if (!cloudUrl) db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,            -- 'FOH' | 'BOH'
  color TEXT NOT NULL DEFAULT '#2a78d6',
  tip_points REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', -- 'manager' | 'employee'
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  hourly_rate REAL NOT NULL DEFAULT 13.30,
  filing_status TEXT NOT NULL DEFAULT 'single', -- 'single' | 'married' | 'head'
  extra_withholding REAL NOT NULL DEFAULT 0,
  td1_federal REAL,                     -- TD1 claim amount; NULL = basic personal amount
  td1_quebec REAL,                      -- TP-1015.3 claim amount; NULL = basic personal amount
  hire_date TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL = open shift
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  break_min INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shifts_date ON shifts(date);

CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  clock_in INTEGER NOT NULL,     -- epoch ms
  clock_out INTEGER,
  break_start INTEGER,           -- set while on break
  break_min REAL NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS punches_in ON punches(clock_in);
CREATE TABLE IF NOT EXISTS suppressed_scheduled_punches (
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (shift_id, user_id)
);

CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS availability (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,              -- Mon=0 … Sun=6
  status TEXT NOT NULL DEFAULT 'available', -- available | unavailable | partial
  start TEXT,
  end TEXT,
  PRIMARY KEY (user_id, weekday)
);

CREATE TABLE IF NOT EXISTS shift_requests (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- 'drop' (offer my shift) | 'pickup' (claim an open shift)
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- specific coworker for a swap, or NULL
  claimer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | claimed | approved | denied | cancelled
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  date TEXT PRIMARY KEY,
  projected REAL,
  actual REAL,
  covers INTEGER
);

CREATE TABLE IF NOT EXISTS tip_pools (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,                -- hours | points | equal
  period TEXT NOT NULL DEFAULT 'all',  -- morning | night | all
  position_ids TEXT NOT NULL,          -- JSON array
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tip_allocations (
  pool_id INTEGER NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours REAL NOT NULL,
  weight REAL NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS log_entries (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'ALL', -- FOH | BOH | ALL
  timing TEXT NOT NULL DEFAULT 'opening'  -- opening | closing | anytime
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_done (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, date)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  totals_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pay_stubs (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL
);
`);

// Migrations for databases created before a column existed.
for (const col of ['td1_federal', 'td1_quebec']) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = ?").get(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} REAL`);
}
if (!db.prepare("SELECT 1 FROM pragma_table_info('tip_pools') WHERE name = 'period'").get()) {
  db.exec("ALTER TABLE tip_pools ADD COLUMN period TEXT NOT NULL DEFAULT 'all'");
}

if (!db.prepare("SELECT 1 FROM pragma_table_info('punches') WHERE name = 'estimated'").get()) db.exec('ALTER TABLE punches ADD COLUMN estimated INTEGER NOT NULL DEFAULT 0');

export const DEFAULT_SETTINGS = {
  shift_templates: JSON.stringify([['Lunch','10:30','15:00',0],['Dinner','16:00','22:00',0],['Double','11:00','19:00',0],['BOH AM','08:00','15:00',0],['BOH PM','14:30','22:30',0]]),
  restaurant_name: 'My Restaurant',
  labor_target_pct: '28',
  ot_threshold: '40',
  ot_multiplier: '1.5',
  hsf_rate_pct: '1.65', // Health Services Fund: 1.65% for most employers with payroll up to $1M
  cnesst_rate_pct: '0', // workplace insurance rate from your CNESST notice
  vacation_pay_mode: 'accrue', // accrue (pay out at vacation time) | each_pay (add 4%/6% to every cheque)
  min_wage: '16.60',
  min_wage_tipped: '13.30',
  pay_frequency: 'biweekly', // weekly | biweekly | semimonthly
  late_grace_min: '5',
  tip_split_time: '16:00', // morning tips = before this time, night tips = after
  theme: 'bep', // bep (restaurant branding) | classic (original BepShift look)
};

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

export function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
