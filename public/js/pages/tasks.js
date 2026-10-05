import { api, esc, fmtDateLong, addDays, today, fmtClock, modal, options, toast, emptyState, confirmDialog } from '../ui.js';

const state = { date: today(), editing: false };
const TIMING = { opening: 'Opening', closing: 'Closing', anytime: 'Anytime' };
const DEPT = { FOH: 'Front of House', BOH: 'Back of House', ALL: 'Everyone' };

export async function render(root, ctx) {
  const { lists } = await api('/tasks?date=' + state.date);
  const M = ctx.isManager;
  const myDept = ctx.position(ctx.me.position_id)?.department;
  const shown = M ? lists : [...lists].sort((a, b) => (b.department === myDept) - (a.department === myDept));
  const total = lists.reduce((a, l) => a + l.tasks.length, 0);
  const done = lists.reduce((a, l) => a + l.tasks.filter((t) => t.done).length, 0);

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Tasks</h1><div class="sub">Opening and closing checklists. ${done} of ${total} done for ${fmtDateLong(state.date)}.</div></div>
      <div class="toolbar">
        <button class="btn" data-day="-1" aria-label="Previous day">‹</button>
        <input type="date" value="${state.date}" data-date style="width:auto">
        <button class="btn" data-day="1" aria-label="Next day">›</button>
        ${state.date !== today() ? '<button class="btn" data-day="today">Today</button>' : ''}
        ${M ? `<button class="btn ${state.editing ? 'btn-primary' : ''}" data-edit>${state.editing ? 'Done editing' : 'Edit checklists'}</button>` : ''}
      </div>
    </div>
    <div class="grid grid-2">
      ${shown.map((l) => {
        const d = l.tasks.filter((t) => t.done).length;
        return `<div class="card">
          <div class="card-head">
            <div><h2>${esc(l.name)}</h2><div class="small muted">${DEPT[l.department]} · ${TIMING[l.timing]}</div></div>
            <div class="toolbar"><span class="pill ${d === l.tasks.length && d ? 'pill-good' : 'pill-muted'}">${d}/${l.tasks.length}</span>
            ${state.editing ? `<button class="btn btn-sm btn-ghost" data-del-list="${l.id}">Delete list</button>` : ''}</div>
          </div>
          <div class="progress" style="border-radius:0;height:4px"><i style="width:${l.tasks.length ? (d / l.tasks.length) * 100 : 0}%;border-radius:0"></i></div>
          <div>${l.tasks.map((t) => `<label class="task ${t.done ? 'done' : ''}">
              ${state.editing ? '' : `<input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''}>`}
              <span class="text">${esc(t.text)}</span>
              ${t.done && !state.editing ? `<span class="by">${esc(ctx.userName(t.done.user_id).split(' ')[0])} · ${fmtClock(t.done.done_at)}</span>` : ''}
              ${state.editing ? `<button type="button" class="icon-btn" style="margin-left:auto" data-del-task="${t.id}" aria-label="Delete task">✕</button>` : ''}
            </label>`).join('') || emptyState('No tasks in this list')}
            ${state.editing ? `<form class="task" data-add-task="${l.id}"><input type="text" name="text" placeholder="Add a task…" maxlength="200" required style="height:32px"><button class="btn btn-sm">Add</button></form>` : ''}
          </div>
        </div>`;
      }).join('')}
      ${state.editing ? '<button class="card" data-new-list style="min-height:120px;border-style:dashed;cursor:pointer;font-weight:600;color:var(--muted)">+ New checklist</button>' : ''}
    </div>
    ${!lists.length && !state.editing ? emptyState('No checklists yet', M ? 'Click “Edit checklists” to create one.' : '') : ''}
  </div>`;

  const rerender = () => render(root, ctx);
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.day === 'today' ? today() : addDays(state.date, Number(b.dataset.day));
    rerender();
  }));
  root.querySelector('[data-date]').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; rerender(); } });
  root.querySelectorAll('[data-task]').forEach((c) => c.addEventListener('change', async () => {
    await api('/tasks/toggle', { method: 'POST', body: { task_id: Number(c.dataset.task), date: state.date } });
    rerender();
  }));
  if (!M) return;
  root.querySelector('[data-edit]').addEventListener('click', () => { state.editing = !state.editing; rerender(); });
  root.querySelectorAll('[data-add-task]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    await api(`/task-lists/${f.dataset.addTask}/tasks`, { method: 'POST', body: { text: f.text.value } });
    rerender();
  }));
  root.querySelectorAll('[data-del-task]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/tasks/' + b.dataset.delTask, { method: 'DELETE' });
    rerender();
  }));
  root.querySelectorAll('[data-del-list]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this checklist and all its tasks?', { confirmLabel: 'Delete', danger: true }))) return;
    await api('/task-lists/' + b.dataset.delList, { method: 'DELETE' });
    rerender();
  }));
  root.querySelector('[data-new-list]')?.addEventListener('click', () => modal({
    title: 'New checklist',
    body: `<label class="field"><span>Name</span><input type="text" name="name" required maxlength="80" placeholder="e.g. Bar Closing"></label>
      <div class="row">
        <label class="field"><span>Department</span><select name="department">${options(Object.entries(DEPT), 'ALL')}</select></label>
        <label class="field"><span>When</span><select name="timing">${options(Object.entries(TIMING), 'opening')}</select></label>
      </div>`,
    submitLabel: 'Create',
    onSubmit: async (v) => { await api('/task-lists', { method: 'POST', body: v }); toast('Checklist created'); rerender(); },
  }));
}
