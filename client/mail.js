// Лесная почта / чат.
// Зависит от window.api, window.esc.
window.runMail = function () {
  const api = window.api;
  const esc = window.esc;

// ── Чат ──
const PHRASES = ['Привет! 👋','Как дела? 😊','Давай дружить! 🤝','Спасибо! ❤️','Классно! 🔥','Давай меняться? 🔄','Помоги 🙏','Ура! 🎉','Пока! 👋','Хорошего дня! ☀️','Ты супер! ⭐','Да! ✅','Нет 🙅','Грустно 😢','Весело! 😂'];
const STICKERS = ['🦊','🐿️','🦉','🐻','🦌','🐰','🌲','🍄','🌰','🍂','🌟','❤️','🔥','😂','👍','🎉','😢','😡','🤔','🙏'];
let chatFriend = null, chatFriendName = '', replyTo = null, pressTimer = null;
const fmtTime = (iso) => { const d = new Date(iso); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };

// ── Список чатов ──
async function loadChatList() {
  const list = await api('/api/chat/list', {});
  const c = document.getElementById('chatList'); c.innerHTML = '';
  if (list.error) return;
  if (!list.length) { c.innerHTML = '<div class="noChats">В твоём кругу пока никого нет. Позови ведущего! 🌲</div>'; return; }
  for (const ch of list) {
    const el = document.createElement('div'); el.className = 'chatRow';
    let preview = ch.last_msg ? esc(ch.last_msg).slice(0, 40) : 'Написать... ✉️';
    if (preview.startsWith('/uploads/audio_')) preview = '🎤 Голосовое сообщение';
    else if (preview.startsWith('Дарю тебе карту:')) preview = '🃏 ' + preview;
    const time = ch.last_at ? fmtTime(ch.last_at) : '';
    el.innerHTML = `<div class="ava"><img src="assets/${ch.avatar}">${ch.online ? '<div class="dot"></div>' : ''}</div><div class="info"><div class="name">${esc(ch.name)}</div><div class="preview" style="${ch.last_msg ? '' : 'font-style:italic;color:#7bab4c'}">${preview}</div></div>
      <div class="meta"><div class="time">${time}</div>${ch.unread > 0 ? `<div class="badge">${ch.unread}</div>` : ''}</div>`;
    el.onclick = () => { chatFriend = ch.id; chatFriendName = ch.name; openChat(); };
    c.appendChild(el);
  }
}

// ── Детальный чат ──
let openChat = function openChat() {
  document.getElementById('chatList').style.display = 'none';
  document.getElementById('chatDetail').classList.add('open');
  document.getElementById('chName').textContent = chatFriendName;
  document.querySelector('.wrap')?.classList.add('chat-open');
  loadChat();
}
let closeChat = function closeChat() {
  document.getElementById('chatDetail').classList.remove('open');
  document.getElementById('chatList').style.display = '';
  document.querySelector('.wrap')?.classList.remove('chat-open');
  const t = document.querySelector('.title'); if (t) t.textContent = 'Лесная почта';
  chatFriend = null; chatFriendName = '';
  loadChatList();
}
async function loadChat() {
  const c = document.getElementById('chatMsgs'); c.innerHTML = '';
  if (!chatFriend) return;
  const msgs = await api('/api/chat', { with: chatFriend });
  if (msgs.error) { c.innerHTML = '<div class="emptyChat">Ошибка загрузки</div>'; return; }
  if (!msgs.length) { c.innerHTML = '<div class="emptyChat">Нет сообщений. Напиши первым! 🌱</div>'; }
  for (const m of msgs) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;';
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
    // Цитата
    if (m.reply_to) {
      const qt = document.createElement('div'); qt.className = 'replyQuote';
      qt.innerHTML = `<div class="by">↩ ${esc(m.reply_by || '...')}</div>${esc(m.reply_content || '')}`;
      el.appendChild(qt);
    }
    // Реакции
    if (m.reactions && m.reactions.length) {
      const rxRow = document.createElement('div'); rxRow.className = 'rxRow' + (m.mine ? ' mine' : '');
      // сгруппировать по emoji
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
    // Свайп вправо → ответ
    let swipeX = 0, swipeY = 0;
    el.addEventListener('touchstart', (e) => {
      swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY;
      pressTimer = setTimeout(() => { showRxPicker(e, m.id); }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      clearTimeout(pressTimer);
      const dx = e.touches[0].clientX - swipeX;
      if (Math.abs(dx) > 0) { clearTimeout(pressTimer); }
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      clearTimeout(pressTimer);
      const dx = (e.changedTouches[0]?.clientX || 0) - swipeX;
      const dy = Math.abs((e.changedTouches[0]?.clientY || 0) - swipeY);
      if (dx > 60 && dy < 30) {
        replyTo = m.id;
        document.getElementById('replyTxt').textContent = esc(m.content).slice(0, 50);
        document.getElementById('replyBar').style.display = 'flex';
        document.getElementById('msgInput').focus();
      }
    });
    c.appendChild(wrap);
  }
  loadChatList();   // обновить счётчики в списке
  c.scrollTop = c.scrollHeight;
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
    if (r.error) { const n = document.createElement('div'); n.className = 'emptyChat'; n.textContent = r.error; document.getElementById('chatMsgs').appendChild(n); }
    else { loadChat(); document.getElementById('chatMsgs').insertAdjacentHTML('beforeend', `<div class="msgBubble mine" style="background:var(--gold);color:#5b4636">🪙 ${payAmt} шишек<div class="msgTime">сейчас</div></div>`); }
  });
}
loadChatList();
// Стикеры
const stickerBar = document.getElementById('stickerBar');
STICKERS.forEach((s) => { const b = document.createElement('button'); b.textContent = s; b.onclick = () => sendSticker(s); stickerBar.appendChild(b); });

