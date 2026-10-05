// Import card tips from a Moneris transaction report (CSV) and distribute them as morning/night tip pools.
// Moneris Go portal: Reports → Financial transactions → Export → CSV.
import { api, esc, money, fmtDate, fmtTime, addDays, modal, options, toast } from '../ui.js';

const MAP_KEY = 'shifthub-moneris-columns';
const BUSINESS_DAY_START = 4 * 60; // sales before 4:00 AM belong to the previous night's service

// ---------------------------------------------------------------- CSV parsing
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : text.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Parses "$1,234.56", "1 234,56 $", "(5.00)" and "-5.00". Returns null when there is no number. */
export function parseMoney(v) {
  if (v === undefined || v === null) return null;
  let s = String(v).trim();
  if (!/\d/.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /-/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma > -1) s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const MONTHS = { jan: 1, feb: 2, fev: 2, fév: 2, mar: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, aoû: 8, sep: 9, oct: 10, nov: 11, dec: 12, déc: 12 };
const pad = (n) => String(n).padStart(2, '0');

function parseTimePart(s) {
  const m = /(\d{1,2})[:h](\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(s || '');
  if (!m) return null;
  let h = Number(m[1]);
  const suffix = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

/** Returns { date: 'YYYY-MM-DD', minutes | null } or null. `dayFirst` decides 03/04/2026. */
export function parseDateTime(s, dayFirst = false) {
  s = String(s || '').trim();
  let y; let mo; let d; let rest = s;
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) { [y, mo, d] = [m[1], m[2], m[3]].map(Number); rest = s.slice(m.index + m[0].length); } else if ((m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) {
    const a = Number(m[1]); const b = Number(m[2]);
    y = Number(m[3]);
    [mo, d] = dayFirst ? [b, a] : [a, b];
    rest = s.slice(m.index + m[0].length);
  } else if ((m = /([a-zéû]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(s))) {
    mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()]; d = Number(m[2]); y = Number(m[3]);
    rest = s.slice(m.index + m[0].length);
  } else if ((m = /(\d{1,2})\s+([a-zéû]{3,})\.?\s+(\d{4})/i.exec(s))) {
    d = Number(m[1]); mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()]; y = Number(m[3]);
    rest = s.slice(m.index + m[0].length);
  } else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, minutes: parseTimePart(rest) };
}

// ---------------------------------------------------------------- column detection
const FIELDS = {
  date: { label: 'Date (or date and time)', test: /date|jour/i, required: true },
  time: { label: 'Time (if in its own column)', test: /^(time|heure)$|\btime\b|heure/i },
  tip: { label: 'Tip amount', test: /tip|pourboire|gratuit/i, required: true },
  type: { label: 'Transaction type', test: /type|opération|operation|trans/i },
  status: { label: 'Status / result', test: /status|statut|état|etat|result|response|réponse|approv/i },
};

function findHeaderRow(rows) {
  const i = rows.findIndex((r) => r.some((c) => FIELDS.tip.test.test(c)) && r.some((c) => FIELDS.date.test.test(c)));
  return i >= 0 ? i : rows.findIndex((r) => r.filter(Boolean).length >= 3);
}

function detectColumns(headers) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch { /* storage unavailable */ }
  const out = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    const remembered = saved[key] ? headers.indexOf(saved[key]) : -1;
    if (remembered >= 0) { out[key] = remembered; continue; }
    let idx = headers.findIndex((h) => f.test.test(h) && !(key === 'time' && /date/i.test(h)) && !(key === 'tip' && /%/.test(h)));
    if (key === 'type' && idx === headers.findIndex((h) => FIELDS.date.test.test(h))) idx = -1;
    out[key] = idx;
  }
  if (out.time === out.date) out.time = -1;
  return out;
}

// ---------------------------------------------------------------- aggregation
/** Totals card tips per business day and shift. */
export function summarize(rows, cols, cutoffHm) {
  const cutoff = parseTimePart(cutoffHm) ?? 16 * 60;
  const dateCells = rows.map((r) => r[cols.date] || '');
  // dd/mm vs mm/dd: if any first number is above 12 the file is day-first.
  const dayFirst = dateCells.some((c) => { const m = /(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/.exec(c); return m && Number(m[1]) > 12; });
  const days = new Map();
  const stats = { used: 0, refunds: 0, skipped: 0, noTime: 0 };
  for (const r of rows) {
    const tipRaw = parseMoney(r[cols.tip]);
    const dt = parseDateTime(`${r[cols.date] || ''} ${cols.time >= 0 ? r[cols.time] || '' : ''}`, dayFirst);
    if (!dt || tipRaw === null) { stats.skipped++; continue; }
    const type = cols.type >= 0 ? r[cols.type] || '' : '';
    const status = cols.status >= 0 ? r[cols.status] || '' : '';
    if (/declin|refus|fail|error|erreur|rejet|incomplet/i.test(status)) { stats.skipped++; continue; }
    if (/pre.?auth|préautor|preautor/i.test(type) && !/complet/i.test(type)) { stats.skipped++; continue; }
    if (tipRaw === 0) { stats.used++; continue; }
    const negative = /refund|return|void|annul|rembours|correction|cancel/i.test(type) || tipRaw < 0;
    const tip = negative ? -Math.abs(tipRaw) : tipRaw;
    if (negative) stats.refunds++;
    let { date } = dt;
    let period;
    if (dt.minutes === null) { period = 'all'; stats.noTime++; } else {
      if (dt.minutes < BUSINESS_DAY_START) date = addDays(date, -1);
      period = dt.minutes < BUSINESS_DAY_START || dt.minutes >= cutoff ? 'night' : 'morning';
    }
    const day = days.get(date) || { date, morning: 0, night: 0, all: 0, count: 0 };
    day[period] = Math.round((day[period] + tip) * 100) / 100;
    day.count++;
    days.set(date, day);
    stats.used++;
  }
  return { days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), stats };
}

