import { api, esc, money, avatar, modal, options, toast, emptyState, confirmDialog, fmtDate } from '../ui.js';

const state = { showInactive: false };

/** Returns the applicable Québec minimum if this person is paid below it (tipped positions use the tipped rate), else 0. */
function belowMinimum(ctx, u, p) {
  if (!u.active || !u.hourly_rate) return 0;
  const min = Number((p?.tip_points ?? 0) > 0 ? ctx.settings.min_wage_tipped : ctx.settings.min_wage) || 0;
  return u.hourly_rate < min ? min : 0;
}

export async function render(root, ctx) {
  const groupRank = (u) => {
    if (u.role === 'manager') return 0;
    const department = ctx.position(u.position_id)?.department;
    return department === 'FOH' ? 1 : department === 'BOH' ? 2 : 3;
  };
  const people = ctx.users.filter((u) => state.showInactive || u.active).sort((a, b) => {
    const group = groupRank(a) - groupRank(b);
    if (group) return group;
    if (a.role !== 'manager') {
      const position = (ctx.position(a.position_id)?.name || '').localeCompare(ctx.position(b.position_id)?.name || '');
      if (position) return position;
    }
    return a.name.localeCompare(b.name);
  });
  const count = (pid) => ctx.users.filter((u) => u.active && u.position_id === pid).length;

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Team</h1><div class="sub">${ctx.users.filter((u) => u.active).length} active team members</div></div>
      <div class="toolbar">
        <label class="check" style="margin:0"><input type="checkbox" data-inactive ${state.showInactive ? 'checked' : ''}> Show inactive</label>
        <button class="btn btn-primary" data-new>+ Add employee</button>
      </div>
    </div>
    <div class="grid grid-main">
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Position</th><th>Contact</th><th class="num">Rate</th><th>Access</th><th>Status</th></tr></thead>
        <tbody>${people.map((u) => {
          const p = ctx.position(u.position_id);
          return `<tr data-edit="${u.id}" style="cursor:pointer">
            <td><div class="person">${avatar(u.name, p?.color)}<div class="meta"><div class="name">${esc(u.name)}</div><div class="role">${u.hire_date ? `Since ${fmtDate(u.hire_date, { month: 'short', year: 'numeric' })}` : ''}</div></div></div></td>
            <td>${p ? `<span class="dot" style="background:${esc(p.color)}"></span> ${esc(p.name)} <span class="muted small">${p.department}</span>` : '<span class="muted">–</span>'}</td>
            <td><div>${esc(u.email)}</div><div class="small muted">${esc(u.phone || '')}</div></td>
            <td class="num">${u.hourly_rate ? money(u.hourly_rate) + '/hr' : '<span class="muted">Salary</span>'}${belowMinimum(ctx, u, p) ? `<div><span class="pill pill-bad" data-tip="Québec minimum is ${money(belowMinimum(ctx, u, p))}/hr for this position">Below minimum</span></div>` : ''}</td>
            <td>${u.role === 'manager' ? '<span class="pill pill-info">Manager</span>' : '<span class="pill pill-muted">Employee</span>'}</td>
            <td>${u.active ? '<span class="pill pill-good">Active</span>' : '<span class="pill pill-muted">Inactive</span>'}</td></tr>`;
        }).join('')}</tbody></table></div></div>

      <div class="card">
        <div class="card-head"><h2>Positions</h2><button class="btn btn-sm" data-new-pos>+ Add</button></div>
        <ul class="list">${ctx.positions.map((p) => `<li data-pos="${p.id}" style="cursor:pointer">
          <span class="dot" style="background:${esc(p.color)};width:12px;height:12px"></span>
          <div style="flex:1"><strong>${esc(p.name)}</strong><div class="small muted">${p.department === 'FOH' ? 'Front of House' : 'Back of House'} · ${p.tip_points} tip pts</div></div>
          <span class="muted small">${count(p.id)} people</span></li>`).join('') || `<li>${emptyState('No positions')}</li>`}</ul>
        <p class="small muted" style="padding:0 16px 14px;margin:0">Tip points weight each role's share when a tip pool is split “by role points”.</p>
      </div>
    </div>
  </div>`;

  const reload = () => ctx.reload();
  root.querySelector('[data-inactive]').addEventListener('change', (e) => { state.showInactive = e.target.checked; render(root, ctx); });
  root.querySelector('[data-new]').addEventListener('click', () => userModal(ctx, null, reload));
  root.querySelectorAll('[data-edit]').forEach((tr) => tr.addEventListener('click', () => userModal(ctx, ctx.user(tr.dataset.edit), reload)));
  root.querySelector('[data-new-pos]').addEventListener('click', () => positionModal(ctx, null, reload));
  root.querySelectorAll('[data-pos]').forEach((li) => li.addEventListener('click', () => positionModal(ctx, ctx.position(li.dataset.pos), reload)));
}

function userModal(ctx, u, done) {
  const isNew = !u;
  modal({
    title: isNew ? 'Add employee' : `Edit ${u.name}`,
    wide: true,
    body: `
      <div class="row">
        <label class="field"><span>Full name</span><input type="text" name="name" required maxlength="100" value="${esc(u?.name || '')}"></label>
        <label class="field"><span>Email (used to sign in)</span><input type="email" name="email" required value="${esc(u?.email || '')}"></label>
        <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(u?.phone || '')}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Primary position</span><select name="position_id">${options(ctx.positions.map((p) => [p.id, `${p.name} · ${p.department}`]), u?.position_id, { blank: 'None' })}</select></label>
        <label class="field"><span>Hourly rate ($)</span><input type="number" name="hourly_rate" min="0" step="0.01" value="${u?.hourly_rate ?? (Number(ctx.settings.min_wage_tipped) || 13.30)}"></label>
        <label class="field"><span>Hire date</span><input type="date" name="hire_date" value="${u?.hire_date || ''}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Federal claim (TD1, $)</span><input type="number" name="td1_federal" min="0" step="1" value="${u?.td1_federal ?? ''}" placeholder="16452 (basic)"><span class="hint">Leave blank for the basic personal amount</span></label>
        <label class="field"><span>Québec claim (TP-1015.3, $)</span><input type="number" name="td1_quebec" min="0" step="1" value="${u?.td1_quebec ?? ''}" placeholder="18952 (basic)"><span class="hint">Leave blank for the basic personal amount</span></label>
        <label class="field"><span>Extra tax withheld / pay ($)</span><input type="number" name="extra_withholding" min="0" step="0.01" value="${u?.extra_withholding ?? 0}"></label>
        <label class="field"><span>Access</span><select name="role">${options([['employee', 'Employee'], ['manager', 'Manager (full access)']], u?.role || 'employee')}</select></label>
      </div>
      <div class="row">
        <label class="field"><span>${isNew ? 'Temporary password' : 'Reset password'}</span><input type="text" name="password" ${isNew ? 'required' : ''} minlength="8" autocomplete="off" placeholder="${isNew ? 'At least 8 characters' : 'Leave blank to keep current'}"><span class="hint">Share it with the employee so they can sign in and change it.</span></label>
        ${isNew ? '' : `<label class="field"><span>Status</span><select name="active">${options([['1', 'Active'], ['', 'Inactive (cannot sign in)']], u.active ? '1' : '')}</select></label>`}
      </div>`,
    submitLabel: isNew ? 'Add employee' : 'Save',
    extra: isNew ? [] : [{ label: 'Work ID', onClick: () => {
      modal({ title: `Work ID · ${u.name}`, body: `<label class="field"><span>Four-digit work ID</span><input name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required value="${esc(u.work_id || '')}"><span class="hint">Defaults to the last four phone digits. Each active employee must have a different ID.</span></label>`, onSubmit: async v => { await api('/users/'+u.id+'/work-id',{method:'PUT',body:v});toast('Work ID saved');await done(); } });
      return false;
    } }],
    onOpen: (form) => {
      if (!isNew) return;
      const position = form.elements.position_id;
      const rate = form.elements.hourly_rate;
      let previousRate = rate.value;
      let wasCook = false;
      position.addEventListener('change', () => {
        const selected = ctx.positions.find((p) => String(p.id) === position.value);
        const isCook = /\bcook\b/i.test(selected?.name || '');
        if (isCook) {
          if (!wasCook) previousRate = rate.value;
          rate.value = '20.00';
        } else if (wasCook) {
          rate.value = previousRate;
        }
        wasCook = isCook;
      });
    },
    onSubmit: async (v) => {
      if (!isNew) v.active = v.active === '1';
      for (const k of ['td1_federal', 'td1_quebec']) if (v[k] === '') v[k] = null; // blank = basic personal amount
      if (!v.password) delete v.password;
      await api(isNew ? '/users' : '/users/' + u.id, { method: isNew ? 'POST' : 'PUT', body: v });
      toast(isNew ? 'Employee added' : 'Saved');
      await done();
    },
  });
}

function positionModal(ctx, p, done) {
  const isNew = !p;
  modal({
    title: isNew ? 'Add position' : `Edit ${p.name}`,
    body: `
      <label class="field"><span>Name</span><input type="text" name="name" required maxlength="60" value="${esc(p?.name || '')}"></label>
      <div class="row">
        <label class="field"><span>Department</span><select name="department">${options([['FOH', 'Front of House'], ['BOH', 'Back of House']], p?.department || 'FOH')}</select></label>
        <label class="field"><span>Tip points</span><input type="number" name="tip_points" min="0" step="0.05" value="${p?.tip_points ?? 1}"></label>
        <label class="field"><span>Color</span><input type="color" name="color" value="${p?.color || '#2a78d6'}"></label>
      </div>`,
    submitLabel: isNew ? 'Add' : 'Save',
    extra: isNew ? [] : [{
      label: 'Delete', className: 'btn-danger', onClick: async () => {
        if (!(await confirmDialog(`Delete ${p.name}? Employees and shifts in this position will have no position.`, { confirmLabel: 'Delete', danger: true }))) return false;
        await api('/positions/' + p.id, { method: 'DELETE' });
        await done();
      },
    }],
    onSubmit: async (v) => {
      await api(isNew ? '/positions' : '/positions/' + p.id, { method: isNew ? 'POST' : 'PUT', body: v });
      toast('Position saved');
      await done();
    },
  });
}
