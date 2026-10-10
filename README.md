# BepShift

BepShift is a restaurant team management web app built for Bếp · Cuisine Vietnamienne. It includes scheduling, employee accounts, attendance, tips, payroll estimates, and restaurant performance reports.

The app uses Node.js, Express, and vanilla JavaScript. Local installations use SQLite; the hosted app uses a Turso libSQL database through `@libsql/client`.

## Run locally

Requires Node.js **22.13 or newer**. The hosting configuration specifies Node.js 24.19.0.

```powershell
npm ci
npm start
```

Open http://localhost:3100. Use `npm run dev` to restart automatically when server files change. Set `PORT` to use another port.

On the first development start with an empty database, the app creates demo restaurant data. Local records are stored in `data/shifthub.db`; the filename is retained for compatibility with existing installations.

### Local demo accounts

| Role | Email | Password |
|---|---|---|
| Manager | `manager@shifthub.test` | `manager123` |
| Employee | `maya@shifthub.test` | `employee123` |

Other seeded employees use their first name at `shifthub.test` and `employee123`. These addresses are retained for compatibility. Production startup rejects databases containing these demo accounts.

`npm run reset` **deletes the default local database and its journal files**. Stop the server first. The next development start loads demo data again. This command does not reset Turso or a custom `DATA_DIR`. Back up records before using it.

Windows launch helpers are `Start-ShiftHub.ps1` and `Stop-ShiftHub.ps1`. Their filenames are retained so existing desktop shortcuts continue working. `Start-Blank-Test.ps1` opens the separate test installation on port 3101; it does not create a new blank manager account by itself.

## Features

| Area | Current behavior |
|---|---|
| Dashboard | Manager restaurant overview; employee shifts, hours and tips. Every successful sign-in opens Dashboard. |
| Schedules | Weekly grid, departments, open shifts, availability/time-off warnings, editable/addable/removable presets, copy last week, publish, and clear-week confirmation. Managers can drag a shift to another day in the same employee row to copy it as a draft. |
| Shift labels | Full shifts occupy the full cell; AM shifts occupy its left half and PM shifts its right half, based on the configured morning/night cutoff. |
| Time Clock | Day or week view, employee filter, add/edit/delete/approve punches, current attendance and hours. Published shifts for today generate clearly labeled, unapproved estimates. Deleting a linked punch prevents automatic regeneration for that employee and shift. |
| Tablet Time Clock | Dedicated workplace keypad, manager activation, four-digit work IDs, shift selection, explicit Start shift, punch-out confirmation and automatic reset. No break option is offered on the tablet. |
| Team | Managers first, then FOH and BOH; positions, pay rates, access and active status. Managers can manage employee availability and work IDs. New cook positions default to $20/hour in Add Employee; existing pay rates are preserved. |
| Requests | Time-off requests, shift pickups/swaps and weekly availability. |
| Tasks / Engage | Checklists, announcements and team chat. |
| Tips | Morning/night or whole-day pools, role-point distribution, or exact manual amounts for FOH workers with recorded hours. Preview before saving; employee totals support weekly viewing. Date worked defaults to today. |
| Moneris import | Import card-tip totals from a CSV report, review mapped columns and add cash tips. This is a file import, not a live terminal connection. Manual tip mode disables import. |
| Payroll / My Pay | Approved completed hours, distributed tips, configured overtime, estimated deductions/contributions, payroll history, printable stubs and CSV export. The first Next pay period starts in the current week; subsequent periods follow the latest saved run. |
| Reports / Log Book | Sales and labor comparisons, daily sales entry, CSV export and manager notes. |

Historical tip pools using hours or equal splitting remain readable, but these methods are no longer offered as new manual-form choices. The proposed 3% sales deduction from tips is **on hold and not implemented**.

## Set up the workplace tablet

1. Sign in as a manager on the tablet.
2. Open the account menu (initials at the top right) → **Tablet Time Clock**. The direct path is `/kiosk.html`.
3. Tap **Activate tablet**. Activation pairs that browser and signs the manager out.
4. Employees enter their four-digit ID and tap **Sign In** to see their shift. **Start shift** records attendance; **End shift** leads to punch-out confirmation.

The default ID is the last four numeric digits of the employee's phone number. Missing phone numbers and duplicate IDs require a manager-assigned unique ID under **Team → employee → Work ID**. This code is for the paired punch tablet, not an account password.

