import { db, getSettings } from './db.js';
import { QC_RATES as R } from './rates-qc.js';
import { addDays, msAt, parseYmd, punchHours, round2, weekStart, dateOfMs } from './util.js';

// Québec source deductions, following the structure of the CRA (T4127) and Revenu Québec (TP-1015.F)
// formulas in simplified form. These are estimates; confirm with Revenu Québec's WebRAS or your payroll provider.

function bracketTax(income, brackets) {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of brackets) {
    if (income <= lower) break;
    tax += (Math.min(income, upper) - lower) * rate;
    lower = upper;
  }
  return tax;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Deductions for one pay.
 *  gross       taxable and pensionable earnings this pay (wages + overtime + employer-distributed tips + vacation pay if paid out)
 *  periodDays  length of the pay period, used to annualize income
 *  ytd         contributions and earnings already paid this calendar year (so annual maximums are respected)
 *  emp         { td1_federal, td1_quebec, extra_withholding }
 */
export function quebecDeductions(gross, periodDays, ytd, emp = {}) {
  const P = 365 / Math.max(1, periodDays); // pay periods per year
  const q = R.qpp;

  // QPP base + first additional (6.3%), above the prorated basic exemption, up to the annual maximum.
  const qpp = round2(clamp(q.rate * Math.max(0, gross - q.basicExemption / P), 0, q.maxContribution - (ytd.qpp || 0)));
  // QPP2: 4% on the slice of year-to-date earnings between the two ceilings.
  const before = ytd.gross || 0;
  const qpp2Slice = clamp(before + gross, q.maxPensionable, q.maxPensionableAdditional) - clamp(before, q.maxPensionable, q.maxPensionableAdditional);
  const qpp2 = round2(q.secondAdditionalRate * qpp2Slice);
  const ei = round2(clamp(R.ei.rate * gross, 0, R.ei.maxPremium - (ytd.ei || 0)));
  const qpip = round2(clamp(R.qpip.rate * gross, 0, R.qpip.maxPremium - (ytd.qpip || 0)));

  // The "enhanced" QPP portions are deducted from income (federal and Québec) rather than credited.
  const enhanced = qpp * (q.firstAdditionalRate / q.rate) + qpp2;
  const annualIncome = P * (gross - enhanced);

  // Federal: brackets − credits (personal amount, QPP base, EI, QPIP, Canada employment amount), then the 16.5% Québec abatement.
  const f = R.federal;
  const fedCredits = f.lowestRate * (
    (emp.td1_federal ?? f.basicPersonalAmount)
    + Math.min(P * qpp * (q.baseRate / q.rate), q.baseRate * (q.maxPensionable - q.basicExemption))
    + Math.min(P * ei, R.ei.maxPremium)
    + Math.min(P * qpip, R.qpip.maxPremium)
    + Math.min(Math.max(0, annualIncome), f.canadaEmploymentAmount)
  );
  const fedAnnual = Math.max(0, bracketTax(annualIncome, f.brackets) - fedCredits) * (1 - f.quebecAbatement);
  const federal = gross > 0 ? round2(fedAnnual / P + (emp.extra_withholding || 0)) : 0;

  // Québec: 6% deduction for workers (capped), then the personal amount credit. No credits for QPP/EI/QPIP.
  const qc = R.quebec;
  const qcIncome = Math.max(0, annualIncome - Math.min(qc.workerDeductionRate * P * gross, qc.workerDeductionMax));
  const qcAnnual = Math.max(0, bracketTax(qcIncome, qc.brackets) - qc.lowestRate * (emp.td1_quebec ?? qc.basicPersonalAmount));
  const quebec = gross > 0 ? round2(qcAnnual / P) : 0;

  return { federal, quebec, qpp: round2(qpp + qpp2), qpp_base: qpp, qpp2, ei, qpip };
}

/** Employer contributions for one pay (not deducted from the employee). */
export function employerContributions(gross, ded, ytd, settings) {
  const hsfRate = (Number(settings.hsf_rate_pct) || 0) / 100;
  const cnesstRate = (Number(settings.cnesst_rate_pct) || 0) / 100;
  const cntBase = clamp(R.cnt.maxEarnings - (ytd.gross || 0), 0, gross);
  return {
    er_qpp: ded.qpp, // employer matches QPP (including QPP2)
    er_ei: round2(ded.ei * R.ei.employerMultiplier),
    er_qpip: round2(clamp(R.qpip.employerRate * gross, 0, R.qpip.maxEmployer - (ytd.er_qpip || 0))),
    er_hsf: round2(hsfRate * gross),
    er_cnt: round2(R.cnt.rate * cntBase),
    er_cnesst: round2(cnesstRate * gross),
  };
}

