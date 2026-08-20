// Лесная почта / чат.
// Зависит от window.api, window.esc.
window.runMail = function () {
  const api = window.api;
  const esc = window.esc;

// ── Чат ──
const STICKERS = ['🦊','🐿️','🦉','🐻','🦌','🐰','🌲','🍄','🌰','🍂','🌟','❤️','🔥','😂','👍','🎉','😢','😡','🤔','🙏'];
let chatFriend = null, chatFriendName = '', replyTo = null, pressTimer = null;
let lastMsgCount = 0, lastMsgSig = '', lastMsgId = null, lastFullSync = 0;
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };

// ── Список чатов ──
async function loadChatList() {
  const list = await api('/api/chat/list', {});
  const c = document.getElementById('chatList'); c.innerHTML = '';
  if (list.error) return;
  if (!list.length) {
    c.innerHTML = '<div class="noChats">Пока нет друзей для переписки.<br>Открой вкладку «Друзья» и добавь по коду с поляны 🌲</div>';
    return;
  }
  for (const ch of list) {
    const el = document.createElement('div'); el.className = 'chatRow';
    let preview = ch.last_msg ? esc(ch.last_msg).slice(0, 40) : 'Написать... ✉️';
    if (preview.startsWith('/uploads/audio_')) preview = '🎤 Голосовое сообщение';
    else if (preview.startsWith('Дарю тебе карту:')) preview = '🃏 ' + preview;
    else if (preview.startsWith('Дарю тебе') && preview.includes('шишек')) preview = '🎁 ' + preview;
    const time = ch.last_at ? fmtTime(ch.last_at) : '';
    el.innerHTML = `<div class="ava"><img src="assets/${ch.avatar}">${ch.online ? '<div class="dot"></div>' : ''}</div><div class="info"><div class="name">${esc(ch.name)}</div><div class="preview" style="${ch.last_msg ? '' : 'font-style:italic;color:#7bab4c'}">${preview}</div></div>
      <div class="meta"><div class="time">${time}</div>${ch.unread > 0 ? `<div class="badge">${ch.unread}</div>` : ''}</div>`;
    el.onclick = () => { chatFriend = ch.id; chatFriendName = ch.name; openChat(); };
    c.appendChild(el);
  }
}

