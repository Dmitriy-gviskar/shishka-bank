// Лесные гильдии: список, вход, чат-костёр, роли, история, сон/пробуждение.
// Зависит от глобальных api(), esc() из app.js.
window.runGuilds = function () {
  const api = window.api, esc = window.esc;
  const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
  const PHRASES = ['Собираемся!', 'Заказ готов!', 'Молодцы!', 'Нужна помощь', 'Ура!', 'Я за!'];
  const ROLE_NAMES = { founder: 'Основатель', treasurer: 'Казначей', herald: 'Глашатай', member: 'Участник' };
  let curGuild = null, chatTimer = null;

  async function loadGuilds() {
    const gs = await api('/api/guilds');
    const c = document.getElementById('glist'); c.innerHTML = '';
    if (gs.error) return note(gs.error);
    if (!gs.length) c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700">Гильдий пока нет — основай первую!</span></div>';
    for (const g of gs) {
      const el = document.createElement('div'); el.className = 'card gcard';
      const statusTag = g.status === 'sleeping' ? '<span style="color:#d4953a;font-weight:800;font-size:12px">💤 Спит</span>' : '';
      el.innerHTML = `<div class="gn">${esc(g.name)} ${statusTag}</div><div class="gm">${g.members.map((m) => `${esc(m.name)}${m.role ? ' (' + ROLE_NAMES[m.role] + ')' : ''}`).join(', ')}</div>
        <div class="row">${g.mine
          ? (g.status === 'sleeping' ? '<button class="btn btn-sm wake" style="background:#d4953a;box-shadow:0 4px 0 #b37a2c">Разбудить</button>' : '<button class="btn btn-sm open">Войти</button>')
          : (g.status === 'open' ? '<button class="btn btn-sm join" style="background:#e8b64b;box-shadow:0 4px 0 #c79a3c">Вступить</button>' : '')}</div>`;
      const open = el.querySelector('.open');
      if (open) open.onclick = () => showGuild(g);
      const wake = el.querySelector('.wake');
      if (wake) wake.onclick = async () => {
        const r = await api('/api/guild/awaken', { id: g.id });
        if (r.error) note(r.error); else { note('Гильдия пробудилась!', 1); loadGuilds(); }
      };
      const join = el.querySelector('.join');
      if (join) join.onclick = async () => {
        const r = await api('/api/guild/join', { id: g.id });
        if (r.error) note(r.error); else { note('Ты в гильдии!', 1); loadGuilds(); }
      };
      c.appendChild(el);
    }
  }

  async function loadChat() {
    if (!curGuild) return;
    const msgs = await api('/api/guild/chat', { id: curGuild.id });
    if (msgs.error) return;
    const c = document.getElementById('chat'); c.innerHTML = '';
    for (const m of msgs) { const el = document.createElement('div'); el.className = 'msg' + (m.who === 'Банк' ? ' bank' : '');
      el.innerHTML = `<div class="who">${esc(m.who)}</div><div class="txt">${esc(m.content)}</div>`; c.appendChild(el); }
    c.scrollTop = c.scrollHeight;
  }

  async function loadHistory() {
    if (!curGuild) return;
    const h = await api('/api/guild/history', { id: curGuild.id });
    const c = document.getElementById('history'); c.innerHTML = '';
    if (h.error || !h.length) { c.innerHTML = '<div style="text-align:center;padding:6px;color:#a1876a;font-weight:700;font-size:13px">История пока пуста</div>'; return; }
    for (const ev of h) {
      const icons = { order_completed: '💰', task_created: '📋', member_joined: '👋', role_changed: '🔄', awakened: '☀️' };
      const when = new Date(ev.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;font-weight:700;color:var(--ink)';
      el.innerHTML = `<span>${icons[ev.kind] || ''}</span><span>${esc(ev.title)}</span>${ev.amount ? '<span style="margin-left:auto;color:#5f8e37">+' + ev.amount + ' 🌰</span>' : ''}<span style="font-size:11px;color:#a1876a;margin-left:4px">${when}</span>`;
      c.appendChild(el);
    }
  }

  async function refreshGuildDetail() {
    const gs = await api('/api/guilds');
    if (gs.error) return;
    const g = gs.find((x) => x.id === curGuild.id);
    if (g) curGuild = g;
    showGuild(curGuild);
  }

  function showGuild(g) {
    curGuild = g;
    document.getElementById('listView').style.display = 'none';
    document.getElementById('guildView').style.display = 'flex';
    document.getElementById('gTitle').textContent = g.name + (g.status === 'sleeping' ? ' 💤' : '');
    const m = document.getElementById('gMembers'); m.innerHTML = '';
    const myRole = g.members.find((x) => x.mine)?.role;
    const canManage = myRole === 'founder' || myRole === 'treasurer';
    for (const x of g.members) {
      const el = document.createElement('div'); el.className = 'card mrow';
      let controls = '';
      if (canManage && x.role !== 'founder') {
        controls = `<select class="roleSel" data-id="${x.id}" style="margin-left:auto;font-size:12px;font-weight:800;background:#fff7e8;border:2px solid #d9c39a;border-radius:8px;padding:2px 4px">
          <option value="member" ${x.role==='member'?'selected':''}>Участник</option>
          <option value="treasurer" ${x.role==='treasurer'?'selected':''}>Казначей</option>
          <option value="herald" ${x.role==='herald'?'selected':''}>Глашатай</option></select>`;
        controls += `<input class="shareInp" data-id="${x.id}" type="number" min="1" max="10" value="${x.share}" style="width:38px;font-size:13px;font-weight:800;background:#fffaf0;border:2px solid #d9c39a;border-radius:8px;text-align:center;margin-left:4px">`;
      }
      el.innerHTML = `<span class="nm">${esc(x.name)}${x.role ? '<span style="font-size:10px;color:#a1876a;margin-left:4px">' + ROLE_NAMES[x.role] + '</span>' : ''}</span>${controls}<span class="share" style="${canManage ? 'display:none' : ''}">доля ${x.share}</span>`;
      m.appendChild(el);
    }
    m.querySelectorAll('.roleSel').forEach((sel) => {
      sel.onchange = async () => {
        const r = await api('/api/guild/role', { id: g.id, childId: sel.dataset.id, role: sel.value });
        if (r.error) note(r.error); else { note('Роль изменена', 1); refreshGuildDetail(); }
      };
    });
    m.querySelectorAll('.shareInp').forEach((inp) => {
      inp.onchange = async () => {
        const v = parseInt(inp.value, 10); if (!(v > 0)) return;
        const r = await api('/api/guild/share', { id: g.id, childId: inp.dataset.id, share: v });
        if (r.error) note(r.error); else { note('Доля изменена', 1); refreshGuildDetail(); }
      };
    });
    const p = document.getElementById('phrases'); p.innerHTML = '';
    if (g.status === 'open') {
      for (const ph of PHRASES) { const b = document.createElement('button'); b.textContent = ph;
        b.onclick = async () => { const r = await api('/api/guild/say', { id: g.id, phrase: ph }); if (r.error) note(r.error); else loadChat(); };
        p.appendChild(b); }
    }
    loadChat(); loadHistory();
    chatTimer = setInterval(() => { loadChat(); loadHistory(); }, 15e3);
  }

  document.getElementById('backToList').onclick = () => {
    clearInterval(chatTimer); curGuild = null;
    document.getElementById('guildView').style.display = 'none';
    document.getElementById('listView').style.display = 'flex';
    loadGuilds();
  };
  document.getElementById('createG').onclick = async () => {
    const r = await api('/api/guild/create', { name: document.getElementById('gName').value });
    if (r.error) note(r.error);
    else { document.getElementById('gName').value = ''; note(`Гильдия «${r.name}» основана!`, 1); loadGuilds(); }
  };
  loadGuilds();
};