// Голосовые
let mediaRecorder = null, audioChunks = [], recTimer = null, recSecs = 0;
const micBtn = document.getElementById('micBtn'), recTime = document.getElementById('recTime');
const fmtSec = (s) => Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
const startRec = async () => {
  if (!chatFriend) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
      : '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.start();
    micBtn.classList.add('recording'); recTime.style.display = 'inline';
    recSecs = 0; recTime.textContent = '0:00';
    recTimer = setInterval(() => { recSecs++; recTime.textContent = fmtSec(recSecs); }, 1000);
  } catch { micBtn.textContent = '🚫'; setTimeout(() => micBtn.textContent = '🎤', 2000); }
};
const stopRec = async () => {
  if (!mediaRecorder) return;
  micBtn.classList.remove('recording'); recTime.style.display = 'none';
  clearInterval(recTimer);
  const recMime = mediaRecorder.mimeType;
  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: recMime || 'audio/webm' });
    const reader = new FileReader();
    reader.onload = async () => {
      const r = await api('/api/audio', { data: reader.result });
      if (!r.error && r.url) {
        await api('/api/message', { content: r.url, to: chatFriend, type: 'audio' });
        loadChat();
      }
    };
    reader.readAsDataURL(blob);
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  };
  mediaRecorder.stop(); mediaRecorder = null;
};
micBtn.onpointerdown = startRec;
micBtn.ontouchstart = (e) => { e.preventDefault(); startRec(); };
micBtn.onpointerup = stopRec;
micBtn.ontouchend = (e) => { e.preventDefault(); stopRec(); };
micBtn.ontouchcancel = () => { if (mediaRecorder) stopRec(); };
micBtn.onpointerleave = () => { if (mediaRecorder) stopRec(); };
// Ответ
window.cancelReply = () => { replyTo = null; document.getElementById('replyBar').style.display = 'none'; };
document.getElementById('replyCancel').onclick = cancelReply;
// Реакции
let rxMsgId = null;
window.react = async (msgId, emoji) => {
  await api('/api/message/react', { message_id: msgId, emoji });
  loadChat();
};
window.showRxPicker = (e, msgId) => {
  rxMsgId = msgId;
  const pk = document.getElementById('rxPicker');
  const t = e.touches ? e.touches[0] : e;
  pk.style.display = 'flex'; pk.style.left = Math.min(t.clientX - 80, window.innerWidth - 200) + 'px';
  pk.style.top = (t.clientY - 50) + 'px';
  setTimeout(() => document.addEventListener('click', hideRxPicker, { once: true }), 50);
};
const hideRxPicker = () => { document.getElementById('rxPicker').style.display = 'none'; rxMsgId = null; };
document.querySelectorAll('#rxPicker button').forEach((b) => b.onclick = () => { if (rxMsgId) { react(rxMsgId, b.textContent); hideRxPicker(); } });
// Фразы-заготовки
const phraseBar = document.getElementById('phraseBar');
PHRASES.forEach((p) => { const b = document.createElement('button'); b.textContent = p; b.onclick = () => sendMsg(p); phraseBar.appendChild(b); });
// Отправка вручную
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
// Автообновление: чат — каждые 2с, список — каждые 5с
let chatPoll = null, lastMsgCount = 0;
const startChatPoll = () => {
  if (chatPoll) clearInterval(chatPoll);
  chatPoll = setInterval(async () => {
    if (!chatFriend) return;
    const msgs = await api('/api/chat', { with: chatFriend });
    if (msgs.error || !msgs.length) return;
    if (msgs.length === lastMsgCount) return;   // нет новых — не дёргаем DOM
    lastMsgCount = msgs.length;
    const c = document.getElementById('chatMsgs');
    const wasAtBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
    c.innerHTML = '';
    for (const m of msgs) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;';
      if (m.mine) wrap.style.alignItems = 'flex-end'; else wrap.style.alignItems = 'flex-start';
      const el = document.createElement('div');
      if (m.type === 'audio') {
        el.className = 'msgAudio ' + (m.mine ? 'mine' : 'theirs');
        const a = document.createElement('audio'); a.controls = true; a.playsInline = true; a.preload = 'metadata'; a.src = m.content;
        el.appendChild(a);
        const tm = document.createElement('div'); tm.className = 'msgTime'; tm.textContent = fmtTime(m.created_at); el.appendChild(tm);
      } else if (m.type === 'sticker') {
        el.className = 'msgSticker ' + (m.mine ? 'mine' : 'theirs');
        el.innerHTML = esc(m.content) + `<div class="msgTime">${fmtTime(m.created_at)}${m.mine ? (m.is_read ? ' ✓✓' : ' ✓') : ''}</div>`;
      } else {
        el.className = 'msgBubble ' + (m.mine ? 'mine' : 'theirs');
        el.innerHTML = esc(m.content) + `<div class="msgTime">${fmtTime(m.created_at)}${m.mine ? (m.is_read ? ' ✓✓' : ' ✓') : ''}</div>`;
      }
      // Цитата
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
        wrap.appendChild(el); wrap.appendChild(rxRow);
      } else { wrap.appendChild(el); }
      c.appendChild(wrap);
    }
    if (wasAtBottom) c.scrollTop = c.scrollHeight;
  }, 2000);
};
(window.__timers || (window.__timers = [])).push(setInterval(loadChatList, 5000));
const origOpen = openChat; openChat = () => { origOpen(); lastMsgCount = 0; startChatPoll(); };
const origClose = closeChat; closeChat = () => { if (chatPoll) clearInterval(chatPoll); chatPoll = null; origClose(); };
};
