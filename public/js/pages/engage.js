import { api, esc, avatar, timeAgo, modal, toast, emptyState, confirmDialog } from '../ui.js';

let timer = null;

export async function render(root, ctx) {
  clearInterval(timer);
  const M = ctx.isManager;
  const [announcements, messages] = await Promise.all([api('/announcements'), api('/messages')]);
  let lastId = messages.at(-1)?.id || 0;

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Engage</h1><div class="sub">Announcements from management and the team chat.</div></div>
      ${M ? '<button class="btn btn-primary" data-new>+ New announcement</button>' : ''}
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Announcements</h2></div>
        <div>${announcements.length ? announcements.map((a) => `<div class="announcement">
          <h3>${a.pinned ? '📌 ' : ''}${esc(a.title)}</h3>
          <div class="body">${esc(a.body)}</div>
          <div class="meta">${esc(ctx.userName(a.author_id))} · ${timeAgo(a.created_at)}
            ${M ? `<button class="btn btn-sm btn-ghost" data-pin="${a.id}" data-pinned="${a.pinned}">${a.pinned ? 'Unpin' : 'Pin'}</button><button class="btn btn-sm btn-ghost" data-del="${a.id}">Delete</button>` : ''}</div>
        </div>`).join('') : emptyState('No announcements yet')}</div>
      </div>
      <div class="card chat">
        <div class="card-head"><h2>Team chat</h2><span class="muted small">Everyone on the team can see this</span></div>
        <div class="chat-log" data-log></div>
        <form class="chat-input" data-send>
          <input type="text" name="body" placeholder="Write a message…" maxlength="2000" autocomplete="off" required>
          <button class="btn btn-primary">Send</button>
        </form>
      </div>
    </div>
  </div>`;

  const log = root.querySelector('[data-log]');
  const msgHtml = (m) => {
    const mine = m.author_id === ctx.me.id;
    return `<div class="msg ${mine ? 'me' : ''}" data-msg="${m.id}">${avatar(ctx.userName(m.author_id), ctx.userColor(m.author_id), 'sm')}
      <div class="bubble"><div class="who">${esc(mine ? 'You' : ctx.userName(m.author_id))}<span class="when">${timeAgo(m.created_at)}</span>
      ${mine || M ? `<button class="icon-btn" style="width:20px;height:20px;display:inline-grid;font-size:11px" data-del-msg="${m.id}" aria-label="Delete message">✕</button>` : ''}</div>
      <div class="body">${esc(m.body)}</div></div></div>`;
  };
  const append = (list) => {
    if (!list.length) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.querySelector('.empty')?.remove();
    log.insertAdjacentHTML('beforeend', list.map(msgHtml).join(''));
    lastId = list.at(-1).id;
    if (atBottom) log.scrollTop = log.scrollHeight;
  };
  log.innerHTML = messages.length ? '' : emptyState('No messages yet', 'Say hi to the team!');
  append(messages);
  log.scrollTop = log.scrollHeight;

  const poll = async () => { try { append(await api('/messages?after=' + lastId)); } catch { /* offline */ } };
  timer = setInterval(poll, 5000);

  const form = root.querySelector('[data-send]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    form.body.value = '';
    try { await api('/messages', { method: 'POST', body: { body } }); await poll(); log.scrollTop = log.scrollHeight; } catch (err) { toast(err.message, 'error'); form.body.value = body; }
  });
  log.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-msg]');
    if (!b) return;
    await api('/messages/' + b.dataset.delMsg, { method: 'DELETE' });
    log.querySelector(`[data-msg="${b.dataset.delMsg}"]`)?.remove();
  });

  if (M) {
    const rerender = () => render(root, ctx);
    root.querySelector('[data-new]').addEventListener('click', () => modal({
      title: 'New announcement',
      body: `<label class="field"><span>Title</span><input type="text" name="title" required maxlength="120"></label>
        <label class="field"><span>Message</span><textarea name="body" required maxlength="4000" rows="5"></textarea></label>
        <label class="check"><input type="checkbox" name="pinned"> Pin to the top of everyone's dashboard</label>`,
      submitLabel: 'Post',
      onSubmit: async (v) => { await api('/announcements', { method: 'POST', body: v }); toast('Announcement posted'); rerender(); },
    }));
    root.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
      await api('/announcements/' + b.dataset.pin, { method: 'PUT', body: { pinned: b.dataset.pinned !== '1' } });
      rerender();
    }));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Delete this announcement?', { confirmLabel: 'Delete', danger: true }))) return;
      await api('/announcements/' + b.dataset.del, { method: 'DELETE' });
      rerender();
    }));
  }
  return () => clearInterval(timer);
}