// ── Вкладки + хаб друзей ──
let mailTab = 'chats';
function setMailTab(tab) {
  mailTab = tab;
  // не трогаем панели, пока открыт диалог — иначе асинхронный refresh «выкидывает» из чата
  if (chatFriend) return;
  document.querySelectorAll('#mailTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('friendsPane')?.classList.toggle('on', tab === 'friends');
  document.getElementById('chatList')?.classList.toggle('on', tab === 'chats');
  if (tab === 'friends') loadFriendsHub();
  else loadChatList();
}
function friendCodeBusy() {
  const el = document.getElementById('friendCode');
  if (!el) return false;
  return document.activeElement === el || !!(el.value || '').trim();
}
async function loadFriendsHub(opts) {
  const silent = !!(opts && opts.silent);
  if (silent && friendCodeBusy()) return;
  const pane = document.getElementById('friendsPane');
  if (!pane) return;
  const hub = await api('/api/friends/hub');
  if (silent && friendCodeBusy()) return;
  if (hub.error) { pane.innerHTML = `<div class="noChats">${esc(hub.error)}</div>`; return; }
  const parts = [];
  parts.push(`<div class="fHint">Подай заявку обитателю леса — он примет или нет. Код с поляны тоже подходит.</div>`);
  if (hub.my_code) {
    parts.push(`<div class="fMyCode">Твой код: <b id="myFriendCode">${esc(hub.my_code)}</b><button type="button" id="btnCopyMyCode">Скопировать</button></div>`);
  }
  parts.push(`<div class="fAdd"><input id="friendCode" placeholder="Код друга" maxlength="12" autocomplete="off" autocapitalize="characters"><button type="button" id="btnAddFriend">Добавить</button></div>`);
  if ((hub.forest?.length || 0) + (hub.circle?.length || 0) > 6) {
    parts.push(`<div class="fFind"><input id="forestFind" placeholder="Найти по имени" maxlength="24" autocomplete="off"></div>`);
  }

  const row = (p, actsHtml) =>
    `<div class="fRow" data-name="${esc((p.name || '').toLowerCase())}"><img src="assets/${p.avatar || 'tree.webp'}" alt=""><div class="nm">${esc(p.name)}</div><div class="acts">${actsHtml}</div></div>`;

  if (hub.pending_in?.length) {
    parts.push(`<div class="fSec">Заявки вам · ${hub.pending_in.length}</div>`);
    for (const p of hub.pending_in) {
      parts.push(row(p,
        `<button type="button" class="go" data-act="accept" data-id="${p.id}">Принять</button>` +
        `<button type="button" data-act="decline" data-id="${p.id}">Нет</button>`));
    }
  }
  if (hub.friends?.length) {
    parts.push(`<div class="fSec">Мои друзья · ${hub.friends.length}</div>`);
    for (const p of hub.friends) {
      parts.push(row(p,
        `<button type="button" class="go" data-act="chat" data-id="${p.id}" data-name="${esc(p.name)}">Написать</button>` +
        `<button type="button" data-act="gift" data-id="${p.id}" data-name="${esc(p.name)}">🎁</button>`));
    }
  } else {
    parts.push(`<div class="noChats" style="margin:0">Друзей пока нет — выбери кого-нибудь из леса ниже или введи код.</div>`);
  }
  if (hub.pending_out?.length) {
    parts.push(`<div class="fSec">Ждём ответа · ${hub.pending_out.length}</div>`);
    for (const p of hub.pending_out) {
      parts.push(row(p, `<button type="button" disabled>⏳</button>`));
    }
  }
  if (hub.circle?.length) {
    parts.push(`<div class="fSec">В кругу, ещё не друзья · ${hub.circle.length}</div>`);
    for (const p of hub.circle) {
      parts.push(row(p, `<button type="button" class="go" data-act="request" data-id="${p.id}">В друзья</button>`));
    }
  }
  if (hub.forest?.length) {
    parts.push(`<div class="fSec">Обитатели леса · ${hub.forest.length}</div>`);
    for (const p of hub.forest) {
      parts.push(row(p, `<button type="button" class="go" data-act="request" data-id="${p.id}">В друзья</button>`));
    }
  }
  pane.innerHTML = parts.join('');
  const addByCode = async () => {
    const input = pane.querySelector('#friendCode');
    const code = (input?.value || '').trim();
    if (!code) { alert('Введи код с поляны друга'); return; }
    const r = await api('/api/friends/request', { code });
    if (r.error) { alert(r.error); return; }
    if (input) input.value = '';
    if (r.status === 'pending') alert(`Заявка ушла к ${r.name || 'другу'} — пусть нажмёт «Принять»`);
    else if (r.status === 'accepted') alert(`${r.name || 'Друг'} теперь в друзьях — можно писать`);
    loadFriendsHub();
  };
  pane.querySelector('#forestFind')?.addEventListener('input', () => {
    const q = (pane.querySelector('#forestFind')?.value || '').trim().toLowerCase();
    pane.querySelectorAll('.fRow').forEach((el) => {
      el.style.display = !q || (el.dataset.name || '').includes(q) ? '' : 'none';
    });
  });
  pane.querySelector('#btnAddFriend')?.addEventListener('click', addByCode);
  pane.querySelector('#friendCode')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addByCode(); }
  });
  pane.querySelector('#btnCopyMyCode')?.addEventListener('click', async () => {
    const code = hub.my_code || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      const btn = pane.querySelector('#btnCopyMyCode');
      if (btn) { btn.textContent = 'Скопирован'; setTimeout(() => { btn.textContent = 'Скопировать'; }, 1600); }
    } catch {
      prompt('Скопируй свой код:', code);
    }
  });
  pane.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (act === 'chat') {
        chatFriend = id; chatFriendName = btn.dataset.name || '';
        document.getElementById('mailTabs').style.display = 'none';
        openChat();
        return;
      }
      if (act === 'gift') {
        chatFriend = id; chatFriendName = btn.dataset.name || '';
        document.getElementById('payToName').textContent = chatFriendName;
        document.getElementById('payPopup').classList.add('open');
        return;
      }
      if (act === 'request') {
        const r = await api('/api/friends/request', { to: id });
        if (r.error) alert(r.error);
        loadFriendsHub();
        return;
      }
      if (act === 'accept') {
        const r = await api('/api/friends/accept', { from: id });
        if (r.error) alert(r.error);
        loadFriendsHub();
        return;
      }
      if (act === 'decline') {
        await api('/api/friends/decline', { from: id });
        loadFriendsHub();
      }
    });
  });
}
document.getElementById('mailTabs')?.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => setMailTab(b.dataset.tab));
});