/** Year-to-date contributions per employee from pay stubs already saved this calendar year, before `start`. */
function yearToDate(start) {
  const year = start.slice(0, 4);
  const rows = db.prepare(
    `SELECT s.user_id, s.data_json FROM pay_stubs s JOIN payroll_runs r ON r.id = s.run_id
      WHERE r.end_date >= ? AND r.end_date < ?`
  ).all(`${year}-01-01`, start);
  const out = new Map();
  for (const row of rows) {
    const d = JSON.parse(row.data_json);
    if (d.qpp_base === undefined) continue; // stub from before Québec payroll
    const cur = out.get(row.user_id) || { gross: 0, qpp: 0, ei: 0, qpip: 0, er_qpip: 0 };
    cur.gross += d.gross; cur.qpp += d.qpp_base; cur.ei += d.ei; cur.qpip += d.qpip; cur.er_qpip += d.er_qpip || 0;
    out.set(row.user_id, cur);
  }
  return out;
}

export function yearsOfService(hireDate, asOf) {
  if (!hireDate) return 0;
  return (parseYmd(asOf) - parseYmd(hireDate)) / (365.25 * 86400000);
}

/** Build a payroll for [start, end] inclusive from approved punches and distributed tips. */
export function computePayroll(start, end) {
  const settings = getSettings();
  const otThreshold = Number(settings.ot_threshold) || 40;
  const otMult = Number(settings.ot_multiplier) || 1.5;
  const payVacation = settings.vacation_pay_mode === 'each_pay';
  const from = msAt(start, '00:00');
  const to = msAt(addDays(end, 1), '00:00');
  const periodDays = Math.round((parseYmd(end) - parseYmd(start)) / 86400000) + 1;
  const minGeneral = Number(settings.min_wage) || R.minimumWage.general;
  const minTipped = Number(settings.min_wage_tipped) || R.minimumWage.tipped;

  const users = db
    .prepare(
      `SELECT u.*, pos.name AS position_name, pos.tip_points FROM users u
         LEFT JOIN positions pos ON pos.id = u.position_id
        WHERE u.active = 1 ORDER BY u.name`
    )
    .all();
  const punches = db.prepare('SELECT * FROM punches WHERE clock_in >= ? AND clock_in < ?').all(from, to);
  const tips = db
    .prepare(
      `SELECT a.user_id, SUM(a.amount) AS total FROM tip_allocations a
         JOIN tip_pools t ON t.id = a.pool_id
        WHERE t.date BETWEEN ? AND ? GROUP BY a.user_id`
    )
    .all(start, end);
  const tipsBy = new Map(tips.map((t) => [t.user_id, t.total]));
  const ytdBy = yearToDate(start);

  const warnings = [];
  const unapproved = punches.filter((p) => !p.approved && p.clock_out).length;
  const open = punches.filter((p) => !p.clock_out).length;
  if (unapproved) warnings.push(`${unapproved} completed punch(es) in this period are not approved yet and are excluded.`);
  if (open) warnings.push(`${open} punch(es) are still open (employee has not clocked out) and are excluded.`);
  if (start.slice(0, 4) !== String(R.year) || end.slice(0, 4) !== String(R.year)) {
    warnings.push(`Tax rates are set for ${R.year}. Update server/rates-qc.js before running payroll for another year.`);
  }
  if (start.slice(0, 4) !== end.slice(0, 4)) warnings.push('This period crosses into a new year. Run each year separately so annual maximums reset correctly.');

  const items = [];
  for (const u of users) {
    const mine = punches.filter((p) => p.user_id === u.id && p.approved && p.clock_out);
    const weeks = new Map();
    for (const p of mine) {
      const wk = weekStart(dateOfMs(p.clock_in));
      weeks.set(wk, (weeks.get(wk) || 0) + punchHours(p));
    }
    let regular = 0;
    let overtime = 0;
    for (const hrs of weeks.values()) {
      regular += Math.min(hrs, otThreshold);
      overtime += Math.max(0, hrs - otThreshold);
    }
    regular = round2(regular);
    overtime = round2(overtime);
    const tipsTotal = round2(tipsBy.get(u.id) || 0);
    const regularPay = round2(regular * u.hourly_rate);
    const overtimePay = round2(overtime * u.hourly_rate * otMult);
    const earnings = round2(regularPay + overtimePay + tipsTotal);
    if (earnings <= 0) continue;

    // Québec vacation indemnity: 4%, or 6% after 3 years of uninterrupted service. Tips count toward it.
    const vacationRate = yearsOfService(u.hire_date, end) >= 3 ? 0.06 : 0.04;
    const vacation = round2(earnings * vacationRate);
    const gross = round2(earnings + (payVacation ? vacation : 0));

    const tipped = (u.tip_points ?? 0) > 0;
    const minimum = tipped ? minTipped : minGeneral;
    if (u.hourly_rate > 0 && u.hourly_rate < minimum) {
      warnings.push(`${u.name} is paid $${u.hourly_rate.toFixed(2)}/hr, below the Québec ${tipped ? 'minimum for employees receiving tips' : 'minimum wage'} ($${minimum.toFixed(2)}).`);
    }

    const ytd = ytdBy.get(u.id) || {};
    const ded = quebecDeductions(gross, periodDays, ytd, u);
    const er = employerContributions(gross, ded, ytd, settings);
    const deductions = round2(ded.federal + ded.quebec + ded.qpp + ded.ei + ded.qpip);
    items.push({
      user_id: u.id,
      name: u.name,
      position_name: u.position_name,
      rate: u.hourly_rate,
      regular_hours: regular,
      overtime_hours: overtime,
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      tips: tipsTotal,
      vacation_rate: vacationRate,
      vacation_pay: payVacation ? vacation : 0,
      vacation_accrued: payVacation ? 0 : vacation,
      gross,
      ...ded,
      deductions,
      net: round2(gross - deductions),
      ...er,
      employer_total: round2(er.er_qpp + er.er_ei + er.er_qpip + er.er_hsf + er.er_cnt + er.er_cnesst),
    });
  }

  const sum = (k) => round2(items.reduce((s, i) => s + (i[k] || 0), 0));
  const totals = {
    employees: items.length,
    regular_hours: sum('regular_hours'),
    overtime_hours: sum('overtime_hours'),
    tips: sum('tips'),
    gross: sum('gross'),
    federal: sum('federal'),
    quebec: sum('quebec'),
    qpp: sum('qpp'),
    ei: sum('ei'),
    qpip: sum('qpip'),
    net: sum('net'),
    vacation_accrued: sum('vacation_accrued'),
    vacation_pay: sum('vacation_pay'),
    employer_taxes: sum('employer_total'),
    er_qpp: sum('er_qpp'), er_ei: sum('er_ei'), er_qpip: sum('er_qpip'), er_hsf: sum('er_hsf'), er_cnt: sum('er_cnt'), er_cnesst: sum('er_cnesst'),
    // What the restaurant sends to the governments for this pay: employee deductions + employer contributions.
    remittance: round2(sum('federal') + sum('quebec') + sum('qpp') + sum('ei') + sum('qpip') + sum('employer_total') - sum('er_cnesst')),
  };
  return {
    start, end, items, totals, warnings: [...new Set(warnings)],
    settings: { pay_frequency: settings.pay_frequency, ot_multiplier: otMult, ot_threshold: otThreshold, tax_year: R.year, vacation_pay_mode: payVacation ? 'each_pay' : 'accrue' },
  };
}

export function savePayrollRun(result, userId) {
  const run = db
    .prepare('INSERT INTO payroll_runs (start_date, end_date, created_by, created_at, totals_json) VALUES (?, ?, ?, ?, ?)')
    .run(result.start, result.end, userId, Date.now(), JSON.stringify(result.totals));
  const ins = db.prepare('INSERT INTO pay_stubs (run_id, user_id, data_json) VALUES (?, ?, ?)');
  for (const item of result.items) ins.run(run.lastInsertRowid, item.user_id, JSON.stringify(item));
  return Number(run.lastInsertRowid);
}
