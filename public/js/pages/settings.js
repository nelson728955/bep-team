import { api, esc, options, formValues, toast } from '../ui.js';

export async function render(root, ctx) {
  const s = ctx.settings;
  root.innerHTML = `
  <div class="page" style="max-width:760px">
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Restaurant-wide rules used by scheduling, payroll, and reports.</div></div></div>
    <form class="card" data-form>
      <div class="card-head"><h2>Appearance</h2><span class="muted small">Applies to everyone on the team</span></div>
      <div class="card-body">
        <div class="theme-options">
          <label class="theme-option">
            <input type="radio" name="theme" value="bep" ${s.theme !== 'classic' ? 'checked' : ''}>
            <div class="preview preview-bep"><div class="bar"><span class="brand-logo" style="display:block;width:50px;height:23px;background-size:58.5px 58.5px;background-position:-4px -17.7px"></span></div>
              <div class="body"><span class="blk" style="background:#fcb704"></span><span class="blk" style="background:#fffdf9;border:1px solid #ebdfcc"></span><span class="blk" style="background:#0e7f63"></span></div></div>
            <div class="meta"><strong>Bếp</strong><span class="small muted">Your logo, dark lacquer and noodle gold</span></div>
          </label>
          <label class="theme-option">
            <input type="radio" name="theme" value="classic" ${s.theme === 'classic' ? 'checked' : ''}>
            <div class="preview preview-classic"><div class="bar"><span style="width:14px;height:14px;border-radius:50%;background:#fff"></span><span style="color:#fff;font-size:11px;font-weight:600">ShiftHub</span></div>
              <div class="body"><span class="blk" style="background:#f26b3a"></span><span class="blk" style="background:#fff;border:1px solid #e2e4ea"></span><span class="blk" style="background:#2aa58e"></span></div></div>
            <div class="meta"><strong>Classic</strong><span class="small muted">The original purple and orange look</span></div>
          </label>
        </div>
      </div>
      <div class="card-head"><h2>Restaurant</h2></div>
      <div class="card-body">
        <label class="field"><span>Restaurant name</span><input type="text" name="restaurant_name" required maxlength="100" value="${esc(s.restaurant_name)}"></label>
      </div>
      <div class="card-head"><h2>Labor</h2></div>
      <div class="card-body">
        <div class="row">
          <label class="field"><span>Labor % target</span><input type="number" name="labor_target_pct" min="0" max="100" step="0.5" value="${esc(s.labor_target_pct)}"><span class="hint">Budget tool and reports flag days above this</span></label>
          <label class="field"><span>Late grace period (min)</span><input type="number" name="late_grace_min" min="0" max="60" value="${esc(s.late_grace_min)}"><span class="hint">Clock-ins after this are flagged late</span></label>
        </div>
      </div>
      <div class="card-head"><h2>Tips</h2></div>
      <div class="card-body">
        <div class="row">
          <label class="field"><span>Morning / night cutoff</span><input type="time" name="tip_split_time" required value="${esc(s.tip_split_time || '16:00')}"><span class="hint">Hours before this time count toward morning tips, and hours after it toward night tips</span></label>
        </div>
      </div>
      <div class="card-head"><h2>Payroll</h2></div>
      <div class="card-body">
        <div class="row">
          <label class="field"><span>Pay frequency</span><select name="pay_frequency">${options([['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['semimonthly', 'Twice a month']], s.pay_frequency)}</select></label>
          <label class="field"><span>Overtime after (hrs / week)</span><input type="number" name="ot_threshold" min="0" max="80" step="0.5" value="${esc(s.ot_threshold)}"></label>
          <label class="field"><span>Overtime multiplier</span><input type="number" name="ot_multiplier" min="1" max="3" step="0.05" value="${esc(s.ot_multiplier)}"></label>
        </div>
        <p class="small muted" style="margin-top:0">Deductions use <strong>Québec 2026</strong> rates: federal and Québec income tax, QPP, EI (Québec rate), and QPIP. Overtime is paid after 40 hours a week, as required by Québec labour standards.</p>
        <div class="row">
          <label class="field"><span>Health Services Fund rate (%)</span><input type="number" name="hsf_rate_pct" min="0" max="4.26" step="0.01" value="${esc(s.hsf_rate_pct)}"><span class="hint">1.65% for most businesses with total payroll up to $1M</span></label>
          <label class="field"><span>CNESST workplace insurance (%)</span><input type="number" name="cnesst_rate_pct" min="0" max="20" step="0.01" value="${esc(s.cnesst_rate_pct)}"><span class="hint">From your annual CNESST rate notice (0 to leave it out)</span></label>
          <label class="field"><span>Vacation pay</span><select name="vacation_pay_mode">${options([['accrue', 'Accrue, and pay at vacation time'], ['each_pay', 'Add to every pay cheque']], s.vacation_pay_mode)}</select><span class="hint">4%, or 6% after 3 years of service</span></label>
        </div>
        <div class="row">
          <label class="field"><span>Minimum wage ($/hr)</span><input type="number" name="min_wage" min="0" step="0.01" value="${esc(s.min_wage)}"></label>
          <label class="field"><span>Minimum wage with tips ($/hr)</span><input type="number" name="min_wage_tipped" min="0" step="0.01" value="${esc(s.min_wage_tipped)}"><span class="hint">Positions with tip points use this rate. Update both every May 1.</span></label>
        </div>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border);display:flex;justify-content:flex-end"><button class="btn btn-primary">Save settings</button></div>
    </form>
  </div>`;
  const form = root.querySelector('[data-form]');
  // Preview the look as soon as it is picked; Save makes it stick for everyone.
  form.querySelectorAll('[name=theme]').forEach((r) => r.addEventListener('change', () => { document.documentElement.dataset.theme = r.value; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    try {
      await api('/settings', { method: 'PUT', body: formValues(form) });
      toast('Settings saved');
      await ctx.reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}