// ── Детальный чат ──
const saveOpenChat = () => {
  try {
    if (chatFriend) sessionStorage.setItem('mailOpenChat', JSON.stringify({ id: chatFriend, name: chatFriendName }));
    else sessionStorage.removeItem('mailOpenChat');
  } catch {}
};
let openChat = function openChat() {
  document.getElementById('chatList')?.classList.remove('on');
  document.getElementById('friendsPane')?.classList.remove('on');
  document.getElementById('mailTabs').style.display = 'none';
  document.getElementById('chatDetail').classList.add('open');
  document.getElementById('chName').textContent = chatFriendName;
  document.querySelector('.wrap')?.classList.add('chat-open');
  document.querySelector('.phone')?.classList.add('chat-open');
  saveOpenChat();
  loadChat();
}
let closeChat = function closeChat() {
  document.getElementById('chatDetail').classList.remove('open');
  document.getElementById('mailTabs').style.display = '';
  document.querySelector('.wrap')?.classList.remove('chat-open');
  document.querySelector('.phone')?.classList.remove('chat-open');
  const t = document.querySelector('.title'); if (t) t.textContent = 'Лесная почта';
  chatFriend = null; chatFriendName = '';
  saveOpenChat();
  setMailTab(mailTab || 'chats');
}
window.__mailBack = () => closeChat();
async function loadChat() {
  const c = document.getElementById('chatMsgs'); c.innerHTML = '';
  if (!chatFriend) return;
  const friend = chatFriend;
  const msgs = await api('/api/chat', { with: friend });
  // пока ждали сеть — диалог могли закрыть / сменить
  if (chatFriend !== friend) return;
  if (msgs.error) { c.innerHTML = '<div class="emptyChat">Ошибка загрузки</div>'; return; }
  if (!msgs.length) { c.innerHTML = '<div class="emptyChat">Нет сообщений. Напиши первым! 🌱</div>'; }
  for (const m of msgs) appendMsg(c, m);
  lastMsgCount = Array.isArray(msgs) ? msgs.length : 0;
  lastMsgSig = msgs.length ? `${msgs.length}:${msgs[msgs.length - 1].id}` : '0';
  lastMsgId = msgs.length ? msgs[msgs.length - 1].id : null;
  lastFullSync = Date.now();
  c.scrollTop = c.scrollHeight;
}
function appendMsg(c, m) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;';
  wrap.dataset.msgId = m.id;
  if (m.mine) wrap.style.alignItems = 'flex-end'; else wrap.style.alignItems = 'flex-start';
  const el = document.createElement('div');
  if (m.type === 'audio') {
    el.className = 'msgAudio ' + (m.mine ? 'mine' : 'theirs');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.playsInline = true;
    audio.preload = 'metadata';
    audio.src = m.content;
    el.appendChild(audio);
    const tm = document.createElement('div'); tm.className = 'msgTime'; tm.textContent = fmtTime(m.created_at); el.appendChild(tm);
  } else if (m.type === 'sticker') {
    el.className = 'msgSticker ' + (m.mine ? 'mine' : 'theirs');
    el.innerHTML = esc(m.content) + `<div class="msgTime">${fmtTime(m.created_at)}${m.mine ? (m.is_read ? ' ✓✓' : ' ✓') : ''}</div>`;
  } else {
    el.className = 'msgBubble ' + (m.mine ? 'mine' : 'theirs');
    el.innerHTML = esc(m.content) + `<div class="msgTime">${fmtTime(m.created_at)}${m.mine ? (m.is_read ? ' ✓✓' : ' ✓') : ''}</div>`;
  }
  if (m.reply_to) {
    const qt = document.createElement('div'); qt.className = 'replyQuote';
    qt.innerHTML = `<div class="by">↩ ${esc(m.reply_by || '...')}</div>${esc(m.reply_content || '')}`;
    el.appendChild(qt);
  }
  if (m.reactions && m.reactions.length) {
    const rxRow = document.createElement('div'); rxRow.className = 'rxRow' + (m.mine ? ' mine' : '');
    const groups = {}; m.reactions.forEach((r) => { groups[r.emoji] = (groups[r.emoji] || 0) + 1; });
    Object.entries(groups).forEach(([emoji, cnt]) => {
      const chip = document.createElement('span'); chip.className = 'rxChip';
      chip.innerHTML = emoji + (cnt > 1 ? `<span class="cnt">${cnt}</span>` : '');
      chip.onclick = (e) => { e.stopPropagation(); react(m.id, emoji); };
      rxRow.appendChild(chip);
    });
    wrap.appendChild(el);
    wrap.appendChild(rxRow);
  } else {
    wrap.appendChild(el);
  }
  // долгое нажатие → меню (реакция / ответ / удалить своё); свайп вправо → ответ
  let swipeX = 0, swipeY = 0;
  el.addEventListener('touchstart', (e) => {
    swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY;
    pressTimer = setTimeout(() => { showMsgMenu(e, m); }, 500);
  }, { passive: true });
  el.addEventListener('touchmove', () => { clearTimeout(pressTimer); }, { passive: true });
  el.addEventListener('touchend', (e) => {
    clearTimeout(pressTimer);
    const dx = (e.changedTouches[0]?.clientX || 0) - swipeX;
    const dy = Math.abs((e.changedTouches[0]?.clientY || 0) - swipeY);
    if (dx > 60 && dy < 30) startReply(m);
  });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); showMsgMenu(e, m); });
  c.appendChild(wrap);
}
function startReply(m) {
  replyTo = m.id;
  const preview = m.type === 'audio' ? '🎤 Голосовое' : String(m.content || '').slice(0, 50);
  document.getElementById('replyTxt').textContent = preview;
  document.getElementById('replyBar').style.display = 'flex';
  document.getElementById('msgInput').focus();
}
async function sendMsg(content) {
  if (!chatFriend) return;
  const r = await api('/api/message', { content, to: chatFriend, reply_to: replyTo });
  if (!r.error) { loadChat(); document.getElementById('msgInput').value = ''; replyTo = null; cancelReply(); }
}
async function sendSticker(emoji) {
  if (!chatFriend) return;
  const r = await api('/api/message', { content: emoji, to: chatFriend, type: 'sticker' });
  if (!r.error) loadChat();
}

