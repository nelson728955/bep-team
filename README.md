# ShiftHub

Restaurant team management, in the spirit of 7shifts: scheduling, time clock, tip pooling, payroll, and performance reports, with separate manager and employee views.

## Run it

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
npm start
```

Open http://localhost:3100. On first start the app creates `data/shifthub.db` and fills it with a demo restaurant: 10 employees, 5 weeks of shifts, punches, sales, tips, and one past payroll run.

### Demo accounts (local test data only)

| Role     | Email                    | Password      |
|----------|--------------------------|---------------|
| Manager  | `manager@shifthub.test`  | `manager123`  |
| Employee | `maya@shifthub.test`     | `employee123` |

Every demo employee signs in as `<firstname>@shifthub.test` with `employee123` (jordan, ava, priya, luis, sam, marcus, elena, tom, dev).

To wipe everything and start over, run `npm run reset`, then `npm start`. To start with your own team, sign in as the manager, add your people under **More → Team**, and deactivate the demo staff (or reset and edit `server/seed.js`).

## Features

| Area | Managers | Employees |
|------|----------|-----------|
| **Dashboard** | Today's projected sales, scheduled labor %, who's in, late or no-shows, pending approvals, 14-day sales and labor charts | Clock in/out, next shifts, hours and tips this week |
| **Schedules** | Weekly grid by department, open shifts, draft/publish, copy last week, shift templates, warnings for time off, availability, overlaps, and overtime, **budget tool** (projected vs. actual sales, scheduled vs. actual labor %) | See the published schedule, offer a shift to anyone or to one coworker, request open shifts |
| **Time Clock** | Timesheets with late/early flags, edit, add, and approve punches, see who's on the clock | Clock in, breaks, clock out, own timesheet |
| **Requests** | Approve time off and swaps, see team availability | Request time off, pick up shifts, set weekly availability |
| **Tasks** | Build opening and closing checklists | Check off tasks, with who did it and when |
| **Engage** | Post and pin announcements | Team chat (refreshes every 5 seconds) |
| **Tips** | Separate **morning and night** tip pots (or one whole-day pot), split by hours, by role points, or equally, with a preview before distributing | My tips (morning vs. night) and average per hour |
| **Payroll / My Pay** | Pay-period preview (regular pay, weekly overtime, tips, estimated taxes, net), run payroll, pay stubs, CSV export | Pay stubs (printable), year-to-date totals |
| **Reports** | Sales vs. projected, labor %, sales per labor hour, covers, average check, weekday averages, labor by department and employee, daily sales entry, CSV export | – |
| **Log Book** | Daily manager notes (maintenance, 86'd items, incidents) next to that day's numbers | – |

## Look and feel

The app ships with two looks, and managers choose one for everyone:

- **Bếp** (default): built from the restaurant logo (`public/img/bep-logo.png`). It uses the logo's dark lacquer brown, noodle gold, and rice-paper cream, with Playfair Display headings.
- **Classic**: the original ShiftHub purple and orange.

To switch, go to **More → Settings → Appearance**, or use the account menu (top right) → *Switch to classic look / Switch to Bếp look*. All theme colors live in `public/css/app.css`, under the `[data-theme="bep"]` block.

## How the numbers work

- **Labor cost** = hours × hourly rate. Scheduled labor uses shift length minus the unpaid break. Actual labor uses punches.
- **Overtime** is paid after 40 hours a week (Monday to Sunday) at 1.5×, as Québec labour standards require.
- **Payroll** only counts **approved, completed** punches. Anything else shows as a warning on the payroll page.
- **Québec payroll (2026 rates)**: federal income tax (with the 16.5% Québec abatement), Québec income tax (with the 6% deduction for workers, up to $1,450), QPP (6.3%, plus QPP2 above $74,600), EI at the Québec rate (1.30%), and QPIP (0.43%). Annual maximums are tracked from earlier pay stubs in the same year. Employer contributions are also calculated: the QPP match, EI at 1.4×, QPIP (0.602%), HSF (default 1.65%), CNT (0.06%), and optionally CNESST. The payroll page shows a remittance summary for Revenu Québec and the CRA. All rates live in `server/rates-qc.js`, with sources. **Update that file every January 1.** These are estimates, not a certified payroll calculation. Check them against Revenu Québec's WebRAS calculator or a payroll provider. ShiftHub does not remit or file anything.
- **Vacation pay** is 4%, or 6% after 3 years of service (based on hire date), including tips. It is accrued by default, or can be added to every pay (Settings).
- **Minimum wage**: $16.60 general and $13.30 for employees receiving tips (May 1, 2026). Positions with tip points use the tipped rate. Wages below the minimum are flagged on the Team and Payroll pages. Update both rates in Settings every May 1.
- **Morning / night tips**: hours before the cutoff (Settings, default 4:00 PM) count toward the morning pot, and hours after it toward the night pot. A double shift earns from both pots by its hours on each side. Less than 15 minutes on one side (e.g. clocking in at 3:55 for a 4:00 shift) does not count. Each date and shift can only be paid out once.
- **Moneris card tips**: on the Tips page, click *Import Moneris report* and upload the CSV export of the Moneris Go portal's Financial transactions report. ShiftHub totals card tips per day, split into morning and night by transaction time (sales before 4:00 AM count toward the previous night). It subtracts refunds and voids, ignores declined payments and uncompleted pre-authorizations, and lets you add cash tips before distributing. Days already paid out are skipped. Column names are detected automatically, including French exports. If detection misses, pick the columns by hand, and the choice is remembered in that browser. The file is read in the browser, and only tip totals are saved.
- **Tip points**: each position has a weight (e.g. Server 1.0, Busser 0.5). With the *role points* method, a person's share is hours × points.

## Project layout

```
server/
  index.js    Express API routes, auth, and permissions
  db.js       SQLite schema and settings
  payroll.js  Overtime and tax estimate logic
  tips.js     Tip pool split
  seed.js     Demo data
public/
  index.html, css/app.css
  js/app.js       Shell, navigation, router
  js/ui.js        API client, formatting, modals, charts
  js/pages/*.js   One module per screen
```

Passwords are hashed with scrypt, and sessions are HTTP-only cookies. Every manager-only endpoint is checked on the server. Before exposing this to the internet, put it behind HTTPS and add login rate limiting.