Pairing lasts up to one year and is stored in a browser cookie. Clearing cookies or changing browsers requires reactivation. Internet access is required; offline punching is not supported. The Full screen button depends on browser support. Use the tablet's device settings to keep the screen awake and restrict access to the workplace browser.

## Appearance and devices

Managers can switch between **Bếp** colors and **Classic** from Settings or the account menu. Both use the same font family. The application name is BepShift.

Touch-tablet styles improve form fields, touch targets and scrolling. Phone-only styles at widths up to 600 pixels keep wide tables inside horizontal scroll containers. The tablet punch page has its own responsive layout. Desktop schedules support drag-to-copy; tablet drag support depends on the browser.

## Attendance, tips and payroll

- Scheduled attendance is an **estimate**, not confirmation that an employee actually worked. Review attendance and times before approval. Real clock-ins replace linked unapproved estimates.
- Payroll uses approved, completed punches and saved tip allocations. It does not send payments, file returns, or remit deductions.
- Role-point tips use recorded hours in each period multiplied by the shift position's tip points, with the employee's primary position as fallback. The cutoff is configurable; short overlaps under 15 minutes do not qualify for a separate morning/night share.
- Manual amounts are entered per eligible FOH worker and period. Their sum becomes the pool total. The server checks eligibility and totals before saving; saved tips feed payroll.
- Payroll rates and formulas live in `server/rates-qc.js` and `server/payroll.js`. Settings control overtime, pay frequency, minimum-wage warnings and vacation treatment. Review these settings and verify estimates with your payroll provider before paying staff. Rates are not automatically updated from government sources.

## Hosting

See [DEPLOYMENT.md](DEPLOYMENT.md) for Render and Turso setup. GitHub Pages cannot run this backend.

The supplied `render.yaml` uses a free Render web service and an external Turso **libSQL-compatible** database. Local data is not uploaded automatically. Provider allowances and free-plan behavior can change; check their current terms when deploying.

| Environment variable | Purpose |
|---|---|
| `NODE_ENV` | Set to `production` on the hosted service. |
| `TURSO_DATABASE_URL` | Cloud libSQL database URL. Omit locally to use SQLite. |
| `TURSO_AUTH_TOKEN` | Private cloud database token. |
| `ADMIN_EMAIL` | Initial manager email for a new production database. |
| `ADMIN_PASSWORD` | Initial manager password, at least 16 characters. Only used when the database has no users. |
| `APP_URL` | Public HTTPS origin; Render's `RENDER_EXTERNAL_URL` is used if omitted. Set this for a custom domain. |
| `TZ` | Use `America/Toronto` for the restaurant. |
| `EMPLOYEE_ACCESS` | Enabled by default. Set to `false` for manager-only account access. |
| `DATA_DIR` | Local database folder; does not control Turso storage. |
| `PORT` | Server port, defaults to 3100 locally. Render supplies its own port. |

Database credentials belong in the host's private environment settings, never in frontend files or GitHub. `.env` files, `data/` and `node_modules/` are ignored by Git. The app reads environment variables supplied to its process; it does not automatically load a `.env` file.

The service exposes `/healthz`. Passwords use scrypt; sessions use HttpOnly cookies and Secure cookies in production. Manager permissions are checked by the API, production writes validate the request origin, and login/tablet attempts are rate limited. Keep database backups and verify restoration. The database worker has a bounded reusable response buffer and executes queries sequentially.

When a free hosting service sleeps, background attendance sync stops. It resumes for the current day when the app wakes; it does not automatically backfill all earlier missed dates.

## Project layout

```text
server/
  index.js             API routes, authentication and permissions
  db.js                Schema, local/cloud database selection and settings
  cloud-db.js          Synchronous adapter to the database worker
  cloud-db-worker.js    libSQL queries and transactions
  scheduled-punches.js  Scheduled estimates and deletion suppression
  kiosk.js             Tablet pairing, work IDs and punch endpoints
  tips.js              Role-point and manual tip allocation
  payroll.js           Payroll calculations and saved runs
  rates-qc.js          Quebec/federal payroll rate data
  seed.js              Local demo records
public/
  index.html           Main application
  kiosk.html           Workplace tablet screen
  css/app.css          Themes and responsive styles
  js/app.js            Navigation and account menu
  js/ui.js             Shared UI helpers
  js/kiosk.js          Tablet punch flow
  js/pages/            Feature pages
render.yaml            Render hosting configuration
DEPLOYMENT.md          Deployment walkthrough
```
