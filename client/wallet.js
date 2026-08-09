// Кошелёк (главный экран).
// Зависит от window.api, window.esc, window.navigate.
window.runWallet = function () {
  const api = window.api;
  const esc = window.esc;
  const navigate = window.navigate || ((href) => { location.href = href; });

let homeName = '';
let nextOpen = null;
const paintBubble = () => {
  const b = document.querySelector('.bubble'); if (!b) return;
  if (nextOpen && nextOpen.status === 'open') {
    const t = nextOpen.title;
    b.innerHTML = `Есть дело:<br>«${esc(t.length > 22 ? t.slice(0, 22) + '…' : t)}»`;
  } else if (homeName) {
    b.innerHTML = `С возвращением,<br>${esc(homeName)}!`;
  }
};
api('/api/state').then((s) => {
  homeName = s.name || '';
  const bal = document.getElementById('bal'); if (bal) bal.textContent = s.balance;
  paintBubble();
  const lvl = document.querySelector('.level');
  if (lvl) lvl.innerHTML = `Уровень ${s.tree_level}<br>${esc(s.tree_title || 'Саженец')}`;
  const av = document.querySelector('.lvlbadge-tree'); if (av && s.tree_asset) av.src = 'assets/' + s.tree_asset;  // надетый наряд
  initDaily(s);   // ежедневный подарок
});
// якорь петли: одно следующее открытое дело на доме
api('/api/tasks').then((tasks) => {
  const box = document.getElementById('nextDeed');
  if (!box || !Array.isArray(tasks)) return;
  nextOpen = tasks.find((t) => t.status === 'open' || t.status === 'submitted') || null;
  if (!nextOpen) return;
  box.style.display = 'block';
  document.getElementById('nextDeedTitle').textContent = nextOpen.title;
  document.getElementById('nextDeedMeta').textContent = nextOpen.status === 'submitted'
    ? 'На проверке у ведущего'
    : `+${nextOpen.reward} шишек · нажми, чтобы сделать`;
  box.onclick = () => navigate('quests.html');
  paintBubble();
});
const earnBtn = document.getElementById('earnBtn');
if (earnBtn) earnBtn.onclick = () => navigate('quests.html');
const spendBtn = document.getElementById('spendBtn');
if (spendBtn) spendBtn.onclick = () => navigate('shop.html');
const inviteBtn = document.getElementById('inviteBtn');
if (inviteBtn) inviteBtn.onclick = () => navigate('profile.html#grove');

// ── Ежедневный подарок + серия ──
function coneRain(n) {   // дождик шишек поверх экрана
  const phone = document.querySelector('.phone'); if (!phone) return;
  const box = document.createElement('div'); box.className = 'rain'; phone.appendChild(box);
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span'); s.textContent = '🌰';
    s.style.left = Math.random() * 92 + '%';
    s.style.animationDuration = (1 + Math.random() * 1.2) + 's';
    s.style.animationDelay = (Math.random() * .5) + 's';
    s.style.fontSize = (20 + Math.random() * 16) + 'px';
    box.appendChild(s);
  }
  setTimeout(() => box.remove(), 2600);
}
function initDaily(s) {
  const el = document.getElementById('daily'); if (!el) return;
  const t1 = document.getElementById('dailyT1'), t2 = document.getElementById('dailyT2');
  const fire = document.getElementById('dailyFire'), btn = document.getElementById('dailyBtn');
  const freezeEl = document.getElementById('freezeChip');
  el.style.display = 'flex';
  const paintFreeze = (n) => {
    if (!freezeEl) return;
    freezeEl.hidden = !(n > 0);
    freezeEl.textContent = `🌧×${n}`;
  };
  paintFreeze(s.streak_freezes || 0);
  if (!s.can_claim_daily) {   // уже забрал — тонкий чип, без второго этажа текста
    el.classList.add('got'); fire.textContent = '🔥';
    t1.textContent = s.streak > 0 ? `Серия ${s.streak} · завтра снова` : 'Заходи завтра за подарком';
    t2.textContent = '';
    return;
  }
  fire.textContent = s.streak > 0 ? '🔥' : '🎁';
  t1.textContent = 'Подарок ждёт!';
  t2.textContent = s.streak > 0
    ? `Серия ${s.streak} дн.` + ((s.streak_freezes || 0) > 0 ? ` · 🌧${s.streak_freezes}` : '')
    : 'Серия дней растит дерево';
  btn.onclick = async () => {
    btn.disabled = true;
    const prevLvl = s.tree_level || 1;
    const r = await api('/api/daily', {});
    if (r.error) { btn.disabled = false; t2.textContent = r.error; return; }
    const parts = [];
    if (r.bonus) parts.push(`+${r.bonus} серия`);
    if (r.milestone) parts.push(`+${r.milestone} веха`);
    if (r.rain) parts.push(`🌧+${r.rain}`);
    const total = (r.bonus || 0) + (r.milestone || 0) + (r.rain || 0);
    coneRain(12 + (r.milestone ? 18 : 0));
    el.classList.add('got'); fire.textContent = '🔥';
    const grew = (r.tree_level || prevLvl) > prevLvl;
    let msg = parts.join(' · ') || `+${total}`;
    if (r.freeze_used) msg += ' · 🌧 спас серию';
    else if (r.freeze_granted) msg += ' · +🌧 защитник';
    if (grew) msg += ` · дерево → ур. ${r.tree_level}`;
    t1.textContent = msg;
    t2.textContent = `Серия ${r.streak} дн.`;
    paintFreeze(r.freeze_granted || r.freeze_used
      ? Math.max(0, (s.streak_freezes || 0) + (r.freeze_granted ? 1 : 0) - (r.freeze_used ? 1 : 0))
      : (s.streak_freezes || 0));
    const bal = document.getElementById('bal');
    if (bal) bal.textContent = (parseInt(bal.textContent, 10) || 0) + total;
    const lvl = document.querySelector('.level');
    if (lvl && r.tree_level) {
      const titles = { 1: 'Саженец', 2: 'Дубок', 3: 'Деревце', 4: 'Крепкое', 5: 'Могучее' };
      lvl.innerHTML = `Уровень ${r.tree_level}<br>${esc(titles[r.tree_level] || s.tree_title || 'Саженец')}`;
    }
  };
}
api('/api/surprises').then((sp) => {   // есть тайные подарки → подсветить ссылку
  if (Array.isArray(sp) && sp.length) { const l = document.getElementById('spLink');
    if (l) { const n = sp.filter((x) => !x.revealed).length; l.textContent = `🎁 Шишки-сюрпризы${n ? ' (' + n + ')' : ''} →`; l.style.display = 'inline-block'; } }
});
const qrBtn = document.getElementById('qrBtn');   // QR-касса предпринимателя
const drawQr = () => {
  const amt = parseInt(document.getElementById('qrAmt').value, 10);
  let url = location.origin + '/transfers.html?pay=' + encodeURIComponent(localStorage.getItem('childCode') || '');
  if (amt > 1) url += '&amt=' + amt;                       // цена продавца зашита в код
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const svg = qr.createSvgTag({ cellSize: 5, margin: 2 });
  document.getElementById('qrSvg').innerHTML = svg.replace('<svg ', '<svg style="width:200px;height:200px" ');
};
if (qrBtn) qrBtn.onclick = () => {
  drawQr(); document.getElementById('qrAmt').oninput = drawQr;
  document.getElementById('qrBox').style.display = 'flex';
};
const qrClose = document.getElementById('qrClose');
if (qrClose) qrClose.onclick = () => { document.getElementById('qrBox').style.display = 'none'; };
// встроенный сканер: камера в приложении → сразу на экран оплаты
const scanBtn = document.getElementById('scanBtn');
let scanStream = null, scanRAF = 0;
const stopScan = () => {
  cancelAnimationFrame(scanRAF);
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  document.getElementById('scanBox').style.display = 'none';
};
if (scanBtn) scanBtn.onclick = async () => {
  const box = document.getElementById('scanBox'), video = document.getElementById('scanVideo');
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { return alert('Нет доступа к камере — разреши в настройках, или пусть продавец пришлёт ссылку'); }
  box.style.display = 'block';
  video.srcObject = scanStream; await video.play();
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!scanStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      cv.width = video.videoWidth; cv.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const hit = jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      if (hit && hit.data) {
        try {
          const u = new URL(hit.data);
          if (u.pathname.endsWith('/transfers.html') && u.searchParams.get('pay')) {   // только наши платёжные QR
            stopScan(); navigate(u.pathname + u.search); return;
          }
        } catch {}
      }
    }
    scanRAF = requestAnimationFrame(tick);
  };
  tick();
};
document.getElementById('scanClose').onclick = stopScan;
};
