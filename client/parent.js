// Кабинет родителя.
// Зависит от window.api, window.esc.
window.runParent = function () {
  const api = window.api;
  const esc = window.esc;

const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
async function loadKids() {
  const kids = await api('/api/parent/children');
  if (kids.error) { alert('Ошибка загрузки: ' + (kids.error || 'попробуйте позже')); return; }
  const c = document.getElementById('kids'); c.innerHTML = '';
  const sel = document.getElementById('taskKid'); sel.innerHTML = '';
  for (const k of kids) {
    const when = k.created_at ? new Date(k.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const el = document.createElement('div'); el.className = 'card kid-row';
    const gLine = Array.isArray(k.guardians) && k.guardians.length
      ? `<div class="meta">Родители: ${k.guardians.map(esc).join(', ')}</div>` : '';
    el.innerHTML = `
      <div class="kid-head">
        <div class="info"><div class="nm">${esc(k.name)}</div>
          <div class="meta">Ур. ${k.level}${when ? ' · ' + when : ''}${k.circle_name ? ' · ' + esc(k.circle_name) : ''}</div>
          ${gLine}
          <span class="code" title="нажми, чтобы скопировать">${esc(k.code)}</span></div>
        <div class="bal">${k.balance}<small>шишек</small></div>
      </div>
      <div class="give-row">
        <input class="amt" type="number" min="1" placeholder="сколько" inputmode="numeric">
        <button class="mini g add">Начислить</button>
        <button class="mini r sub">Списать</button>
        <button class="mini r del" type="button" title="Удалить игрока">✕</button>
      </div>
      <label class="mkt"><input type="checkbox" class="mktbox" ${k.market_allowed ? 'checked' : ''}>
        Рынок карт: покупка, продажа и торги<span class="mkthint">паки, альбом, слияния и подарки работают всегда</span></label>`;
    el.querySelector('.code').onclick = () => { navigator.clipboard?.writeText(k.code); note(`Код ${k.name} скопирован: ${k.code}`, 1); };
    el.querySelector('.mktbox').onchange = async (e) => {
      const r = await api('/api/parent/market', { child: k.id, allowed: e.target.checked });
      if (r.error) { e.target.checked = !e.target.checked; return note(r.error); }
      note(`${k.name}: рынок ${r.allowed ? 'открыт' : 'закрыт'}`, 1);
    };
    const amt = el.querySelector('.amt');
    el.querySelector('.add').onclick = async () => {
      const v = parseInt(amt.value, 10); if (!(v > 0)) return note('Укажи сумму');
      const r = await api('/api/parent/topup', { childId: k.id, amount: v }); if (r.error) return note(r.error);
      note(`${k.name}: +${v} шишек (стало ${r.balance})`, 1); amt.value = ''; loadKids();
    };
    el.querySelector('.sub').onclick = async () => {
      const v = parseInt(amt.value, 10); if (!(v > 0)) return note('Укажи сумму');
      const r = await api('/api/parent/deduct', { childId: k.id, amount: v }); if (r.error) return note(r.error);
      note(`${k.name}: −${r.took} шишек (стало ${r.balance})`, 1); amt.value = ''; loadKids();
    };
    el.querySelector('.del').onclick = async () => {
      if (!confirm(`Удалить игрока «${k.name}» навсегда?\n\nПропадут шишки, карты, задания и вход по коду ${k.code}.`)) return;
      const typed = prompt(`Для подтверждения введи имя точно:\n${k.name}`);
      if (typed == null) return;
      const r = await api('/api/parent/remove-child', { childId: k.id, confirm: typed.trim() });
      if (r.error) return note(r.error);
      note(`«${r.name}» удалён`, 1);
      loadKids(); loadPending(); loadPurchases(); loadGuilds();
    };
    c.appendChild(el);
    const o = document.createElement('option'); o.value = k.id; o.textContent = k.name; sel.appendChild(o);
  }
}
async function loadPending() {
  const list = await api('/api/parent/pending');
  const c = document.getElementById('pending'); c.innerHTML = '';
  const title = document.getElementById('pendingTitle');
  const n = Array.isArray(list) ? list.length : 0;
  if (title) title.textContent = n ? `Задания на проверке · ${n}` : 'Задания на проверке';
  if (!list.length) { c.innerHTML = '<div class="empty">Нет заданий на проверке</div>'; return; }
  for (const p of list) {
    const el = document.createElement('div'); el.className = 'card pend';
    const photoSrc = p.photo ? ('/' + String(p.photo).replace(/^\/+/, '')) : '';
    el.innerHTML = `<div class="t">${esc(p.title)}</div>${photoSrc ? `<img src="${esc(photoSrc)}" style="width:100%;border-radius:12px;margin:6px 0;border:2px solid #d9c39a" loading="lazy">` : ''}<div class="row"><span class="who">${esc(p.childName)} · +${p.reward} шишек</span><button class="mini g ap">Одобрить</button><button class="mini r rj">Вернуть</button></div>`;
    el.querySelector('.ap').onclick = async () => { await api('/api/parent/approve', { id: p.id }); note('Одобрено, шишки начислены', 1); loadPending(); loadKids(); };
    el.querySelector('.rj').onclick = async () => { await api('/api/parent/reject', { id: p.id }); note('Возвращено на доработку', 1); loadPending(); };
    c.appendChild(el);
  }
}
async function loadPurchases() {
  const list = await api('/api/parent/purchases');
  const c = document.getElementById('purchases'); if (!c) return;
  c.innerHTML = '';
  if (!Array.isArray(list) || !list.length) {
    c.innerHTML = '<div class="empty">Нет обещаний — дети ещё ничего не купили</div>';
    return;
  }
  for (const p of list) {
    const g = Array.isArray(p.guardians) && p.guardians.length
      ? ` · родители: ${p.guardians.map(esc).join(', ')}` : '';
    const el = document.createElement('div'); el.className = 'card pend';
    el.innerHTML = `<div class="t">${esc(p.title)}</div>
      <div class="row"><span class="who">${esc(p.childName)} · ${p.price} шишек${g}</span>
        <button class="mini g ok">Исполнено</button>
        <button class="mini r no">Отменить</button></div>`;
    el.querySelector('.ok').onclick = async () => {
      const r = await api('/api/parent/purchase/fulfill', { id: p.id });
      if (r.error) return note(r.error);
      note('Обещание исполнено', 1); loadPurchases();
    };
    el.querySelector('.no').onclick = async () => {
      if (!confirm('Отменить и вернуть шишки ребёнку?')) return;
      const r = await api('/api/parent/purchase/cancel', { id: p.id });
      if (r.error) return note(r.error);
      note('Отменено, шишки возвращены', 1); loadPurchases(); loadKids();
    };
    c.appendChild(el);
  }
}
async function loadGuilds() {
  const gs = await api('/api/parent/guilds');
  const c = document.getElementById('guilds'); c.innerHTML = '';
  if (!gs.length) { c.innerHTML = '<div class="empty">Дети ещё не основали гильдий</div>'; return; }
  for (const g of gs) {
    const el = document.createElement('div'); el.className = 'card kid-row';
    el.innerHTML = `<div class="kid-head"><div class="info"><div class="nm">${esc(g.name)}</div>
        <div class="meta">${g.members.map(esc).join(', ')}</div></div></div>
      <div class="give-row"><input class="amt" type="number" min="1" placeholder="выплата за заказ" inputmode="numeric">
      <button class="mini g pay">Выплатить по долям</button></div>`;
    const amt = el.querySelector('.amt');
    el.querySelector('.pay').onclick = async () => {
      const v = parseInt(amt.value, 10); if (!(v > 0)) return note('Укажи сумму');
      const r = await api('/api/parent/guild-payout', { id: g.id, amount: v });
      if (r.error) return note(r.error);
      note(`Гильдия «${g.name}»: выплачено ${r.paid} шишек по долям`, 1); amt.value = ''; loadKids();
    };
    c.appendChild(el);
  }
}
loadGuilds();
api('/api/parent/templates').then((tpls) => {   // библиотека готовых заданий
  if (tpls.error) return;
  const sel = document.getElementById('taskTpl');
  const cats = {};
  for (const t of tpls) (cats[t.category || 'разное'] = cats[t.category || 'разное'] || []).push(t);
  for (const [cat, list] of Object.entries(cats)) {
    const og = document.createElement('optgroup'); og.label = cat;
    for (const t of list) { const o = document.createElement('option');
      o.value = JSON.stringify({ title: t.title, reward: t.reward, photo: t.needs_photo });
      o.textContent = `${t.title} · ${t.reward}${t.needs_photo ? ' · фото' : ''}`; og.appendChild(o); }
    sel.appendChild(og);
  }
  sel.onchange = () => {   // выбор шаблона заполняет форму — можно править перед выдачей
    if (!sel.value) return;
    const t = JSON.parse(sel.value);
    document.getElementById('taskTitle').value = t.title;
    document.getElementById('taskReward').value = t.reward;
    document.getElementById('taskPhoto').checked = t.photo;
  };
});
document.getElementById('addKid').onclick = async () => {
  const r = await api('/api/parent/add-child', { name: document.getElementById('kidName').value, tree: document.getElementById('kidTree').value });
  if (r.error) note(r.error);
  else { navigator.clipboard?.writeText(r.code); note(`${r.name} добавлен! Код ${r.code} скопирован — отправь ребёнку`, 1); document.getElementById('kidName').value = ''; loadKids(); }
};
document.getElementById('createTask').onclick = async () => {
  const r = await api('/api/parent/create-task', { childId: document.getElementById('taskKid').value, title: document.getElementById('taskTitle').value, reward: document.getElementById('taskReward').value, photo: document.getElementById('taskPhoto').checked });
  if (r.error) note(r.error); else { note('Задание выдано ребёнку!', 1); document.getElementById('taskTitle').value = ''; document.getElementById('taskReward').value = ''; }
};
document.getElementById('addPrize').onclick = async () => {
  const r = await api('/api/parent/add-prize', { title: document.getElementById('prizeTitle').value, price: document.getElementById('prizePrice').value });
  if (r.error) note(r.error); else { note('Приз добавлен в магазин!', 1); document.getElementById('prizeTitle').value = ''; document.getElementById('prizePrice').value = ''; }
};
document.getElementById('logout').onclick = (e) => { e.preventDefault(); location.href = 'link.html'; };
// ── Лесная коллекция: сезон, дедлайн, прогресс детей ──
async function loadSeason() {
  const d = await api('/api/parent/season');
  const box = document.getElementById('season');
  if (!box || d.error) { if (box) box.innerHTML = '<div class="empty">Коллекция ещё не настроена</div>'; return; }
  const next = (d.seasons || []).find((s) => s.status === 'upcoming');
  const ends = d.active && d.active.ends_at ? new Date(d.active.ends_at) : null;
  const daysLeft = ends ? Math.ceil((ends - new Date()) / 86400e3) : null;
  box.innerHTML = `<div class="season-box">
    <div class="sname">${d.active ? d.active.name : 'сезон не выбран'}</div>
    <div class="sinfo">${d.active ? `сейчас выпадает в паках${ends ? ` · до ${ends.toLocaleDateString('ru-RU')} (${daysLeft} дн.)` : ' · срок не задан'}` : ''}</div>
    ${(d.progress || []).map((p) => `<div class="srow"><span>${p.child}</span><span>${p.done} / ${p.total}</span></div>`).join('')}
    <div id="cardMetrics" class="metrics"></div>
    <div class="actions">
      <input type="date" id="seasonDate" value="${ends ? ends.toISOString().slice(0, 10) : ''}">
      <button class="btn" id="setDeadline">Срок</button>
      <button class="btn btn-lg" id="nextSeason" ${next ? '' : 'disabled'}>
        ${next ? `Начать «${next.name}»` : 'Это последний сезон'}</button>
    </div>
    <div class="sinfo" style="margin:8px 0 0">Прошлый сезон не пропадает: его карты остаются у детей,
      их можно выменять или купить друг у друга, а награда за сезон по-прежнему доступна.</div>
  </div>`;
  document.getElementById('setDeadline').onclick = async () => {
    const r = await api('/api/parent/season/deadline', { ends_at: document.getElementById('seasonDate').value || null });
    if (r.error) note(r.error); else { note('Срок сезона сохранён', 1); loadSeason(); }
  };
  const nb = document.getElementById('nextSeason');
  if (nb && next) nb.onclick = async () => {
    if (!confirm(`Завершить «${d.active ? d.active.name : ''}» и начать «${next.name}»?\nВ паках начнут выпадать существа нового сезона.`)) return;
    const r = await api('/api/parent/season/next', {});
    if (r.error) note(r.error); else { note(`Открыт сезон «${r.opened}»`, 1); loadSeason(); }
  };
}

// ── Здоровье экономики карт за неделю: карты должны забирать шишек больше, чем возвращать ──
async function loadMetrics() {
  const m = await api('/api/parent/card-metrics');
  const box = document.getElementById('cardMetrics');
  if (!box || m.error) return;
  const net = (m.earned || 0) - (m.spent || 0);
  const verdict = m.packs === 0 ? 'паков пока не открывали'
    : net < 0 ? 'здоровая: карты забирают шишек больше, чем возвращают'
    : 'внимание: карты вернули больше шишек, чем забрали';
  box.innerHTML = `<div class="mrow"><b>За неделю:</b> ${m.packs} ${plural(m.packs, 'пак', 'пака', 'паков')}
    · потрачено ${m.spent} 🌰 · возвращено ${m.earned} 🌰 · комиссия банка ${m.fees} 🌰</div>
    <div class="mrow ${net < 0 ? 'ok' : 'warn'}">Итог: ${net > 0 ? '+' : ''}${net} 🌰 — ${verdict}</div>
    <div class="mrow">Играют в карты: ${m.players} из ${m.children}</div>`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// ── Лог сделок и подарков (предохранитель: видно, кто кому что отдал) ──
async function loadCardLog() {
  const box = document.getElementById('cardLog');
  if (!box) return;
  const [trades, gifts] = await Promise.all([api('/api/parent/card-trades'), api('/api/parent/card-gifts')]);
  const rows = [];
  for (const t of Array.isArray(trades) ? trades : [])
    rows.push({ at: t.closed_at || t.created_at, html: `<div class="${t.edge ? 'edge' : ''}">${t.seller} → ${t.buyer}: ${t.card} за ${t.price} 🌰${t.edge ? ' · цена у края коридора' : ''}</div>` });
  for (const g of Array.isArray(gifts) ? gifts : [])
    rows.push({ at: g.created_at, html: `<div>${g.from_name} подарил(а) ${g.to_name}: ${g.card}</div>` });
  rows.sort((x, y) => new Date(y.at) - new Date(x.at));
  box.innerHTML = rows.length ? rows.map((r) => r.html).join('') : '<div>Сделок и подарков пока не было</div>';
}

// ── Вручение карты за дело (спец-выпуски и награды вне гачи) ──
async function loadGrant() {
  const [kids, cat] = await Promise.all([api('/api/parent/children'), api('/api/parent/card-catalog')]);
  const kidSel = document.getElementById('grantKid'), cardSel = document.getElementById('grantCard');
  if (!kidSel || kids.error || cat.error) return;
  kidSel.innerHTML = kids.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('');
  cardSel.innerHTML = cat.map((c) => `<option value="${c.id}">${c.pack_drop ? '' : '★ '}${esc(c.name)}${c.occasion ? ` · ${esc(c.occasion)}` : c.season ? ` · ${esc(c.season)}` : ''}</option>`).join('');
  document.getElementById('grantBtn').onclick = async () => {
    const r = await api('/api/parent/card/grant', {
      child: kidSel.value, type: cardSel.value,
      grade: document.getElementById('grantGrade').value,
      reason: document.getElementById('grantReason').value,
    });
    if (r.error) return note(r.error);
    note(`Вручено: ${r.name} (${r.grade})`, 1);
    document.getElementById('grantReason').value = '';
  };
}

loadKids(); loadPending(); loadPurchases(); loadSeason().then(loadMetrics); loadCardLog(); loadGrant();

// очередь проверки: автообновление + якорь #pending из пуша
const pendingPoll = setInterval(() => {
  if (document.hidden) return;
  loadPending();
}, 15000);
(window.__timers || (window.__timers = [])).push(pendingPoll);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { loadPending(); loadPurchases(); }
});
if ((location.hash || '') === '#pending') {
  setTimeout(() => {
    document.getElementById('pendingTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}
};