// ── Перевод шишек из чата ──
let payAmt = 10;
function openPay() {
  document.getElementById('payToName').textContent = 'Кому: ' + chatFriendName;
  document.getElementById('payPopup').classList.add('open');
}
function doPay() {
  document.getElementById('payPopup').classList.remove('open');
  api('/api/transfer', { to: chatFriend, amount: payAmt }).then((r) => {
    if (r.error) {
      const n = document.createElement('div'); n.className = 'emptyChat'; n.textContent = r.error;
      document.getElementById('chatMsgs').appendChild(n);
    } else {
      // сообщение «Дарю тебе N шишек!» пишет transfer_cones — как подарок карты
      loadChat();
    }
  });
}
setMailTab((location.hash || '').includes('friends') ? 'friends' : 'chats');
// Стикеры
const stickerBar = document.getElementById('stickerBar');
STICKERS.forEach((s) => { const b = document.createElement('button'); b.textContent = s; b.onclick = () => sendSticker(s); stickerBar.appendChild(b); });

// Голосовые: тап старт / тап стоп (hold-to-talk ломается на Android: диалог микрофона рвёт pointerup)
let mediaRecorder = null, audioChunks = [], recTimer = null, recSecs = 0, recStarting = false;
const micBtn = document.getElementById('micBtn'), recTime = document.getElementById('recTime');
const fmtSec = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const flashMic = (t) => { if (!micBtn) return; micBtn.textContent = t; setTimeout(() => { if (!mediaRecorder) micBtn.textContent = '🎤'; }, 2200); };
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  const cands = [
    'audio/webm;codecs=opus', 'audio/webm',
    'audio/mp4', 'audio/aac',
    'audio/ogg;codecs=opus', 'audio/ogg',
  ];
  for (const m of cands) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return '';
};
const startRec = async () => {
  if (!chatFriend || mediaRecorder || recStarting) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    flashMic('🚫'); return;
  }
  recStarting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (!recStarting) { stream.getTracks().forEach((t) => t.stop()); return; }
    const mime = pickMime();
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) audioChunks.push(ev.data); };
    mediaRecorder.onerror = () => flashMic('⚠️');
    // timeslice: на части Android WebView без него ondataavailable пустой до stop
    try { mediaRecorder.start(1000); }
    catch { mediaRecorder.start(); }
    micBtn.classList.add('recording');
    micBtn.textContent = '⏹';
    if (recTime) { recTime.style.display = 'inline'; recTime.textContent = '0:00'; }
    recSecs = 0;
    recTimer = setInterval(() => { recSecs++; if (recTime) recTime.textContent = fmtSec(recSecs); }, 1000);
  } catch (err) {
    console.error('mic', err);
    flashMic('🚫');
  } finally { recStarting = false; }
};
const stopRec = async () => {
  if (recStarting) return; // ждём разрешение микрофона — не срываем старт
  if (!mediaRecorder) return;
  const rec = mediaRecorder;
  mediaRecorder = null;
  micBtn.classList.remove('recording');
  micBtn.textContent = '🎤';
  if (recTime) recTime.style.display = 'none';
  clearInterval(recTimer);
  const recMime = rec.mimeType || pickMime() || 'audio/webm';
  if (rec.state === 'recording') {
    try { rec.requestData(); } catch {}
  }
  await new Promise((resolve) => {
    const done = () => resolve();
    rec.addEventListener('stop', done, { once: true });
    try { rec.stop(); } catch { done(); }
    setTimeout(done, 1500);
  });
  try { rec.stream.getTracks().forEach((t) => t.stop()); } catch {}
  if (!audioChunks.length) { flashMic('…'); return; }
  const blob = new Blob(audioChunks, { type: recMime.split(';')[0] || 'audio/webm' });
  audioChunks = [];
  if (blob.size < 200) { flashMic('…'); return; }
  const to = chatFriend;
  if (!to) { flashMic('⚠️'); return; }
  try {
    const data = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(reader.error);
      reader.readAsDataURL(blob);
    });
    // Android иногда отдаёт data:;base64 без mime — чиним
    let payload = String(data || '');
    if (payload.startsWith('data:;base64,') || payload.startsWith('data:application/octet-stream;base64,')) {
      payload = `data:${recMime.split(';')[0] || 'audio/webm'};base64,` + payload.split(',')[1];
    }
    const up = await api('/api/audio', { data: payload });
    if (up.error || !up.url) { flashMic('⚠️'); console.error('audio upload', up.error); return; }
    const sent = await api('/api/message', { content: up.url, to, type: 'audio' });
    if (sent.error) { flashMic('⚠️'); console.error('audio send', sent.error); return; }
    loadChat();
  } catch (err) {
    console.error('voice send', err);
    flashMic('⚠️');
  }
};
if (micBtn) {
  micBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (mediaRecorder || recStarting) stopRec();
    else startRec();
  });
  micBtn.addEventListener('contextmenu', (e) => e.preventDefault());
}
// Ответ
window.cancelReply = () => { replyTo = null; document.getElementById('replyBar').style.display = 'none'; };
document.getElementById('replyCancel').onclick = cancelReply;
// Меню сообщения: реакции / ответ / удалить своё
let rxMsgId = null, rxMsgMine = false, rxMsgRef = null;
window.react = async (msgId, emoji) => {
  await api('/api/message/react', { message_id: msgId, emoji });
  loadChat();
};
window.deleteMsg = async (msgId) => {
  if (!msgId) return;
  if (!window.confirm('Удалить сообщение у вас обоих?')) return;
  const r = await api('/api/message/delete', { message_id: msgId });
  if (r.error) return;
  hideMsgMenu();
  loadChat();
};
window.showMsgMenu = (e, m) => {
  rxMsgId = m.id;
  rxMsgMine = !!m.mine;
  rxMsgRef = m;
  const pk = document.getElementById('rxPicker');
  const del = document.getElementById('rxDelete');
  if (del) del.style.display = rxMsgMine ? '' : 'none';
  const t = e.touches ? e.touches[0] : e;
  const x = t.clientX != null ? t.clientX : (window.innerWidth / 2);
  const y = t.clientY != null ? t.clientY : (window.innerHeight / 2);
  pk.style.display = 'flex';
  pk.style.left = Math.max(8, Math.min(x - 100, window.innerWidth - 220)) + 'px';
  pk.style.top = Math.max(8, y - 90) + 'px';
  setTimeout(() => document.addEventListener('click', hideMsgMenu, { once: true }), 50);
};
const hideMsgMenu = () => {
  document.getElementById('rxPicker').style.display = 'none';
  rxMsgId = null; rxMsgMine = false; rxMsgRef = null;
};
document.querySelectorAll('#rxPicker .rxEmojis button').forEach((b) => {
  b.onclick = (ev) => {
    ev.stopPropagation();
    if (rxMsgId) { react(rxMsgId, b.textContent); hideMsgMenu(); }
  };
});
document.getElementById('rxReply').onclick = (ev) => {
  ev.stopPropagation();
  if (rxMsgRef) startReply(rxMsgRef);
  hideMsgMenu();
};
document.getElementById('rxDelete').onclick = (ev) => {
  ev.stopPropagation();
  if (rxMsgId) deleteMsg(rxMsgId);
};
// Отправка вручную (быстрые фразы убраны — случайные тапы засоряли чат)
document.getElementById('btnSend').onclick = () => { const v = document.getElementById('msgInput').value.trim(); if (v) sendMsg(v); };
// На Android WebView клавиатура не двигает вьюпорт — скроллим поле ввода в видимую зону
const msgInput = document.getElementById('msgInput');
msgInput.addEventListener('focus', () => { setTimeout(() => msgInput.scrollIntoView({ block: 'center' }), 300); });
document.getElementById('msgInput').onkeydown = (e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) sendMsg(v); } };
// Навигация
document.getElementById('btnBack').onclick = closeChat;
// Перевод шишек
document.getElementById('btnPay').onclick = openPay;
document.getElementById('btnPayCancel').onclick = () => document.getElementById('payPopup').classList.remove('open');
document.getElementById('btnDoPay').onclick = doPay;
const payAmts = document.getElementById('payAmts');
[1, 5, 10, 25, 50, 100].forEach((a) => {
  const b = document.createElement('button');
  b.textContent = a + ' 🪙';
  if (a === 10) b.classList.add('sel');
  b.onclick = () => { payAmt = a; [...payAmts.children].forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); };
  payAmts.appendChild(b);
});
// Автообновление: чат — дельта по after_id (без полной перерисовки); раз в ~45с полный sync
let chatPoll = null, listPoll = null;
const startChatPoll = () => {
  if (chatPoll) clearInterval(chatPoll);
  chatPoll = setInterval(async () => {
    if (document.hidden || !chatFriend) return;
    const friend = chatFriend;
    const c = document.getElementById('chatMsgs');
    if (!c) return;
    const needFull = !lastMsgId || (Date.now() - lastFullSync > 45000);
    const msgs = await api('/api/chat', needFull ? { with: friend } : { with: friend, after_id: lastMsgId });
    if (chatFriend !== friend) return;
    if (msgs.error || !Array.isArray(msgs)) return;
    if (needFull) {
      const sig = msgs.length ? `${msgs.length}:${msgs[msgs.length - 1].id}` : '0';
      lastFullSync = Date.now();
      if (sig === lastMsgSig) return;
      lastMsgSig = sig;
      lastMsgCount = msgs.length;
      lastMsgId = msgs.length ? msgs[msgs.length - 1].id : null;
      const wasAtBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
      c.innerHTML = '';
      if (!msgs.length) {
        c.innerHTML = '<div class="emptyChat">Нет сообщений. Напиши первым! 🌱</div>';
      } else {
        for (const m of msgs) appendMsg(c, m);
      }
      if (wasAtBottom) c.scrollTop = c.scrollHeight;
      return;
    }
    // дельта: только новые — дописываем в конец
    if (!msgs.length) return;
    const empty = c.querySelector('.emptyChat');
    if (empty) empty.remove();
    const wasAtBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
    for (const m of msgs) appendMsg(c, m);
    lastMsgId = msgs[msgs.length - 1].id;
    lastMsgCount += msgs.length;
    lastMsgSig = `${lastMsgCount}:${lastMsgId}`;
    if (wasAtBottom) c.scrollTop = c.scrollHeight;
  }, 6000);
  (window.__timers || (window.__timers = [])).push(chatPoll);
};
listPoll = setInterval(() => {
  if (document.hidden || chatFriend) return;
  if (mailTab === 'chats') loadChatList();
  else if (mailTab === 'friends') loadFriendsHub({ silent: true });
}, 12000);
(window.__timers || (window.__timers = [])).push(listPoll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (chatFriend) { lastMsgSig = ''; lastFullSync = 0; } // следующий тик — полный sync
  else if (mailTab === 'chats') loadChatList();
  else loadFriendsHub({ silent: true });
});
const origOpen = openChat; openChat = () => { origOpen(); lastMsgCount = 0; lastMsgSig = ''; lastMsgId = null; lastFullSync = 0; startChatPoll(); };
const origClose = closeChat; closeChat = () => { if (chatPoll) clearInterval(chatPoll); chatPoll = null; origClose(); };
window.__mailBack = () => closeChat();
// после обновления SW / reload — вернуть открытый диалог (уже с polling)
try {
  const saved = JSON.parse(sessionStorage.getItem('mailOpenChat') || 'null');
  if (saved && saved.id) {
    chatFriend = saved.id;
    chatFriendName = saved.name || '';
    openChat();
  }
} catch {}
};