// ---------------------------------------------------------------- UI
/**
 * Opens the import flow. `getSplit()` returns { method, position_ids, methodLabel, positionNames } from the tips form.
 */
export function openMonerisImport(ctx, { getSplit, onDone }) {
  const cutoff = ctx.settings.tip_split_time || '16:00';
  let parsed = null; // { headers, rows, cols }

  const m = modal({
    title: 'Import card tips from Moneris',
    wide: true,
    body: `
      <div data-step="file">
        <p>Upload the <strong>Financial transactions</strong> report from the Moneris Go portal (Reports → Financial transactions → Export → <strong>CSV</strong>). Pick a date range covering the days you want to pay out.</p>
        <label class="field"><span>Moneris report (.csv)</span><input type="file" name="file" accept=".csv,text/csv,text/plain"></label>
        <p class="small muted">The file is read in your browser, and only the tip totals are saved. Tips from before ${fmtTime(cutoff)} go to the morning pot, and later tips to the night pot. Tips before 4:00 AM count toward the previous night. Refunds and voids are subtracted, and declined payments are ignored.</p>
      </div>
      <div data-step="map" hidden></div>
      <div data-step="review" hidden></div>`,
    submitLabel: 'Distribute selected days',
    onSubmit: async () => distribute(),
  });
  const form = m.form;
  const submitBtn = form.querySelector('[type=submit]');
  submitBtn.disabled = true;
  const mapEl = form.querySelector('[data-step="map"]');
  const reviewEl = form.querySelector('[data-step="review"]');

  form.file.addEventListener('change', async () => {
    const file = form.file.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    const h = findHeaderRow(rows);
    if (h < 0) { reviewEl.hidden = false; reviewEl.innerHTML = '<div class="alert">This file does not look like a transaction report.</div>'; return; }
    parsed = { headers: rows[h], rows: rows.slice(h + 1), cols: detectColumns(rows[h]) };
    renderMapping();
    await renderReview();
  });

  function renderMapping() {
    const { headers, rows, cols } = parsed;
    const opts = headers.map((hd, i) => [i, hd || `Column ${i + 1}`]);
    mapEl.hidden = false;
    mapEl.innerHTML = `
      <details ${cols.date < 0 || cols.tip < 0 ? 'open' : ''} style="margin-bottom:12px">
        <summary class="small" style="cursor:pointer"><strong>Columns</strong> · ${headers.length} found, ${rows.length} rows. Check these if the totals look wrong.</summary>
        <div class="row" style="margin-top:10px">
          ${Object.entries(FIELDS).map(([k, f]) => `<label class="field"><span>${f.label}${f.required ? '' : ' (optional)'}</span><select data-col="${k}">${options(opts, cols[k] >= 0 ? cols[k] : '', { blank: f.required ? 'Choose…' : 'None' })}</select></label>`).join('')}
        </div>
        <div class="table-wrap"><table class="table small"><thead><tr>${headers.map((hd) => `<th>${esc(hd)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 3).map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      </details>`;
    mapEl.querySelectorAll('[data-col]').forEach((sel) => sel.addEventListener('change', async () => {
      parsed.cols[sel.dataset.col] = sel.value === '' ? -1 : Number(sel.value);
      try {
        localStorage.setItem(MAP_KEY, JSON.stringify(Object.fromEntries(Object.entries(parsed.cols).filter(([, i]) => i >= 0).map(([k, i]) => [k, parsed.headers[i]]))));
      } catch { /* storage unavailable */ }
      await renderReview();
    }));
  }

  async function renderReview() {
    const { rows, cols } = parsed;
    reviewEl.hidden = false;
    if (cols.date < 0 || cols.tip < 0) {
      reviewEl.innerHTML = '<div class="alert">Choose which columns hold the date and the tip amount.</div>';
      submitBtn.disabled = true;
      return;
    }
    const { days, stats } = summarize(rows, cols, cutoff);
    if (!days.length) {
      reviewEl.innerHTML = '<div class="alert">No tips were found in this file. Check the column choices above.</div>';
      submitBtn.disabled = true;
      return;
    }
    // Which day/shift combinations already have a tip pool?
    const existing = await api(`/tips?start=${days[0].date}&end=${days.at(-1).date}`);
    const paid = (date, period) => existing.some((p) => p.date === date && (p.period === period || p.period === 'all' || period === 'all'));
    const split = getSplit();
    const hasAll = days.some((d) => d.all);
    reviewEl.innerHTML = `
      ${stats.noTime ? '<div class="alert">Some transactions have no time, so they cannot be split into morning and night. They are shown as whole-day tips.</div>' : ''}
      <p class="small muted">${stats.used} transactions read${stats.refunds ? `, ${stats.refunds} refund${stats.refunds === 1 ? '' : 's'} or void${stats.refunds === 1 ? '' : 's'} subtracted` : ''}${stats.skipped ? `, ${stats.skipped} rows skipped (declined, pre-auth, or totals)` : ''}. Add cash tips if you have them. Split: <strong>${esc(split.methodLabel)}</strong> among ${esc(split.positionNames || 'no positions')} (change this on the tip form).</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th></th><th>Date</th><th class="num">Card · morning</th><th class="num">Card · night</th>${hasAll ? '<th class="num">Card · whole day</th>' : ''}<th class="num">Cash · morning</th><th class="num">Cash · night</th><th>Status</th></tr></thead>
        <tbody>${days.map((d) => {
          const already = (d.morning && paid(d.date, 'morning')) || (d.night && paid(d.date, 'night')) || (d.all && paid(d.date, 'all'));
          const negative = d.morning < 0 || d.night < 0 || d.all < 0;
          return `<tr data-day="${d.date}">
            <td><input type="checkbox" data-pick ${already || negative ? '' : 'checked'} ${already ? 'disabled' : ''} aria-label="Include ${d.date}"></td>
            <td class="nowrap">${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}<div class="small muted">${d.count} tip${d.count === 1 ? '' : 's'}</div></td>
            <td class="num">${money(d.morning)}</td><td class="num">${money(d.night)}</td>${hasAll ? `<td class="num">${money(d.all)}</td>` : ''}
            <td class="num"><input class="inline-input" style="width:90px" type="number" min="0" step="0.01" data-cash="morning" placeholder="0.00"></td>
            <td class="num"><input class="inline-input" style="width:90px" type="number" min="0" step="0.01" data-cash="night" placeholder="0.00"></td>
            <td>${already ? '<span class="pill pill-muted">Already paid</span>' : negative ? '<span class="pill pill-bad">Refunds exceed tips</span>' : '<span class="pill pill-good">Ready</span>'}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="small muted">Card total ${money(days.reduce((a, d) => a + d.morning + d.night + d.all, 0))}. Days already paid out are skipped. To redo one, delete its pool in the history first.</p>
      <div data-results></div>`;
    parsed.days = days;
    const refresh = () => { submitBtn.disabled = !reviewEl.querySelector('[data-pick]:checked'); };
    reviewEl.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', refresh));
    refresh();
  }

  async function distribute() {
    const split = getSplit();
    if (!split.position_ids.length) throw new Error('Pick at least one position on the tip form first.');
    const results = [];
    for (const tr of reviewEl.querySelectorAll('tr[data-day]')) {
      if (!tr.querySelector('[data-pick]')?.checked) continue;
      const d = parsed.days.find((x) => x.date === tr.dataset.day);
      const cash = (p) => Number(tr.querySelector(`[data-cash="${p}"]`)?.value) || 0;
      const amounts = { morning: d.morning + cash('morning'), night: d.night + cash('night'), all: d.all };
      const pools = Object.entries(amounts).filter(([, a]) => a > 0).map(([period, amount]) => ({
        date: d.date, period, amount: Math.round(amount * 100) / 100, method: split.method, position_ids: split.position_ids,
        label: `${period === 'morning' ? 'Morning' : period === 'night' ? 'Night' : 'Daily'} pool (Moneris)`,
      }));
      if (!pools.length) continue;
      try {
        await api('/tips', { method: 'POST', body: { pools } });
        results.push({ date: d.date, ok: true });
      } catch (e) {
        results.push({ date: d.date, ok: false, error: e.message });
      }
    }
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (ok) toast(`Tips distributed for ${ok} day${ok === 1 ? '' : 's'}`);
    if (failed.length) {
      // Keep the dialog open, refreshed, so the manager can see which days need attention.
      if (ok) onDone();
      await renderReview();
      reviewEl.querySelector('[data-results]').innerHTML = `<div class="alert"><strong>${failed.length} day(s) were not distributed:</strong><br>${failed.map((f) => `${esc(fmtDate(f.date, { weekday: 'short', month: 'short', day: 'numeric' }))}: ${esc(f.error)}`).join('<br>')}</div>`;
      return false;
    }
    onDone();
    return true;
  }
}
