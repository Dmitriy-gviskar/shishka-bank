// Связка клиента с локальным сервером: баланс, задания, магазин — живые данные.
async function api(path, body, method) {
  const headers = {};
  const code = localStorage.getItem('childCode');
  if (code) headers['x-child-code'] = encodeURIComponent(code);   // привязка устройства к профилю
  if (path.includes('/api/parent/')) { const pin = localStorage.getItem('parentPin'); if (pin) headers['x-parent-pin'] = pin; }
  const post = body !== undefined || method === 'POST';
  const opt = post ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }
                   : { headers };
  try {
    if (!post) {                              // GET — кэш на 45с: переходы между экранами мгновенные
      const k = 'ac:' + (code || '') + ':' + path;
      const hit = JSON.parse(sessionStorage.getItem(k) || 'null');
      if (hit && Date.now() - hit.t < 45e3) return hit.d;
      const d = await (await fetch(path, opt)).json();
      if (d && !d.error) try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch {}
      return d;
    }
    const r = await (await fetch(path, opt)).json();  // действие — сбросить кэш, данные изменились
    if (path !== '/api/guild/chat') for (const k of Object.keys(sessionStorage)) if (k.startsWith('ac:')) sessionStorage.removeItem(k);
    return r;
  }
  catch { return { error: 'Нет связи с лесом — проверь интернет и попробуй ещё раз' }; }
}
// экранирование пользовательских строк перед вставкой в innerHTML (защита от stored XSS)
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const page = location.pathname.split('/').pop() || 'index.html';
// вход по ссылке ?code=РОСТ-01 (родитель может дать прямую ссылку)
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) localStorage.setItem('childCode', urlCode.toUpperCase());
// не привязан → на экран ввода кода (родителю и онбордингу код не нужен)
if (page !== 'link.html' && page !== 'parent.html' && !localStorage.getItem('childCode'))
  location.href = 'link.html';

// ── Вход по коду (привязка ребёнка) ──
if (page === 'link.html') {
  // коды детям раздаёт ведущий лично — на экране входа их не показываем
  document.getElementById('linkBtn').onclick = async () => {
    const code = document.getElementById('codeInput').value.trim();
    const r = await api('/api/link', { code });
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { localStorage.setItem('childCode', code.toUpperCase()); location.href = 'index.html'; }
  };
}

// ── Кошелёк ──
if (page === 'index.html' || page === '') {
  api('/api/state').then((s) => {
    const bal = document.getElementById('bal'); if (bal) bal.textContent = s.balance;
    const b = document.querySelector('.bubble'); if (b) b.innerHTML = `С возвращением,<br>${esc(s.name)}!`;
    const lvl = document.querySelector('.level'); if (lvl) lvl.innerHTML = `Дубок<br>Уровень ${s.tree_level}`;
    const av = document.querySelector('.avatar img'); if (av && s.tree_asset) av.src = 'assets/' + s.tree_asset;  // надетый наряд
    initDaily(s);   // ежедневный подарок
  });
  const add = document.querySelector('.add');   // «Пополнить» → зарабатывай заданиями
  if (add) add.onclick = () => location.href = 'quests.html';

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
    el.style.display = 'flex';
    if (!s.can_claim_daily) {   // уже забрал сегодня
      el.classList.add('got'); fire.textContent = '🌙'; btn.style.display = 'none';
      t1.textContent = 'Подарок получен';
      t2.textContent = s.streak > 0 ? `Серия: ${s.streak} 🔥 · заходи завтра` : 'Заходи завтра';
      return;
    }
    fire.textContent = s.streak > 0 ? '🔥' : '🎁';
    t1.textContent = 'Подарок ждёт!';
    t2.textContent = s.streak > 0 ? `Серия: ${s.streak} дн. — не потеряй!` : 'Начни свою серию';
    btn.onclick = async () => {
      btn.disabled = true;
      const r = await api('/api/daily', {});
      if (r.error) { btn.disabled = false; t2.textContent = r.error; return; }
      const total = (r.bonus || 0) + (r.milestone || 0) + (r.rain || 0);
      coneRain(12 + (r.milestone ? 18 : 0));
      el.classList.add('got'); fire.textContent = '🔥'; btn.style.display = 'none';
      t1.innerHTML = `+${total} 🌰 · серия ${r.streak}`;
      let line = r.milestone ? `Веха ${r.streak} дней! +${r.milestone} бонус 🎉`
               : r.freeze_used ? 'Защитник спас серию!'
               : 'Возвращайся завтра за бо́льшим';
      if (r.freeze_granted) line += ' · +1 защитник ❄️';
      t2.textContent = line;
      const bal = document.getElementById('bal');
      if (bal) bal.textContent = (parseInt(bal.textContent, 10) || 0) + total;
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
              stopScan(); location.href = u.pathname + u.search; return;
            }
          } catch {}
        }
      }
      scanRAF = requestAnimationFrame(tick);
    };
    tick();
  };
  document.getElementById('scanClose').onclick = stopScan;
}

// ── Задания ──
async function loadTasks() {
  const tasks = await api('/api/tasks');
  const cont = document.getElementById('taskList'); cont.innerHTML = '';
  for (const t of tasks) {
    const done = t.status === 'done';
    const submitted = t.status === 'submitted';
    const el = document.createElement('div'); el.className = 'card quest';
    el.innerHTML = `<div class="ic"><img src="assets/coin1.webp"></div>
      <div class="mid"><div class="nm">${t.title}</div>
        <div class="rw"><img src="assets/coin1.webp">+${t.reward}</div></div>
      ${done ? '<span class="done">Выполнено</span>'
             : submitted ? '<span class="done" style="background:#e8b64b">На проверке</span>'
             : `<button class="btn btn-sm">${t.needs_photo ? 'Фото' : 'Готово'}</button>`}`;
    if (!done && !submitted) el.querySelector('button').onclick = async () => {
      const say = (t2, ok) => { const n = document.getElementById('note'); if (n) { n.style.display = 'block'; n.textContent = t2; n.style.color = ok ? '#5f8e37' : '#b3452e'; } };
      let photo;
      if (t.needs_photo) {                                   // фото-задание: камера → сжатие → base64
        photo = await new Promise((res) => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
          inp.onchange = () => {
            const f = inp.files[0]; if (!f) return res(null);
            const draw = (img, w, h) => {
              const k = Math.min(1, 1280 / Math.max(w, h));
              const cv = document.createElement('canvas');
              cv.width = Math.round(w * k); cv.height = Math.round(h * k);
              cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
              res(cv.toDataURL('image/jpeg', 0.8));
            };
            if (window.createImageBitmap) {   // уважает EXIF-поворот — фото не ляжет боком
              createImageBitmap(f, { imageOrientation: 'from-image' })
                .then((bm) => draw(bm, bm.width, bm.height))
                .catch(() => res(null));
            } else {
              const img = new Image();
              img.onload = () => draw(img, img.width, img.height);
              img.onerror = () => res(null);
              img.src = URL.createObjectURL(f);
            }
          };
          inp.oncancel = () => res(null);
          inp.click();
        });
        if (!photo) return;
        say('Отправляю фото…', 1);
      }
      const r = await api('/api/task/done', { id: t.id, photo });
      if (r.ok) { loadTasks(); say('Отправлено ведущему на проверку!', 1); }
      else say(r.error || 'не получилось');
    };
    cont.appendChild(el);
  }
}
if (page === 'quests.html') loadTasks();

// ── Магазин впечатлений ──
async function loadShop() {
  const items = await api('/api/shop');
  const cont = document.getElementById('shopList'); cont.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div'); el.className = 'card lot';
    el.innerHTML = `<div class="nm">${esc(it.title)}</div>
      <div class="right"><div class="price"><img src="assets/coin1.webp">${it.price}</div>
      <button class="btn btn-sm">Купить</button></div>`;
    el.querySelector('button').onclick = async () => {
      const r = await api('/api/shop/buy', { id: it.id });
      if (r.error) { const n = document.getElementById('note'); if (n) { n.textContent = r.error; n.style.display = 'block'; } }
      else { loadShop(); refreshBalance(); }
    };
    cont.appendChild(el);
  }
}
if (page === 'shop.html') loadShop();

// ── Переводы ──
let selFriend = null;
async function loadFriends() {
  const fr = await api('/api/friends');
  const c = document.getElementById('friendList'); c.innerHTML = '';
  fr.forEach((f, i) => {
    const el = document.createElement('div'); el.className = 'friend' + (i === 0 ? ' sel' : '');
    if (i === 0) selFriend = f.id;
    el.innerHTML = `<img src="assets/${f.avatar}"><span>${esc(f.name)}</span>`;
    el.onclick = () => { selFriend = f.id; [...c.children].forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); };
    c.appendChild(el);
  });
}
let giftAmount = 25, qrRecipient = null, qrFixedAmt = null;
if (page === 'transfers.html') {
  // пришли по QR продавца (?pay=КОД) — режим ОПЛАТЫ (pay_cones, не подарок)
  const payCode = new URLSearchParams(location.search).get('pay');
  if (payCode && payCode.toUpperCase() !== (localStorage.getItem('childCode') || '')) {
    api('/api/link', { code: payCode }).then((r) => {
      if (r.error) { loadFriends(); return; }
      qrRecipient = payCode.toUpperCase();
      document.querySelector('.title').textContent = 'Оплата';
      document.getElementById('friendList').innerHTML =
        `<div class="friend sel" style="flex:none;width:100%;padding:12px"><span style="font-size:15px">Платишь: ${r.name}</span></div>`;
      const cards = document.querySelector('.cards'); if (cards) cards.style.display = 'none';   // открытки — только для подарков
      const anonRow = document.getElementById('anonRow'); if (anonRow) anonRow.style.display = 'none';   // тайно — только для подарков
      const fixedAmt = parseInt(new URLSearchParams(location.search).get('amt'), 10);
      if (fixedAmt > 1) {   // продавец назначил цену — это счёт, сумма зафиксирована
        qrFixedAmt = fixedAmt;
        document.querySelector('.apick').style.display = 'none';
        document.querySelector('.apick').insertAdjacentHTML('afterend',
          `<div class="on-art" style="text-align:center;font-weight:900;color:var(--ink);font-size:22px;margin:10px auto 0;display:block;width:fit-content">К оплате: ${fixedAmt} шишек</div>
           <div class="on-art" style="color:#8a7358;font-weight:700;font-size:12px;margin:6px auto 0;display:block;width:fit-content">Комиссия Банка — 1 шишка со сделки</div>`);
        const btn0 = document.querySelector('.btn-lg'); if (btn0) btn0.textContent = 'Оплатить ' + fixedAmt;
        return;
      }
      document.querySelector('.apick').insertAdjacentHTML('afterend',
        `<div style="text-align:center;margin-top:8px"><input id="payAmt" type="number" min="2" placeholder="или своя сумма" inputmode="numeric"
           style="width:70%;background:#fffaf0;border:3px solid #d9c39a;border-radius:14px;padding:10px;font-size:18px;font-weight:900;color:var(--ink);text-align:center;outline:none">
         <div class="on-art" style="color:#8a7358;font-weight:700;font-size:12px;margin-top:6px">Комиссия Банка — 1 шишка со сделки</div></div>`);
      const btn = document.querySelector('.btn-lg'); if (btn) btn.textContent = 'Оплатить';
    });
  } else loadFriends();
  document.querySelectorAll('.apick .ap').forEach((a) => a.onclick = () => {
    document.querySelectorAll('.apick .ap').forEach((x) => x.classList.remove('sel')); a.classList.add('sel'); giftAmount = +a.dataset.a; });
  document.querySelectorAll('.postcards .pc').forEach((p) => p.onclick = () => {
    document.querySelectorAll('.postcards .pc').forEach((x) => x.classList.remove('sel')); p.classList.add('sel'); });
  const anon = document.getElementById('anon');
  if (anon) anon.onchange = () => {   // тайный подарок — без открытки (это сюрприз)
    const cards = document.querySelector('.cards'); if (cards) cards.style.display = anon.checked ? 'none' : '';
    const btn2 = document.querySelector('.btn-lg'); if (btn2 && !qrRecipient) btn2.textContent = anon.checked ? 'Отправить тайно' : 'Отправить подарок';
  };
  const btn = document.querySelector('.btn-lg');
  if (btn) btn.onclick = async () => {
    const custom = parseInt(document.getElementById('payAmt')?.value, 10);
    const isAnon = document.getElementById('anon')?.checked;
    const r = qrRecipient
      ? await api('/api/pay', { toCode: qrRecipient, amount: qrFixedAmt || (custom > 0 ? custom : giftAmount) })
      : isAnon
        ? await api('/api/surprise', { to: selFriend, amount: giftAmount })
        : await api('/api/transfer', { to: selFriend, amount: giftAmount });
    const n = document.getElementById('note'); if (!n) return;
    n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { n.textContent = qrRecipient ? `Оплачено! ${r.to} получил шишки. Осталось ` + r.balance
      : isAnon ? `Тайный подарок отправлен! Друг не узнает кто — если не расследует. Осталось ` + r.balance
      : `Подарок ${giftAmount} отправлен! Осталось ` + r.balance; n.style.color = '#5f8e37'; refreshBalance(); }
  };
}

// ── Лавки ──
async function loadMarket() {
  const shops = await api('/api/shops');
  const c = document.getElementById('marketList'); c.innerHTML = '';
  for (const s of shops) {
    const el = document.createElement('div'); el.className = 'card shop';
    el.innerHTML = `${s.is_heir ? '<span class="heir">Наследник</span>' : ''}${s.mine ? '<span class="mine-tag">Моя</span>' : ''}
      <img class="av" src="assets/${s.avatar}">
      <div class="mid"><div class="sn">${s.name}</div><div class="it">${s.lot.title}</div></div>
      <div class="right"><div class="price"><img src="assets/coin1.webp">${s.lot.price}</div>
      ${s.mine ? '' : '<button class="btn btn-sm">Купить</button>'}</div>`;
    const buyBtn = el.querySelector('button');
    if (buyBtn) buyBtn.onclick = async () => {
      const r = await api('/api/lot/buy', { id: s.lot.id });
      const n = document.getElementById('note'); if (!n) return;
      n.style.display = 'block';
      if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
      else { n.textContent = 'Куплено у ' + s.name + '! Осталось ' + r.balance; n.style.color = '#5f8e37'; refreshBalance(); }
    };
    c.appendChild(el);
  }
}
if (page === 'market.html') {
  loadMarket();
  document.getElementById('openShopBtn').onclick = () => {
    const f = document.getElementById('createForm'); f.style.display = f.style.display === 'block' ? 'none' : 'block';
  };
  document.getElementById('createShopBtn').onclick = async () => {
    const name = document.getElementById('shopName').value, lot = document.getElementById('shopLot').value, price = document.getElementById('shopPrice').value;
    const r = await api('/api/shop/create', { name, lot, price });
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { n.textContent = 'Твоя лавка открыта!'; n.style.color = '#5f8e37';
      document.getElementById('createForm').style.display = 'none'; loadMarket(); }
  };
}

// ── Профиль ──
if (page === 'profile.html') {
  const su = document.getElementById('switchUser');   // сменить пользователя → экран кода
  if (su) su.onclick = (e) => { e.preventDefault(); localStorage.removeItem('childCode'); location.href = 'link.html'; };
  const nar = document.querySelector('.profile-btn'); // «Сменить наряд» → экран нарядов
  if (nar) nar.onclick = () => location.href = 'skins.html';
  api('/api/state').then((s) => { const h = document.querySelector('.hero img'); if (h && s.skin_on) h.src = 'assets/' + s.tree_asset; });  // наряд перекрывает арт только если надет
  api('/api/profile').then((p) => {
    const ll = document.getElementById('levelLabel'); if (ll) ll.textContent = `Дубок · Уровень ${p.tree_level}`;
    const prog = document.querySelector('.progress i'); if (prog) prog.style.width = Math.min(100, p.tree_level * 18) + '%';  // прогресс из уровня
    for (const [k, v] of Object.entries(p.reputation)) {
      const bar = document.querySelector(`[data-trait="${k}"]`); if (bar) bar.style.width = v + '%';
    }
    const bc = document.querySelector('.badges'); if (bc) {   // бейджи из данных ребёнка, а не хардкод
      const arts = { guardian: 'badge1.webp', philanthropist: 'badge2.webp', saver: 'badge3.webp' };
      bc.innerHTML = p.badges.length ? p.badges.map((b) => `<div class="badge"><img src="assets/${arts[b.code] || 'badge1.webp'}"><span>${esc(b.title)}</span></div>`).join('')
        : '<div style="width:100%;text-align:center;padding:6px"><span class="on-art" style="color:#8a7358;font-weight:700;font-size:13px">Пока нет наград — выполняй задания!</span></div>';
    }
  });
}

// ── Достижения (витрина) ──
async function loadAch() {
  const list = await api('/api/achievements');
  const unlocked = list.filter((a) => a.unlocked).length;
  document.getElementById('achCount').textContent = `Открыто ${unlocked} из ${list.length}`;
  const g = document.getElementById('achList'); g.innerHTML = '';
  for (const a of list) {
    const el = document.createElement('div'); el.className = 'ach' + (a.unlocked ? '' : ' lock');
    const pct = Math.min(100, Math.round(a.current / a.threshold * 100));
    el.innerHTML = `<img src="assets/ach/icon_${a.track}.png" onerror="this.src='assets/coin1.webp'">
      <div class="t">${a.title}</div>
      <div class="d">${a.desc}</div>
      <div class="pb"><i style="width:${pct}%"></i></div>`;
    el.title = `${a.desc} — ${a.current}/${a.threshold}`;
    g.appendChild(el);
  }
}
if (page === 'achievements.html') loadAch();

// ── Баланс-шапка на всех экранах + обновление после действий ──
function mountTopbar() {
  if (document.body.dataset.noNav !== undefined) return;
  if (page === 'index.html' || page === '') return;   // на кошельке баланс уже крупно, шапка лишняя
  if (document.getElementById('topbar')) return;
  const t = document.createElement('div'); t.id = 'topbar';
  t.innerHTML = `<img src="assets/coin1.webp"><span id="topBal">…</span>`;
  document.querySelector('.phone').appendChild(t);
}
async function refreshBalance() {
  const el = document.getElementById('topBal'); if (!el) return;
  const s = await api('/api/state'); el.textContent = s.balance;
}
mountTopbar(); refreshBalance();

// ── Дупло-сейф ──
let depDays = 3, depAmount = 10;
async function loadSafes() {
  const safes = await api('/api/safes'); const c = document.getElementById('safeList'); c.innerHTML = '';
  if (!safes.length) { c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700;font-size:13px">Пока ничего не заморожено</span></div>'; return; }
  for (const s of safes) {
    const el = document.createElement('div'); el.className = 'card safe';
    el.innerHTML = `<div class="amt">${s.amount} <img src="assets/coin1.webp" style="width:20px;vertical-align:-3px"> +${s.rate}%</div>
      ${s.ready ? '<button class="btn btn-sm">Забрать</button>' : `<span class="st">осталось ${s.days_left} дн.</span>`}`;
    if (s.ready) el.querySelector('button').onclick = async () => {
      const r = await api('/api/safe/redeem', { id: s.id }); const n = document.getElementById('note'); n.style.display = 'block';
      if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
      else { n.textContent = 'Забрал ' + r.gained + ' шишек!'; n.style.color = '#5f8e37'; loadSafes(); refreshBalance(); }
    };
    c.appendChild(el);
  }
}
if (page === 'deposit.html') {
  loadSafes();
  document.querySelectorAll('.term').forEach((t) => t.onclick = () => { document.querySelectorAll('.term').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); depDays = +t.dataset.days; });
  document.querySelectorAll('.sum .s').forEach((t) => t.onclick = () => { document.querySelectorAll('.sum .s').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); depAmount = +t.dataset.a; });
  document.getElementById('freeze').onclick = async () => {
    const r = await api('/api/safe/open', { amount: depAmount, days: depDays }); const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { n.textContent = `Заморожено ${depAmount} на ${depDays} дн.`; n.style.color = '#5f8e37'; loadSafes(); refreshBalance(); }
  };
}

// ── Гороскоп ──
if (page === 'horoscope.html') {
  api('/api/horoscope').then((h) => {
    document.getElementById('pred').textContent = h.text;
    if (h.bonus > 0) { document.getElementById('bonus').style.display = 'block';
      document.getElementById('bonusN').textContent = '+' + h.bonus + ' счастливых шишек'; refreshBalance(); }
  });
}

// ── Котлы желаний: общий список + свои котлы (в т.ч. гильдейские) ──
if (page === 'pot.html') {
  const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
  async function loadPots() {
    const list = await api('/api/pot');
    const c = document.getElementById('potList'); c.innerHTML = '';
    if (list.error) return note(list.error);
    if (!list.length) c.innerHTML = '<div style="text-align:center;padding:8px"><span class="on-art" style="color:#8a7358;font-weight:700">Котлов пока нет — поставь первый!</span></div>';
    for (const p of list) {
      const pct = Math.min(100, Math.round(p.collected / p.goal * 100));
      const full = p.collected >= p.goal;
      const el = document.createElement('div'); el.className = 'card pcard';
      el.innerHTML = `${p.guild ? `<span class="tag">${esc(p.guild)}</span>` : ''}
        <div class="pn">${esc(p.title)}</div><div class="pa">поставил: ${esc(p.author)}</div>
        <div class="scale"><i style="width:${pct}%"></i><span>${p.collected} / ${p.goal}</span></div>
        ${full ? '<div class="pa" style="color:#5f8e37;font-weight:800;margin-top:6px">Цель достигнута!</div>'
               : `<div class="give"><div class="s sel" data-a="5">5</div><div class="s" data-a="10">10</div><div class="s" data-a="20">20</div>
                  <button class="btn btn-sm">Вложить</button></div>`}`;
      let amt = 5;
      el.querySelectorAll('.give .s').forEach((t) => t.onclick = () => {
        el.querySelectorAll('.give .s').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); amt = +t.dataset.a; });
      const btn = el.querySelector('.give .btn');
      if (btn) btn.onclick = async () => {
        const r = await api('/api/pot/contribute', { id: p.id, amount: amt });
        if (r.error) note(r.error);
        else { note('Вложено ' + amt + '!', 1); refreshBalance(); loadPots(); }
      };
      c.appendChild(el);
    }
  }
  api('/api/guilds').then((gs) => {   // свои гильдии — в выбор «чей котёл»
    if (gs.error) return;
    const sel = document.getElementById('potGuild');
    for (const g of gs.filter((x) => x.mine)) { const o = document.createElement('option'); o.value = g.id; o.textContent = 'Гильдия «' + g.name + '»'; sel.appendChild(o); }
  });
  document.getElementById('createPot').onclick = async () => {
    const r = await api('/api/pot/create', { title: document.getElementById('potTitle').value,
      goal: document.getElementById('potGoal').value, guildId: document.getElementById('potGuild').value || undefined });
    if (r.error) note(r.error);
    else { note('Котёл поставлен!', 1); document.getElementById('potTitle').value = ''; document.getElementById('potGoal').value = ''; loadPots(); }
  };
  loadPots();
}

// Онбординг убран: дети входят по личному коду от ведущего (см. фикс захвата ТАЯ-01).

// PWA: офлайн-кэш
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ── Почта ──
async function loadInbox() {
  const list = await api('/api/inbox'); const c = document.getElementById('inbox'); c.innerHTML = '';
  for (const m of list) { const el = document.createElement('div'); el.className = 'card msg' + (m.whisper ? ' whisper' : '');
    el.innerHTML = `<div class="who">${esc(m.from_name)}</div><div class="txt">${esc(m.content)}</div>${m.whisper ? '<span class="wtag">Шёпот</span>' : `<span class="k">${esc(m.kind)}</span>`}`;
    c.appendChild(el); }
}
if (page === 'mail.html') {
  loadInbox(); loadFriends();
  document.querySelectorAll('.send button').forEach((b) => b.onclick = async () => {
    const r = await api('/api/message', { emoji: b.textContent, to: selFriend }); const n = document.getElementById('note');
    n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { n.textContent = 'Отправлено: ' + b.textContent; n.style.color = '#5f8e37'; loadInbox(); } });
}

// ── Аукцион ──
let bidAmount = 5, curBidNow = 0;
if (page === 'auction.html') {
  let tick = null;
  const fmt = (ms) => {   // «2д 3ч 15м» / когда меньше суток — «3ч 15м 09с»
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400),
      h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return d > 0 ? `${d}д ${h}ч ${m}м` : `${h}ч ${m}м ${String(ss).padStart(2, '0')}с`;
  };
  const showWinner = (a) => {   // живого аукциона нет — показать победителя последнего
    if (tick) clearInterval(tick);
    document.getElementById('liveBox').style.display = 'none';
    const box = document.getElementById('winnerBox'); box.style.display = 'block';
    box.innerHTML = a && a.winner
      ? `<div class="cup">🏆</div>Победитель аукциона<div class="who">${a.winner}</div>` +
        `<div class="sub">«${a.title}» — ставка ${a.final_bid} 🌰<br>Новый аукцион скоро!</div>`
      : `<div class="cup">🌲</div>Аукцион скоро вернётся<div class="sub">Следи за новостями леса</div>`;
  };
  const startTimer = (endsAt) => {
    if (tick) clearInterval(tick);
    const el = document.getElementById('timer'), val = document.getElementById('timerVal');
    if (!endsAt) { el.style.display = 'none'; return; }
    const end = new Date(endsAt).getTime();
    const upd = () => {
      const left = end - Date.now();
      if (left <= 0) { clearInterval(tick); for (const k of Object.keys(sessionStorage)) if (k.startsWith('ac:')) sessionStorage.removeItem(k); api('/api/auction').then(render); return; }
      val.textContent = fmt(left);
      el.classList.toggle('soon', left < 3600e3);   // меньше часа — красный
      el.style.display = 'flex';
    };
    upd(); tick = setInterval(upd, 1000);
  };
  const render = (a) => {
    if (!a || a.live === false) { showWinner(a); return; }
    document.getElementById('liveBox').style.display = 'block';
    document.getElementById('winnerBox').style.display = 'none';
    document.getElementById('lotName').textContent = a.title || '—';
    curBidNow = a.current_bid || 0;
    document.getElementById('curBid').textContent = curBidNow;
    document.getElementById('lead').textContent = 'Лидер: ' + (a.leader || 'нет');
    startTimer(a.ends_at);
  };
  api('/api/auction').then(render);
  document.querySelectorAll('.bids .s').forEach((t) => t.onclick = () => { document.querySelectorAll('.bids .s').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); bidAmount = +t.dataset.a; });
  document.getElementById('doBid').onclick = async () => {
    const custom = parseInt(document.getElementById('bidCustom').value, 10);
    const bid = custom > 0 ? custom : curBidNow + bidAmount;   // пресет = прибавка к текущей
    const r = await api('/api/bid', { amount: bid });
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { document.getElementById('curBid').textContent = r.current_bid; document.getElementById('lead').textContent = 'Лидер: ' + (r.leader || 'ты');
      n.textContent = 'Твоя ставка принята!'; n.style.color = '#5f8e37'; refreshBalance(); } };
}

// ── Страховка ──
function renderIns(d) { document.getElementById('fund').textContent = d.fund;
  const c = document.getElementById('claims'); c.innerHTML = '';
  for (const cl of d.claims) { const el = document.createElement('div'); el.className = 'card claim';
    const resolved = cl.status && cl.status !== 'voting';
    el.innerHTML = `<div class="t">${esc(cl.title)}</div><div class="row"><span class="votes">За ${cl.yes} · Против ${cl.no} · нужно ${cl.amount}${!resolved && cl.voted ? ' · твой голос учтён' : ''}</span>${resolved ? voteOutcome(cl.status) : (cl.voted ? '' : '<button class="vbtn yes">За</button><button class="vbtn no">Против</button>')}</div>`;
    if (!resolved && !cl.voted) {
      el.querySelector('.yes').onclick = async () => { await api('/api/vote', { id: cl.id, choice: 'yes' }); api('/api/insurance').then(renderIns); };
      el.querySelector('.no').onclick = async () => { await api('/api/vote', { id: cl.id, choice: 'no' }); api('/api/insurance').then(renderIns); };
    }
    c.appendChild(el); } }
if (page === 'insurance.html') {
  api('/api/insurance').then(renderIns);
  document.getElementById('premium').onclick = async () => { const r = await api('/api/premium', {});
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { document.getElementById('fund').textContent = r.fund; n.textContent = 'Спасибо за взнос!'; n.style.color = '#5f8e37'; refreshBalance(); } };
}

// ── Совет ──
function voteOutcome(status) {
  if (status === 'accepted') return '<span style="color:#5f8e37;font-weight:900">Принято</span>';
  if (status === 'rejected') return '<span style="color:#b3452e;font-weight:900">Отклонено</span>';
  return '';
}
function renderProps(list) { const c = document.getElementById('props'); c.innerHTML = '';
  for (const p of list) { const el = document.createElement('div'); el.className = 'card prop';
    const resolved = p.status && p.status !== 'voting';
    el.innerHTML = `<div class="t">${esc(p.title)}</div><div class="row"><span class="tally">За ${p.yes} · Против ${p.no}${!resolved && p.voted ? ' · ты проголосовал' : ''}</span>${resolved ? voteOutcome(p.status) : (p.voted ? '' : '<button class="vbtn yes">За</button><button class="vbtn no">Против</button>')}</div>`;
    if (!resolved && !p.voted) {
      el.querySelector('.yes').onclick = async () => { await api('/api/vote', { id: p.id, choice: 'yes' }); api('/api/proposals').then(renderProps); };
      el.querySelector('.no').onclick = async () => { await api('/api/vote', { id: p.id, choice: 'no' }); api('/api/proposals').then(renderProps); };
    }
    c.appendChild(el); } }
if (page === 'council.html') api('/api/proposals').then(renderProps);

// ── Гильдии: список → своя гильдия с чатом-костром ──
if (page === 'guilds.html') {
  const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
  const PHRASES = ['Собираемся!', 'Заказ готов!', 'Молодцы!', 'Нужна помощь', 'Ура!', 'Я за!'];
  let curGuild = null, chatTimer = null;

  async function loadGuilds() {
    const gs = await api('/api/guilds');
    const c = document.getElementById('glist'); c.innerHTML = '';
    if (gs.error) return note(gs.error);
    if (!gs.length) c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700">Гильдий пока нет — основай первую!</span></div>';
    for (const g of gs) {
      const el = document.createElement('div'); el.className = 'card gcard';
      el.innerHTML = `<div class="gn">${esc(g.name)}</div><div class="gm">${g.members.map((m) => esc(m.name)).join(', ')}</div>
        <div class="row">${g.mine ? '<button class="btn btn-sm open">Войти</button>' : '<button class="btn btn-sm join" style="background:#e8b64b;box-shadow:0 4px 0 #c79a3c">Вступить</button>'}</div>`;
      const open = el.querySelector('.open');
      if (open) open.onclick = () => showGuild(g);
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

  function showGuild(g) {
    curGuild = g;
    document.getElementById('listView').style.display = 'none';
    document.getElementById('guildView').style.display = 'flex';
    document.getElementById('gTitle').textContent = g.name;
    const m = document.getElementById('gMembers'); m.innerHTML = '';
    for (const x of g.members) { const el = document.createElement('div'); el.className = 'card mrow';
      el.innerHTML = `<span class="nm">${esc(x.name)}</span><span class="share">доля ${x.share}</span>`; m.appendChild(el); }
    const p = document.getElementById('phrases'); p.innerHTML = '';
    for (const ph of PHRASES) { const b = document.createElement('button'); b.textContent = ph;
      b.onclick = async () => { const r = await api('/api/guild/say', { id: g.id, phrase: ph }); if (r.error) note(r.error); else loadChat(); };
      p.appendChild(b); }
    loadChat();
    chatTimer = setInterval(loadChat, 15e3);   // костёр обновляется сам
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
}

// ── Нарративный квест ──
function qnote(t) { const n = document.getElementById('note'); if (n) { n.style.display = 'block'; n.textContent = t; n.style.color = '#b3452e'; } }
function renderQuest(q) {
  const btn = document.getElementById('qact'), pr = document.getElementById('qprog');
  if (q.done || q.status === 'completed') { document.getElementById('story').textContent = 'Квест пройден! Награда получена всей семьёй.';
    document.getElementById('stepTag').textContent = 'Завершено'; btn.style.display = 'none'; pr.style.display = 'none'; return; }
  const st = q.step; document.getElementById('story').textContent = st.text;
  document.getElementById('stepTag').textContent = 'Шаг ' + st.ord;
  const stepDone = (st.kind === 'collect' || st.kind === 'task') && st.progress >= st.goal;
  if (st.kind === 'collect' || st.kind === 'task') { pr.style.display = 'block';
    document.getElementById('qfill').style.width = Math.min(100, Math.round(st.progress / st.goal * 100)) + '%';
    document.getElementById('qtext').textContent = st.progress + ' / ' + st.goal; } else pr.style.display = 'none';
  if (st.kind === 'narrative' || stepDone) { btn.textContent = 'Дальше';
    btn.onclick = async () => { const r = await api('/api/quest/advance', {}); if (r.error) qnote(r.error); else renderQuest(r); }; }
  else if (st.kind === 'collect') { btn.textContent = 'Вложить 5 в фонд';
    btn.onclick = async () => { const r = await api('/api/quest/act', { amount: 5 }); if (r.error) qnote(r.error); else { renderQuest(r); refreshBalance(); } }; }
  else { btn.textContent = 'Обыскать поляну'; btn.onclick = async () => renderQuest(await api('/api/quest/act', {})); }
}
if (page === 'quest.html') api('/api/quest').then(renderQuest);

// ── Наряды дерева (скины) ──
function skinNote(t, ok) { const n = document.getElementById('note'); if (n) { n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; } }
async function loadSkins() {
  const list = await api('/api/skins');
  const g = document.getElementById('skinList'); g.innerHTML = '';
  const rarName = { base: '', seasonal: 'сезон', rare: 'редкий', epic: 'эпик' };
  for (const s of list) {
    const el = document.createElement('div'); el.className = 'skin rar ' + s.rarity + (s.equipped ? ' on' : '');
    const asset = s.asset === 'base' ? 'tree.webp' : s.asset + '.png';
    let ctrl;
    if (s.equipped) ctrl = '<span class="st on">Надето</span>';
    else if (s.owned) ctrl = '<button class="btn btn-sm eq">Надеть</button>';
    else ctrl = `<button class="btn btn-sm buy">Купить · ${s.price}</button>`;
    el.innerHTML = `${rarName[s.rarity] ? `<b>${rarName[s.rarity]}</b>` : ''}<img src="assets/${asset}" onerror="this.src='assets/tree.webp'"><div class="t">${esc(s.title)}</div>${ctrl}`;
    const buy = el.querySelector('.buy'); if (buy) buy.onclick = async () => { const r = await api('/api/skin/buy', { id: s.id }); if (r.error) skinNote(r.error); else { loadSkins(); refreshBalance(); } };
    const eq = el.querySelector('.eq'); if (eq) eq.onclick = async () => { await api('/api/skin/equip', { id: s.id }); loadSkins(); };
    g.appendChild(el);
  }
}
if (page === 'skins.html') loadSkins();

// ── Лесной альбом ──
if (page === 'album.html') {
  const KIND_RU = { earn: ['Заработано', '+'], gift_in: ['Подарок от друга', '+'], gift_out: ['Подарок другу', '−'],
    buy: ['Покупка', '−'], spend: ['Оплата', '−'], interest: ['Проценты Дупла', '+'], deposit: ['Дупло-сейф', '−'],
    insurance: ['Страховка', '−'], pot: ['Вклад в котёл', '−'], payout: ['От Банка', '+'], achievement: ['Достижение', '+'], photo: ['Фотоотчёт', ''] };
  const PAGE = 25;
  api('/api/album').then((evs) => {
    const c = document.getElementById('albumList'); c.innerHTML = '';
    if (evs.error || !evs.length) { c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700">Пока пусто — соверши первое доброе дело!</span></div>'; return; }
    let shown = 0;
    const more = document.createElement('button');
    more.className = 'btn btn-sm';
    more.style.cssText = 'display:block;margin:4px auto 10px;background:#fff3d6;color:var(--brown);box-shadow:0 4px 0 #d9c39a';
    const renderChunk = () => {
      for (const e of evs.slice(shown, shown + PAGE)) {
        const [label, sign] = KIND_RU[e.kind] || [e.kind, ''];
        const when = new Date(e.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        const el = document.createElement('div'); el.className = 'card ev';
        el.innerHTML = `<img src="assets/coin1.webp"><div><div class="nm">${esc(e.title || label)}</div><div class="k">${esc(label)} · ${when}</div></div>` +
          (e.amount ? `<div class="amt" style="color:${sign === '−' ? '#b3452e' : '#5f8e37'}">${sign}${e.amount}</div>` : '');
        c.insertBefore(el, more.parentNode === c ? more : null);
      }
      shown = Math.min(shown + PAGE, evs.length);
      more.textContent = `Показать ещё (${evs.length - shown})`;
      if (shown >= evs.length) more.remove(); else if (more.parentNode !== c) c.appendChild(more);
    };
    more.onclick = renderChunk;
    renderChunk();
  });
}

// ── Шишки-сюрпризы (анонимные подарки + расследование) ──
if (page === 'surprises.html') {
  const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
  async function loadSurprises() {
    const list = await api('/api/surprises');
    const c = document.getElementById('surpriseList'); c.innerHTML = '';
    if (list.error) return note(list.error);
    if (!list.length) { c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700">Пока тайных подарков нет</span></div>'; return; }
    for (const s of list) {
      const when = new Date(s.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      const el = document.createElement('div'); el.className = 'card sp';
      el.innerHTML = `<img src="assets/coins.webp">
        <div class="mid"><div class="nm">${s.revealed ? 'Это был(а): ' + s.sender : 'Кто-то подарил тебе шишки!'}</div>
          <div class="k">${when}</div></div>
        <div class="amt">+${s.amount}</div>` +
        (s.revealed ? '' : '<button class="btn btn-sm inv">Расследовать · 1</button>');
      const inv = el.querySelector('.inv');
      if (inv) inv.onclick = async () => {
        const r = await api('/api/surprise/investigate', { id: s.id });
        if (r.error) note(r.error);
        else { note(`Тайну раскрыл! Это был(а): ${r.sender}`, 1); refreshBalance(); loadSurprises(); }
      };
      c.appendChild(el);
    }
  }
  loadSurprises();
}

// ── Новости леса (события Банка и семьи) ──
if (page === 'news.html') {
  const ICON = { achievement: 'ach/icon_work.webp', rain: 'coin1.webp', payout: 'coin1.webp', guild_pay: 'coin1.webp',
    pot: 'pot.webp', guild_new: 'nav/n5.webp', auction: 'auction.webp', event: 'spirit.webp' };
  api('/api/news').then((list) => {
    const c = document.getElementById('newsList'); c.innerHTML = '';
    if (list.error || !list.length) { c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700">В лесу пока тихо</span></div>'; return; }
    for (const n of list) {
      const when = new Date(n.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      const el = document.createElement('div'); el.className = 'card ev';
      el.innerHTML = `<img src="assets/${ICON[n.kind] || 'coin1.webp'}" onerror="this.src='assets/coin1.webp'">
        <div><div class="nm">${n.kind === 'achievement' ? `${n.who} открыл награду «${n.what}»` : (n.who ? n.who + ': ' : '') + n.what}</div>
        <div class="k">${when}</div></div>` +
        (n.amount ? `<div class="amt" style="color:#5f8e37">${n.amount}</div>` : '');
      c.appendChild(el);
    }
  });
}

// ── Кабинет родителя ──
if (page === 'parent.html') {
  const urlPin = new URLSearchParams(location.search).get('pin');   // вход по ссылке ?pin=
  if (urlPin) { localStorage.setItem('parentPin', urlPin); history.replaceState({}, '', 'parent.html'); }
  if (!localStorage.getItem('parentPin')) {          // PIN-защита кабинета
    const pin = prompt('PIN ведущего:');
    if (pin) localStorage.setItem('parentPin', pin); else location.href = 'link.html';
  }
  const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
  async function loadKids() {
    const kids = await api('/api/parent/children');
    if (kids.error) { localStorage.removeItem('parentPin'); alert('Неверный PIN'); location.reload(); return; }
    const c = document.getElementById('kids'); c.innerHTML = '';
    const sel = document.getElementById('taskKid'); sel.innerHTML = '';
    for (const k of kids) {
      const el = document.createElement('div'); el.className = 'card kid-row';
      el.innerHTML = `
        <div class="kid-head">
          <div class="info"><div class="nm">${esc(k.name)}</div><div class="meta">Уровень ${k.level}</div>
            <span class="code" title="нажми, чтобы скопировать">${esc(k.code)}</span></div>
          <div class="bal">${k.balance}<small>шишек</small></div>
        </div>
        <div class="give-row">
          <input class="amt" type="number" min="1" placeholder="сколько" inputmode="numeric">
          <button class="mini g add">Начислить</button>
          <button class="mini r sub">Списать</button>
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
      c.appendChild(el);
      const o = document.createElement('option'); o.value = k.id; o.textContent = k.name; sel.appendChild(o);
    }
  }
  async function loadPending() {
    const list = await api('/api/parent/pending');
    const c = document.getElementById('pending'); c.innerHTML = '';
    if (!list.length) { c.innerHTML = '<div class="empty">Нет заданий на проверке</div>'; return; }
    for (const p of list) {
      const el = document.createElement('div'); el.className = 'card pend';
      el.innerHTML = `<div class="t">${esc(p.title)}</div>${p.photo ? `<img src="${esc(p.photo)}" style="width:100%;border-radius:12px;margin:6px 0;border:2px solid #d9c39a" loading="lazy">` : ''}<div class="row"><span class="who">${esc(p.childName)} · +${p.reward} шишек</span><button class="mini g ap">Одобрить</button><button class="mini r rj">Вернуть</button></div>`;
      el.querySelector('.ap').onclick = async () => { await api('/api/parent/approve', { id: p.id }); note('Одобрено, шишки начислены', 1); loadPending(); loadKids(); };
      el.querySelector('.rj').onclick = async () => { await api('/api/parent/reject', { id: p.id }); note('Возвращено на доработку', 1); loadPending(); };
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

  loadKids(); loadPending(); loadSeason().then(loadMetrics); loadCardLog(); loadGrant();
}

// ── Питомец на поляне: карта, выбранная ребёнком в коллекции ──
if (page === 'forest.html') {
  api('/api/state').then((s) => {
    const box = document.getElementById('fam'); const f = s && s.familiar;
    if (!box || !f) return;
    box.style.setProperty('--fc', f.color || '#ffc21f');
    box.innerHTML = `<img src="assets/cards/thumb/${f.code}_${f.grade}.webp" alt="${esc(f.name)}">
      <div class="fi"><div class="fn">${esc(f.name)}</div><div class="ft">${esc(f.title || '')}</div></div>
      <div class="fgo">→</div>`;
    box.style.display = 'flex';
    box.onclick = () => location.href = 'collection.html';
  });
}

// ══════════════ Лесная коллекция (карточки) ══════════════
if (page === 'collection.html') {
  const CAT = { zver: '🦊 Звери', rastenie: '🌿 Растения', nasekomoe: '🐞 Насекомые', special: '🎖 Особые' };
  const asset = (code, grade) => `assets/cards/${code}_${grade}.webp`;          // крупный показ
  const thumb = (code, grade) => `assets/cards/thumb/${code}_${grade}.webp`;    // сетки: в 5 раз легче
  let RAR = {}, DATA = null, LOTS = [], WANTS = [], AUCS = [], LORE = {}, FAM = null, FACTS = {}, HIST = {}, SEASONS = [], MARKET = true;
  const note = (t) => {   // всплывающая подсказка поверх экрана
    const el = document.createElement('div'); el.textContent = t;
    el.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);z-index:50;background:#fffaf0;border:2px solid #d9c39a;border-radius:12px;padding:9px 16px;font-weight:800;color:#b3452e;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:80%;text-align:center';
    document.querySelector('.phone').appendChild(el); setTimeout(() => el.remove(), 2200);
  };

  // ── свои диалоги вместо системных: детям 7-12 нативные prompt/confirm неудобны ──
  function ask(title, text, okText = 'Да', cancelText = 'Отмена') {
    return new Promise((resolve) => {
      const ov = document.getElementById('askOv'), sheet = document.getElementById('askSheet');
      sheet.innerHTML = `<h3>${title}</h3><div class="asktext">${text}</div>
        <div class="acts"><button class="a-ok">${okText}</button><button class="a-no">${cancelText}</button></div>`;
      const close = (v) => { ov.classList.remove('on'); ov.onclick = null; resolve(v); };
      sheet.querySelector('.a-ok').onclick = () => close(true);
      sheet.querySelector('.a-no').onclick = () => close(false);
      ov.onclick = (e) => { if (e.target.id === 'askOv') close(false); };
      ov.classList.add('on');
    });
  }

  // выбор цены ползунком и пресетами: без клавиатуры и без ввода чисел
  function askPrice(title, { base, lo, hi, initial, hint, okText = 'Готово' }) {
    return new Promise((resolve) => {
      const ov = document.getElementById('askOv'), sheet = document.getElementById('askSheet');
      const start = Math.min(hi, Math.max(lo, initial || base));
      sheet.innerHTML = `<h3>${title}</h3>
        ${hint ? `<div class="asktext">${hint}</div>` : ''}
        <div class="pricebig"><span id="pv">${start}</span> 🌰</div>
        <input class="pricerange" type="range" id="pr" min="${lo}" max="${hi}" value="${start}">
        <div class="presets">
          <button data-v="${Math.max(lo, Math.round(base * 0.7))}">дешевле</button>
          <button data-v="${Math.min(hi, Math.max(lo, base))}">обычная</button>
          <button data-v="${Math.min(hi, Math.round(base * 1.5))}">дороже</button>
        </div>
        <div class="asktext" id="pdeal"></div>
        <div class="acts"><button class="a-ok">${okText}</button><button class="a-no">Отмена</button></div>`;
      const range = sheet.querySelector('#pr'), val = sheet.querySelector('#pv'), deal = sheet.querySelector('#pdeal');
      const paint = () => {
        val.textContent = range.value;
        const v = +range.value;
        deal.textContent = v <= base * 0.7 ? 'дёшево — купят быстро'
          : v >= base * 1.5 ? 'дорого — можно ждать долго' : 'обычная цена';
      };
      range.oninput = paint; paint();
      sheet.querySelectorAll('.presets button').forEach((b) => b.onclick = () => { range.value = b.dataset.v; paint(); });
      const close = (v) => { ov.classList.remove('on'); ov.onclick = null; resolve(v); };
      sheet.querySelector('.a-ok').onclick = () => close(+range.value);
      sheet.querySelector('.a-no').onclick = () => close(null);
      ov.onclick = (e) => { if (e.target.id === 'askOv') close(null); };
      ov.classList.add('on');
    });
  }

  function render(d) {
    DATA = d;
    RAR = {}; d.rarities.forEach((r) => RAR[r.grade] = r);
    LORE = {}; (d.lore || []).forEach((l) => LORE[l.category + ':' + l.grade] = l);   // титул+фраза по категории и грейду
    FAM = d.familiar || null;
    FACTS = {}; (d.facts || []).forEach((f) => FACTS[f.code] = f.fact);   // только за собранных целиком
    HIST = {}; (d.history || []).forEach((h) => HIST[h.code + ':' + h.grade] = h);   // за сколько такие уходили в круге
    SEASONS = d.seasons || [];
    MARKET = d.market_allowed !== false;   // ведущий может закрыть торговлю ребёнку
    const active = SEASONS.find((s) => s.status === 'active');
    const isFull = (c) => c.grades.filter((x) => x.qty > 0).length === 6;
    // прогресс считаем по активному сезону — это достижимая цель, а не «121 существо когда-нибудь»
    const inSeason = active ? d.cards.filter((c) => c.season === active.code) : d.cards;
    const doneSeason = inSeason.filter(isFull).length;
    document.getElementById('progTxt').textContent = active
      ? `Сезон: ${doneSeason} / ${inSeason.length}`
      : `Собрано: ${d.collected} / ${d.total}`;
    document.getElementById('progBar').style.width =
      Math.round((active ? doneSeason / inSeason.length : d.collected / d.total) * 100) + '%';
    // гарант новинки — видно, сколько паков осталось
    const pityEl = document.getElementById('pityTxt');
    if (pityEl) {
      const guar = !d.pity ? '' : d.pity.to_top <= d.pity.to_new
        ? ` · через ${d.pity.to_top} ${plural(d.pity.to_top, 'пак', 'пака', 'паков')} — Эпическая+, которой нет`
        : ` · через ${d.pity.to_new} ${plural(d.pity.to_new, 'пак', 'пака', 'паков')} — новая карта точно`;
      pityEl.textContent = `Всего собрано ${d.collected} из ${d.total}${guar}`;
    }
    const av = document.getElementById('albumView'); av.innerHTML = '';
    // сезоны: активный сверху и раскрыт, остальные — свёрнуты (карты остаются в обороте)
    const order = SEASONS.length ? [...SEASONS].sort((x, y) =>
      (y.status === 'active') - (x.status === 'active') || x.sort - y.sort) : [{ code: null, name: '' }];
    for (const s of order) {
      const cards = s.code ? d.cards.filter((c) => c.season === s.code) : d.cards;
      if (!cards.length) continue;
      const done = cards.filter(isFull).length;
      if (s.code) {
        const sh = document.createElement('div');
        sh.className = 'season' + (s.status === 'active' ? ' on' : '');
        sh.innerHTML = `<span class="sn">${esc(s.name)}</span>
          ${s.status === 'active' ? '<span class="stag">сейчас в паках</span>'
            : s.status === 'upcoming' ? '<span class="stag off">скоро</span>'
            : '<span class="stag off">архив</span>'}
          <span class="cc-count">${done}/${cards.length}</span><span class="sarrow">${s.status === 'active' ? '▾' : '▸'}</span>`;
        av.appendChild(sh);
        const body = document.createElement('div');
        body.className = 'sbody';
        if (s.status !== 'active') body.style.display = 'none';
        sh.onclick = () => {
          const open = body.style.display !== 'none';
          if (!open && !body.dataset.built) { renderGroups(cards, body); body.dataset.built = '1'; }
          body.style.display = open ? 'none' : '';
          sh.querySelector('.sarrow').textContent = open ? '▸' : '▾';
        };
        av.appendChild(body);
        if (s.status === 'active') renderGroups(cards, body);   // остальные — по тапу, чтобы не держать 726 ячеек в DOM
      } else {
        renderGroups(cards, av);
      }
    }

    // ── Особые карты: их не выпадает из паков, их вручает ведущий за дело ──
    const specials = d.cards.filter((c) => c.category === 'special');
    if (specials.length) {
      const have = specials.filter((c) => c.grades.some((g) => g.qty > 0)).length;
      const h = document.createElement('div'); h.className = 'season sp';
      h.innerHTML = `<span class="sn">🎖 Особые</span><span class="stag off">за дело, не из паков</span>
        <span class="cc-count">${have}/${specials.length}</span>`;
      av.appendChild(h);
      const box = document.createElement('div'); box.className = 'sbody';
      for (const c of specials) {
        const g6 = c.grades.find((g) => g.grade === 6) || { qty: 0 };
        const owned = g6.qty > 0;
        const el = document.createElement('div'); el.className = 'being spone' + (owned ? ' full' : '');
        el.innerHTML = `<div class="spcell ${owned ? 'has' : 'locked'}">
            <img src="${thumb(c.code, 6)}" alt="" loading="lazy">
            ${g6.qty > 1 ? `<div class="gdup">×${g6.qty}</div>` : ''}</div>
          <div class="spinfo"><div class="bn">${c.name}</div>
            <div class="spwhy">${owned ? 'у тебя есть' : (c.occasion || 'особый случай')}</div></div>`;
        el.onclick = () => openDetail(c, 6);
        box.appendChild(el);
      }
      av.appendChild(box);
    }
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function renderGroups(cards, host) {
    const groups = {};
    cards.forEach((c) => (groups[c.category] ||= []).push(c));
    const av = host;
    for (const cat of ['zver', 'rastenie', 'nasekomoe']) {
      if (!groups[cat]) continue;
      const fullN = groups[cat].filter((c) => c.grades.filter((x) => x.qty > 0).length === 6).length;
      const h = document.createElement('div'); h.className = 'cat';
      h.innerHTML = `${CAT[cat]}<span class="cc-count">${fullN}/${groups[cat].length}</span>`;
      av.appendChild(h);
      // каждое существо = полка из 6 ячеек-грейдов (Panini)
      for (const c of groups[cat]) {
        const have6 = c.grades.filter((x) => x.qty > 0).length;
        const full = have6 === 6;
        const being = document.createElement('div'); being.className = 'being' + (full ? ' full' : '');
        const cells = c.grades.map((gr) => {
          const rc = (RAR[gr.grade] || {}).color || '#9aa4b2';
          const has = gr.qty > 0;
          return `<div class="gcell ${has ? 'has g' + gr.grade : 'locked'}" style="--gc:${rc}">
            <img src="${thumb(c.code, gr.grade)}" alt="" loading="lazy">
            ${has && gr.qty > 1 ? `<div class="gdup">×${gr.qty}</div>` : ''}</div>`;
        }).join('');
        // подсказка возврата: где-то осталась ровно одна карта до слияния
        const almost = c.grades.some((g) => g.qty === 2 && g.grade < 6);
        being.innerHTML = `<div class="being-head"><span class="bn">${esc(c.name)}</span>
          ${almost ? '<span class="bnear">🔥 ещё 1 до эволюции</span>' : ''}
          <span class="bp ${full ? 'done' : ''}">${have6}/6${full ? ' ✓' : ''}</span></div>
          <div class="grades6">${cells}</div>`;
        being.onclick = () => openDetail(c);
        // тап по конкретной ячейке открывает деталь сразу на этом грейде (пустая — с предложением «Хочу такую»)
        being.querySelectorAll('.gcell').forEach((cell, i) => cell.onclick = (e) => {
          e.stopPropagation(); openDetail(c, c.grades[i].grade);
        });
        av.appendChild(being);
      }
    }
  }

  function openDetail(c, startGrade) {
    const sheet = document.getElementById('sheet');
    const owned = c.grades.filter((g) => g.qty > 0);
    // активный грейд для действий: заданный тапом по ячейке, иначе лучший собранный
    let sel = startGrade || (owned.length ? owned[owned.length - 1].grade : (c.best || 1));
    const draw = () => {
      const best = c.best || 1;
      const have6 = c.grades.filter((g) => g.qty > 0).length;
      const rows = c.grades.map((gr) => {
        const r = RAR[gr.grade];
        const active = gr.grade === sel ? ' active' : '';
        return `<div class="gr ${gr.qty > 0 ? 'has' : 'no'}${active}" data-g="${gr.grade}" style="--gc:${r.color}">
          <span class="dot"></span><span class="gn">${r.name}</span>
          <span class="gq">${gr.qty > 0 ? '×' + gr.qty : '—'}</span></div>`;
      }).join('');
      const isSpecial = c.category === 'special';
      const gr = c.grades.find((g) => g.grade === sel) || { qty: 0 };
      const r = RAR[sel] || RAR[1];
      // топливо для слияния: карты того же ранга у ДРУГИХ существ (излишки дублей — отдельно)
      const fuelQty = (DATA.cards || []).filter((x) => x.id !== c.id)
        .map((x) => (x.grades.find((g) => g.grade === sel) || {}).qty || 0);
      const fuelTotal = fuelQty.reduce((s, n) => s + n, 0);
      const fuelDup = fuelQty.reduce((s, n) => s + Math.max(0, n - 1), 0);
      // что доступно по этой карте на рынке и есть ли моя заявка на неё
      const offers = LOTS.filter((l) => l.code === c.code && l.grade === sel && !l.mine)
        .sort((a, b) => a.price - b.price);
      const myWant = WANTS.find((w) => w.mine && w.code === c.code && w.grade === sel);
      let acts = '';
      if (isSpecial && gr.qty > 0) {
        acts = `<div class="sub">Памятная карта${c.occasion ? `: ${c.occasion.toLowerCase()}` : ''}. Её не продают — но можно подарить другу.</div>`
          + `<button class="a-fam">${FAM && FAM.type === c.id && FAM.grade === sel ? '⭐ Снять с поляны' : '⭐ Сделать питомцем'}</button>`
          + `<button class="a-gift">🎁 Подарить другу</button>`;
      } else if (isSpecial && gr.qty === 0) {
        acts = `<div class="sub">Такую карту не выпадет из пака — её вручает ведущий${c.occasion ? `: ${c.occasion.toLowerCase()}` : ''}.</div>`;
      } else if (gr.qty > 0) {
        if (gr.qty >= 3 && sel < 6) acts += `<button class="a-merge">⬆ Прокачать · 3 шт → ${RAR[sel + 1].name}</button>`;
        // 2 своих + 4 любых того же ранга — выход из тупика «дубли есть, тройки нет»
        else if (gr.qty === 2 && sel < 6 && fuelTotal >= 4) {
          acts += `<button class="a-fuel">🔥 Слить с топливом · обе твои + 4 любых</button>`;
        }
        // видно, сколько осталось до эволюции — иначе «нужно 3» узнаёшь только упершись
        if (gr.qty < 3 && sel < 6) {
          const left = 3 - gr.qty;
          acts += `<div class="evoprog">До эволюции в «${RAR[sel + 1].name}» ${left === 1 ? 'осталась 1 карта' : `осталось ${left} карты`}
            <div class="ebar"><i style="width:${Math.round(gr.qty / 3 * 100)}%;background:${RAR[sel + 1].color}"></i></div></div>`;
        }
        if (!isSpecial) {
          acts += `<button class="a-sell">💰 Продать Банку · ${r.quicksell} 🌰</button>`;
          if (MARKET) acts += sel >= 6 ? `<button class="a-auc">🔨 На аукцион · 24 часа</button>`
                                        : `<button class="a-list">🏷 Выставить на рынок</button>`;
        }
        const isFam = FAM && FAM.type === c.id && FAM.grade === sel;
        acts += `<button class="a-fam">${isFam ? '⭐ Снять с поляны' : '⭐ Сделать питомцем'}</button>`;
        acts += `<button class="a-gift">🎁 Подарить другу</button>`;
      } else {
        acts = `<div class="sub">Этой карты у тебя ещё нет — ${MARKET ? 'открывай паки или найди на рынке' : 'открывай паки'}.</div>`;
      }
      // «Хочу такую»: сначала готовые лоты, потом — объявить свою цену
      if (MARKET && !isSpecial) {
        if (offers.length) acts += `<button class="a-buy">🛒 Купить на рынке · ${offers[0].price} 🌰${offers.length > 1 ? ` (лотов: ${offers.length})` : ''}</button>`;
        if (myWant) acts += `<button class="a-unwant">🙋 Снять заявку (${myWant.price} 🌰)</button>`;
        else acts += `<button class="a-want">🙋 Хочу такую · оставить заявку</button>`;
      }
      sheet.style.setProperty('--rc', (RAR[sel] || RAR[best]).color);
      const lo = LORE[c.category + ':' + sel] || {};
      sheet.innerHTML = `<button class="x">&times;</button>
        <img class="big" src="${asset(c.code, gr.qty > 0 ? sel : best)}" alt="${c.name}">
        <h3>${c.name}${lo.title ? ' — ' + lo.title.toLowerCase() : ''}</h3>
        <div class="sub">${CAT[c.category].slice(2)} · ${r.name}</div>
        ${lo.lore ? `<div class="lore">${lo.lore}</div>` : ''}
        ${gr.merged > 0 ? `<div class="mtag">✨ прокачана тобой${gr.merged > 1 ? ` (${gr.merged} раза)` : ''}</div>` : ''}
        ${FACTS[c.code] ? `<div class="fact"><b>Знаешь ли ты?</b> ${FACTS[c.code]}</div>`
          : (!isSpecial && have6 < 6 ? `<div class="factlock">Собери все 6 карт — узнаешь про ${c.name.toLowerCase()} кое-что настоящее</div>` : '')}
        ${isSpecial ? '' : `<div class="grades">${rows}</div>`}
        <div class="acts">${acts}</div>
        <div class="note2" id="dnote"></div>`;
      sheet.querySelector('.x').onclick = closeDetail;
      sheet.querySelectorAll('.gr').forEach((el) => el.onclick = () => { sel = +el.dataset.g; draw(); });
      const dnote = sheet.querySelector('#dnote');
      const m = sheet.querySelector('.a-merge');
      if (m) m.onclick = async () => {
        const from = sel;
        if (gr.qty === 3 && !await ask('Прокачать?', `Все три карты «${r.name}» уйдут на эволюцию, и эта ячейка в альбоме опустеет.`, 'Прокачать')) return;
        m.disabled = true;
        const r2 = await api('/api/card/merge', { type: c.id, grade: from });
        if (r2.error) { m.disabled = false; dnote.textContent = r2.error; dnote.style.color = '#b3452e'; return; }
        closeDetail();
        await evolveRitual(c, from, r2.new_grade, r2.bonus);   // ритуал: три карты → одна грейдом выше
        showRewards(r2.rewards);
        reload();
      };
      const s = sheet.querySelector('.a-sell');
      if (s) s.onclick = async () => {
        const r2 = await api('/api/card/sell', { type: c.id, grade: sel });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { dnote.textContent = 'Продано за ' + r2.payout + ' 🌰!'; dnote.style.color = '#5f8e37'; refreshBalance(); setTimeout(reload, 700); }
      };
      const bAuc = sheet.querySelector('.a-auc');
      if (bAuc) bAuc.onclick = async () => {
        const base = RAR[sel].price, lo = Math.max(1, Math.floor(base / 2)), hi = base * 3;
        const val = await askPrice('С какой цены начать торги?',
          { base, lo, hi, hint: 'Золотая карта уходит только с молотка — торги идут сутки. Банк удержит 10%.', okText: 'Начать торги' });
        if (val === null) return;
        const r2 = await api('/api/card-auction/start', { type: c.id, grade: sel, price: val });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { dnote.textContent = '🔨 Торги начались! Смотри на вкладке «Рынок»'; dnote.style.color = '#5f8e37'; setTimeout(reload, 900); }
      };
      const bGift = sheet.querySelector('.a-gift');
      if (bGift) bGift.onclick = async () => {
        const friends = await api('/api/friends');
        if (friends.error || !friends.length) { dnote.textContent = 'в твоём лесу пока нет друзей'; dnote.style.color = '#b3452e'; return; }
        const gs = document.getElementById('giftSheet');
        gs.innerHTML = `<button class="x">&times;</button><h3>Кому подарить?</h3>
          <div class="sub">«${c.name}» · ${RAR[sel].name}. Подарок бесплатный, но не больше трёх в день.</div>
          ${friends.map((f) => `<button class="gfriend" data-id="${f.id}">${f.name}</button>`).join('')}
          <div class="note2" id="gnote"></div>`;
        gs.querySelector('.x').onclick = () => document.getElementById('giftOv').classList.remove('on');
        gs.querySelectorAll('.gfriend').forEach((btn) => btn.onclick = async () => {
          if (!await ask('Подарить карту?', `«${c.name}» (${RAR[sel].name}) уйдёт другу ${btn.textContent} насовсем.`, 'Подарить')) return;
          btn.disabled = true;
          const r = await api('/api/card/gift', { to: btn.dataset.id, type: c.id, grade: sel });
          const gn = gs.querySelector('#gnote');
          if (r.error) { btn.disabled = false; gn.textContent = r.error; gn.style.color = '#b3452e'; return; }
          document.getElementById('giftOv').classList.remove('on');
          note(`🎁 Подарено! Сегодня можно ещё ${r.left_today}`);
          reload();
        });
        document.getElementById('giftOv').classList.add('on');
      };
      const bFuel = sheet.querySelector('.a-fuel');
      if (bFuel) bFuel.onclick = async () => {
        // слияние с топливом всегда забирает ОБЕ твои карты — ячейка этого ранга опустеет
        const allow = fuelDup < 4;
        const warn = `Обе твои карты «${r.name}» уйдут в слияние — эта ячейка в альбоме опустеет, `
          + `зато появится ${RAR[sel + 1].name}.`
          + (allow ? ' К тому же дублей на топливо не хватает: сгорят и чужие карты, которых у тебя по одной.' : '');
        if (!await ask('Слить с топливом?', warn, 'Слить')) return;
        bFuel.disabled = true;
        const from = sel;
        const r2 = await api('/api/card/merge-fuel', { type: c.id, grade: from, allow_unique: allow });
        if (r2.error) { bFuel.disabled = false; dnote.textContent = r2.error; dnote.style.color = '#b3452e'; return; }
        closeDetail();
        await evolveRitual(c, from, r2.new_grade, r2.bonus);
        showRewards(r2.rewards);
        reload();
      };
      const bFam = sheet.querySelector('.a-fam');
      if (bFam) bFam.onclick = async () => {
        const isFam = FAM && FAM.type === c.id && FAM.grade === sel;
        const r2 = await api('/api/familiar', isFam ? {} : { type: c.id, grade: sel });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; return; }
        FAM = isFam ? null : { type: c.id, grade: sel };
        draw();
        const dn = sheet.querySelector('#dnote');
        dn.textContent = isFam ? 'Питомец снят с поляны' : '⭐ Теперь он живёт на твоей поляне!';
        dn.style.color = '#5f8e37';
      };
      const bBuy = sheet.querySelector('.a-buy');
      if (bBuy) bBuy.onclick = async () => { if (await buyLot(offers[0])) reload(); };
      const bWant = sheet.querySelector('.a-want');
      if (bWant) bWant.onclick = async () => {
        const base = RAR[sel].price, lo = Math.max(1, Math.floor(base / 2)), hi = base * 3;
        const val = await askPrice(`Сколько дашь за «${c.name}»?`,
          { base, lo, hi, hint: `${RAR[sel].name}. Друзья увидят заявку и смогут продать тебе эту карту.`, okText: 'Оставить заявку' });
        if (val === null) return;
        const r2 = await api('/api/want', { type: c.id, grade: sel, price: val });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { await fetchMarket(); draw(); const dn = sheet.querySelector('#dnote'); dn.textContent = '🙋 Заявка размещена — друзья увидят её на рынке'; dn.style.color = '#5f8e37'; }
      };
      const bUnwant = sheet.querySelector('.a-unwant');
      if (bUnwant) bUnwant.onclick = async () => {
        const r2 = await api('/api/want/cancel', { id: myWant.id });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { await fetchMarket(); draw(); }
      };
      const l = sheet.querySelector('.a-list');
      if (l) l.onclick = async () => {
        const base = RAR[sel].price, lo = Math.max(1, Math.floor(base / 2)), hi = base * 3;
        const h = HIST[c.code + ':' + sel];
        const hint = (h ? ` В вашем лесу такие уходили в среднем за ${h.avg} 🌰 (сделок: ${h.deals}).` : '')
          + ' Банк удержит 10% с продажи (с цены меньше 10 🌰 — ничего).';
        const val = await askPrice(`За сколько продать «${c.name}»?`,
          { base, lo, hi, initial: h ? h.avg : base, hint: `${RAR[sel].name}.${hint}`, okText: 'Выставить' });
        if (val === null) return;
        const r2 = await api('/api/card/list', { type: c.id, grade: sel, price: val });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { dnote.textContent = '🏷 Выставлено на рынок!'; dnote.style.color = '#5f8e37'; setTimeout(reload, 700); }
      };
    };
    draw();
    document.getElementById('detail').classList.add('on');
  }
  // показать альбом-награду (после merge может собраться существо)
  function showRewards(rewards) {
    (rewards || []).forEach((rw) => {
      const t = rw.kind === 'being' ? `✨ Собрано существо «${rw.name}» +${rw.reward}🌰`
              : rw.kind === 'season' ? `🌲 Сезон «${rw.name}» собран целиком! +${rw.reward}🌰`
              : rw.kind === 'category' ? `🏆 Альбом «${rw.name}» собран! +${rw.reward}🌰`
              : `👑 Вся коллекция! +${rw.reward}🌰`;
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:50%;top:80px;transform:translateX(-50%);z-index:55;background:linear-gradient(135deg,#fff3d6,#ffd062);border:3px solid #e0a52e;border-radius:14px;padding:10px 16px;font-weight:900;color:#6b4a12;font-size:14px;box-shadow:0 6px 16px rgba(0,0,0,.4);max-width:86%;text-align:center';
      el.textContent = t; document.querySelector('.phone').appendChild(el);
      setTimeout(() => el.remove(), 3200);
    });
  }
  function closeDetail() { document.getElementById('detail').classList.remove('on'); }
  document.getElementById('detail').onclick = (e) => { if (e.target.id === 'detail') closeDetail(); };

  async function reload() {
    closeDetail();
    const [d] = await Promise.all([api('/api/cards'), fetchMarket()]);
    if (!d.error) render(d);
    if (document.getElementById('tabMarket').classList.contains('on')) renderMarket();
  }

  // честные шансы выпадения (веса открыты — красная линия)
  document.getElementById('oddsBtn').onclick = () => {
    if (!DATA) return;
    const total = DATA.rarities.reduce((s, r) => s + (r.weight || 0), 0) || 100;
    const rows = DATA.rarities.map((r) => {
      const pct = ((r.weight || 0) / total * 100);
      return `<div class="gr has" style="--gc:${r.color}"><span class="dot"></span>
        <span class="gn">${r.name}</span>
        <span class="gq">${pct % 1 === 0 ? pct : pct.toFixed(1)}%</span></div>`;
    }).join('');
    const sh = document.getElementById('oddsSheet');
    const p = DATA.pity;
    const active = (DATA.seasons || []).find((s) => s.status === 'active');
    sh.innerHTML = `<button class="x">&times;</button>
      <h3>Шансы выпадения</h3>
      <div class="sub">В паке 7 карт. У каждой — свой шанс:</div>
      <div class="grades">${rows}</div>
      ${p ? `<div class="guar"><b>Без удачи тоже не останешься</b>
        Каждый 10-й пак приносит карту, которой у тебя ещё нет.
        Каждый 50-й — карту Эпическую или выше из тех, что у тебя не собраны.
        ${p.to_new === p.to_top ? `Следующий такой пак — через ${p.to_new}.`
          : `Новая карта — через ${p.to_new}, Эпическая+ — через ${p.to_top}.`}</div>` : ''}
      ${active ? `<div class="sub" style="line-height:1.4">Сейчас в паках только существа сезона «${active.name}».
        Карты других сезонов остаются в альбоме — их можно выменять или купить у друзей.</div>` : ''}
      <div class="sub" style="margin-top:8px;line-height:1.4">Мы честно показываем шансы. Шишки нельзя купить за деньги — только заработать. 🌲</div>`;
    sh.querySelector('.x').onclick = () => document.getElementById('oddsOv').classList.remove('on');
    document.getElementById('oddsOv').classList.add('on');
  };
  document.getElementById('oddsOv').onclick = (e) => { if (e.target.id === 'oddsOv') document.getElementById('oddsOv').classList.remove('on'); };

  // ── Обменная полка: 5 лишних карт одного ранга → 1 недостающая того же ранга ──
  function openExchange() {
    if (!DATA) return;
    const sheet = document.getElementById('exchSheet');
    const spare = (g) => (DATA.cards || []).reduce((s, c) => {
      const q = (c.grades.find((x) => x.grade === g) || {}).qty || 0; return s + Math.max(0, q - 1); }, 0);
    const draw = () => {
      const rows = DATA.rarities.map((r) => {
        const n = spare(r.grade);
        return `<div class="exrow" style="--gc:${r.color}"><span class="dot"></span>
          <span class="en">${r.name}</span><span class="es">лишних: ${n}</span>
          <button data-g="${r.grade}" ${n >= 5 ? '' : 'disabled'}>Обменять 5</button></div>`;
      }).join('');
      sheet.innerHTML = `<button class="x">&times;</button>
        <h3>Обменная полка</h3>
        <div class="sub">Отдай 5 лишних карт одного ранга — получишь одну того же ранга, которой у тебя ещё нет.
          Карты из альбома не пострадают: в обмен уходят только дубли.</div>
        ${rows}<div class="note2" id="exnote"></div>`;
      sheet.querySelector('.x').onclick = () => document.getElementById('exchOv').classList.remove('on');
      sheet.querySelectorAll('.exrow button').forEach((btn) => btn.onclick = async () => {
        btn.disabled = true;
        const r = await api('/api/card/exchange', { grade: +btn.dataset.g });
        const note2 = sheet.querySelector('#exnote');
        if (r.error) { note2.textContent = r.error; note2.style.color = '#b3452e'; return; }
        document.getElementById('exchOv').classList.remove('on');
        await revealCard(r.card);           // новая карта — с той же подачей, что в паке
        showRewards(r.rewards);
        await reload(); openExchange();     // полка остаётся открытой: можно менять дальше
      });
    };
    draw();
    document.getElementById('exchOv').classList.add('on');
  }
  document.getElementById('exchBtn').onclick = openExchange;
  document.getElementById('exchOv').onclick = (e) => { if (e.target.id === 'exchOv') document.getElementById('exchOv').classList.remove('on'); };
  document.getElementById('giftOv').onclick = (e) => { if (e.target.id === 'giftOv') document.getElementById('giftOv').classList.remove('on'); };

  // показать одну полученную карту: топовые — с walkout, простые — крупно на пару секунд
  function revealCard(card) {
    if (card.grade >= 5) return jackpotWalkout(card);
    return new Promise((resolve) => {
      const ov = document.getElementById('packOv'), box = document.getElementById('packCards');
      const done = document.getElementById('packDone'), h = document.getElementById('packH');
      document.getElementById('crate').style.display = 'none';
      document.getElementById('packRewards').innerHTML = '';
      box.innerHTML = ''; h.style.display = 'block'; h.textContent = '♻ Обмен удался!';
      const col = (RAR[card.grade] || {}).color || '#9aa4b2';
      const el = document.createElement('div'); el.className = 'pcard'; el.style.setProperty('--rc', col);
      el.style.width = '150px';
      el.innerHTML = `<img src="${asset(card.code, card.grade)}">`;
      box.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
      done.style.display = 'block'; done.textContent = 'Забрать';
      ov.classList.add('on');
      done.onclick = () => { ov.classList.remove('on'); done.textContent = 'Забрать'; resolve(); };
    });
  }

  // щепки + дождь шишек из точки рубки
  function burstChips(n) {
    const box = document.getElementById('chips'); box.innerHTML = '';
    const parts = ['🪵', '🌰', '🪵', '🌰', '✨', '🌰'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.textContent = parts[i % parts.length];
      const ang = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 160;
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist - 60) + 'px');   // чуть вверх
      s.style.setProperty('--dr', (Math.random() * 720 - 360) + 'deg');
      s.style.fontSize = (18 + Math.random() * 20) + 'px';
      box.appendChild(s);
      requestAnimationFrame(() => s.classList.add('fly'));
    }
    setTimeout(() => { box.innerHTML = ''; }, 1000);
  }

  // JACKPOT walkout: топ-карта (легендарка/золото) огромной в центр с лучами и тряской
  function jackpotWalkout(card) {
    return new Promise((resolve) => {
      const jp = document.getElementById('jackpot'), img = document.getElementById('jpImg');
      const label = document.getElementById('jpLabel'), cardEl = document.getElementById('jpCard');
      const parts = document.getElementById('jpParts');
      const rar = DATA.rarities.find((x) => x.grade === card.grade) || {};
      const col = rar.color || '#ffc21f';
      jp.style.setProperty('--jc', col);
      img.src = asset(card.code, card.grade);
      label.textContent = card.grade === 6 ? 'Золотая!!!' : 'Легендарная!';
      // рестарт анимаций
      cardEl.style.animation = 'none'; label.style.animation = 'none'; void cardEl.offsetWidth;
      cardEl.style.animation = ''; label.style.animation = '';
      jp.classList.add('on');
      const phone = document.querySelector('.phone');
      phone.classList.remove('shake'); void phone.offsetWidth; phone.classList.add('shake');
      // взрыв частиц
      parts.innerHTML = '';
      const emo = card.grade === 6 ? ['🌟', '🌰', '✨', '👑', '💫'] : ['⭐', '🌰', '✨', '🔥'];
      for (let i = 0; i < 26; i++) {
        const s = document.createElement('span'); s.textContent = emo[i % emo.length];
        const a = Math.random() * 6.28, d = 120 + Math.random() * 220;
        s.style.setProperty('--dx', Math.cos(a) * d + 'px');
        s.style.setProperty('--dy', Math.sin(a) * d + 'px');
        s.style.setProperty('--dr', (Math.random() * 720 - 360) + 'deg');
        s.style.fontSize = (16 + Math.random() * 22) + 'px';
        s.style.animationDelay = (Math.random() * .3) + 's';
        parts.appendChild(s);
      }
      const close = () => { jp.classList.remove('on'); jp.onclick = null; resolve(); };
      // авто-продолжение через 2.6с или по тапу (не раньше 0.8с, чтоб не проскочить)
      setTimeout(() => { jp.onclick = close; }, 800);
      setTimeout(close, 2600);
    });
  }

  // РИТУАЛ ЭВОЛЮЦИИ: три карты грейда N слетаются в центр, вспышка — рождается карта грейда N+1
  function evolveRitual(c, fromGrade, toGrade, bonus) {
    return new Promise((resolve) => {
      const ov = document.getElementById('evo');
      const rTo = RAR[toGrade] || {}, rFrom = RAR[fromGrade] || {};
      ov.style.setProperty('--ec', rTo.color || '#ffc21f');
      ov.style.setProperty('--ec0', rFrom.color || '#9aa4b2');
      ['evoS1', 'evoS2', 'evoS3'].forEach((id) => document.getElementById(id).src = thumb(c.code, fromGrade));
      document.getElementById('evoNewImg').src = asset(c.code, toGrade);
      document.getElementById('evoLabel').innerHTML = bonus
        ? `Двойная эволюция! ${c.name} перескочил ранг<b>${rTo.name || ''}!</b>`
        : `${c.name} стал сильнее<b>${rTo.name || ''}!</b>`;
      // частицы разлетаются в момент вспышки (0.85с) — эмодзи ярче на верхних грейдах
      const parts = document.getElementById('evoParts'); parts.innerHTML = '';
      const emo = toGrade >= 5 ? ['🌟', '✨', '👑', '💫'] : ['✨', '🍃', '⭐', '🌰'];
      for (let i = 0; i < 22; i++) {
        const s = document.createElement('span'); s.textContent = emo[i % emo.length];
        const a = Math.random() * 6.28, d = 90 + Math.random() * 190;
        s.style.setProperty('--dx', Math.cos(a) * d + 'px');
        s.style.setProperty('--dy', Math.sin(a) * d + 'px');
        s.style.setProperty('--dr', (Math.random() * 720 - 360) + 'deg');
        s.style.fontSize = (14 + Math.random() * 18) + 'px';
        s.style.animationDelay = (0.85 + Math.random() * 0.3) + 's';
        parts.appendChild(s);
      }
      // рестарт CSS-анимаций (ритуал может запускаться подряд)
      ov.classList.remove('on'); void ov.offsetWidth; ov.classList.add('on');
      const phone = document.querySelector('.phone');
      setTimeout(() => { phone.classList.remove('shake'); void phone.offsetWidth; phone.classList.add('shake'); }, 850);
      const close = () => { ov.classList.remove('on'); ov.onclick = null; resolve(); };
      setTimeout(() => { ov.onclick = close; }, 1600);   // тап не раньше, чем родилась карта
      setTimeout(close, 3400);
    });
  }

  // открытие пака: коробка → руби тапом → щепки/шишки → карты → награды
  document.getElementById('packBtn').onclick = async () => {
    const ov = document.getElementById('packOv'), box = document.getElementById('packCards');
    const done = document.getElementById('packDone'), h = document.getElementById('packH');
    const crate = document.getElementById('crate'), crateBox = document.getElementById('crateBox');
    const rwBox = document.getElementById('packRewards');
    box.innerHTML = ''; rwBox.innerHTML = ''; done.style.display = 'none'; h.style.display = 'none';
    crate.style.display = 'flex'; crateBox.className = 'crate-box'; crateBox.src = 'assets/chest_closed.webp';
    ov.classList.add('on');

    // запрашиваем пак заранее (пока ребёнок рубит)
    const packReq = api('/api/pack/open', {});
    let hits = 0, done_open = false;
    const reveal = async () => {
      const r = await packReq;
      if (r.error) { h.style.display = 'block'; h.textContent = r.error; setTimeout(() => ov.classList.remove('on'), 1500); return; }
      crate.style.display = 'none';
      // показываем от простых к редким; топовые (5/6) НЕ спойлерим в сетке — они придут walkout'ом
      const sorted = r.cards.slice().sort((a, b) => a.grade - b.grade);
      const addToGrid = (c) => {
        const col = (DATA.rarities.find((x) => x.grade === c.grade) || {}).color || '#9aa4b2';
        const el = document.createElement('div'); el.className = 'pcard'; el.style.setProperty('--rc', col);
        el.innerHTML = `<img src="${thumb(c.code, c.grade)}">${c.is_new ? '<div class="new">NEW</div>' : ''}`;
        box.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
      };
      const simple = sorted.filter((c) => c.grade < 5);
      const tops = sorted.filter((c) => c.grade >= 5);   // легендарка → золото, самое крутое последним
      // 1) простые карты по очереди (нарастание)
      simple.forEach((c, i) => setTimeout(() => addToGrid(c), 200 + i * 320));
      const afterSimple = 200 + simple.length * 320 + 300;
      setTimeout(async () => {
        // 2) топовые — драматичный walkout по одному, потом встают в сетку
        for (const c of tops) { await jackpotWalkout(c); addToGrid(c); }
        h.style.display = 'block';
        // альбом-награды, если пришли
        (r.rewards || []).forEach((rw) => {
          const t = rw.kind === 'being' ? `✨ Собрано существо «${rw.name}» +${rw.reward}🌰`
                  : rw.kind === 'season' ? `🌲 Сезон «${rw.name}» собран целиком! +${rw.reward}🌰`
                  : rw.kind === 'category' ? `🏆 Альбом «${rw.name}» собран! +${rw.reward}🌰`
                  : `👑 Вся коллекция! ${rw.name} +${rw.reward}🌰`;
          const el = document.createElement('div'); el.className = 'rw'; el.textContent = t; rwBox.appendChild(el);
        });
        done.style.display = 'block';
      }, afterSimple);
      const bal = document.getElementById('topBal'); if (bal) bal.textContent = r.balance;
    };
    crateBox.onclick = () => {
      if (done_open) return;
      hits++;
      crateBox.classList.remove('hit'); void crateBox.offsetWidth; crateBox.classList.add('hit');
      burstChips(6);
      if (hits >= 3) {   // 3 удара — сундук распахивается
        done_open = true;
        crateBox.src = 'assets/chest_open.webp';   // раскрытый сундук со взрывом света
        crateBox.classList.add('crack'); burstChips(20);
        setTimeout(reveal, 560);
      }
    };
    done.onclick = () => { ov.classList.remove('on'); reload(); };
  };

  // вкладки
  const tabA = document.getElementById('tabAlbum'), tabM = document.getElementById('tabMarket');
  const viewA = document.getElementById('albumView'), viewM = document.getElementById('marketView');
  tabA.onclick = () => { tabA.classList.add('on'); tabM.classList.remove('on'); viewA.style.display = ''; viewM.style.display = 'none'; };
  tabM.onclick = () => { tabM.classList.add('on'); tabA.classList.remove('on'); viewM.style.display = ''; viewA.style.display = 'none'; loadMarket(); };

  // лоты и заявки круга — в кэш, чтобы деталь карты сразу знала, где её купить
  async function fetchMarket() {
    const [lots, wants, aucs] = await Promise.all([api('/api/market'), api('/api/wants'), api('/api/card-auctions')]);
    LOTS = Array.isArray(lots) ? lots : [];
    WANTS = Array.isArray(wants) ? wants : [];
    AUCS = Array.isArray(aucs) ? aucs : [];
  }
  async function loadMarket() { await fetchMarket(); renderMarket(); }

  // покупка лота: подтверждение с «обычной ценой» → покупка → плашка отмены на 5 минут
  async function buyLot(l) {
    const deal = l.price <= l.nominal * 0.7 ? 'выгодно 👍' : l.price >= l.nominal * 1.5 ? 'дороговато' : 'обычная цена';
    const past = l.avg_price ? ` В вашем лесу такие уходили в среднем за ${l.avg_price} 🌰.` : '';
    if (!await ask(`Купить «${l.name}»?`,
      `Цена ${l.price} 🌰. Обычная цена этой карты — около ${l.nominal} 🌰 (${deal}).${past}`, 'Купить')) return false;
    const r = await api('/api/market/buy', { id: l.id });
    if (r.error) { note(r.error); return false; }
    if (r.balance != null) { const b = document.getElementById('topBal'); if (b) b.textContent = r.balance; }
    showRewards(r.rewards);
    showUndo(r.listing, l.name);
    return true;
  }

  function renderMarket() {
    const view = document.getElementById('marketView');
    view.innerHTML = '';
    if (!MARKET) {
      view.innerHTML = `<div class="empty2">Ведущий пока закрыл рынок.<br><br>
        Паки, альбом, слияния, обменная полка и подарки друзьям работают как обычно.</div>`;
      return;
    }
    const col = (g) => (DATA.rarities.find((x) => x.grade === g) || {}).color || '#9aa4b2';

    // ── аукцион золотых карт ──
    if (AUCS.length) {
      const sec0 = document.createElement('div'); sec0.className = 'msec'; sec0.textContent = '🔨 Торги';
      view.appendChild(sec0);
      for (const au of AUCS) {
        const el = document.createElement('div'); el.className = 'lot auc'; el.style.setProperty('--rc', col(au.grade));
        const left = () => {
          const ms = new Date(au.ends_at) - new Date();
          if (ms <= 0) return 'вот-вот закончится';
          const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3);
          return h > 0 ? `осталось ${h} ч ${m} мин` : `осталось ${m} мин`;
        };
        const state = au.current_bid == null ? `ставок нет · старт ${au.start_price} 🌰`
          : `${au.leading ? 'ты лидируешь' : 'лидер: ' + au.leader} · ${au.current_bid} 🌰`;
        el.innerHTML = `<img src="${thumb(au.code, au.grade)}" loading="lazy">
          <div class="li"><div class="lt">${au.name}</div><div class="ls">${au.mine ? 'твой лот' : 'от ' + au.seller} · ${state}</div>
            <div class="lh">${left()}</div></div>
          <button class="${au.mine || au.leading ? 'off' : 'buy'}" ${au.mine || au.leading ? 'disabled' : ''}>${au.mine ? 'твой' : au.leading ? 'лидер' : 'Ставка ' + au.next_bid}</button>`;
        el.querySelector('button').onclick = async () => {
          if (!await ask('Сделать ставку?', `${au.next_bid} 🌰 за «${au.name}». Шишки резервируются: если тебя перебьют, они сразу вернутся.`, 'Поставить')) return;
          const r = await api('/api/card-auction/bid', { id: au.id, amount: au.next_bid });
          if (r.error) { note(r.error); reload(); return; }
          if (r.balance != null) { const b = document.getElementById('topBal'); if (b) b.textContent = r.balance; }
          note('Ставка принята!'); reload();
        };
        view.appendChild(el);
      }
    }

    // ── лоты на продажу ──
    const sec1 = document.createElement('div'); sec1.className = 'msec'; sec1.textContent = '🏷 Продают';
    view.appendChild(sec1);
    if (!LOTS.length) {
      const e = document.createElement('div'); e.className = 'empty3';
      e.innerHTML = 'Пока никто ничего не продаёт.<br>Выставь свои дубли!';
      view.appendChild(e);
    }
    for (const l of LOTS) {
      const el = document.createElement('div'); el.className = 'lot'; el.style.setProperty('--rc', col(l.grade));
      // «обычно уходит за N» — детский урок про рыночную цену
      const past = l.avg_price ? `<div class="lh">обычно уходит за ${l.avg_price} 🌰${l.price > l.avg_price * 1.3 ? ' — сейчас дороже' : l.price < l.avg_price * 0.8 ? ' — сейчас дешевле' : ''}</div>` : '';
      el.innerHTML = `<img src="${thumb(l.code, l.grade)}" loading="lazy">
        <div class="li"><div class="lt">${l.name}</div><div class="ls">${l.mine ? 'твой лот' : 'от ' + l.seller} · ${l.price} 🌰</div>${past}</div>
        <button class="${l.mine ? 'cancel' : 'buy'}">${l.mine ? 'Снять' : 'Купить'}</button>`;
      el.querySelector('button').onclick = async () => {
        if (l.mine) {
          const r = await api('/api/market/cancel', { id: l.id });
          if (r.error) note(r.error); else reload();
          return;
        }
        if (await buyLot(l)) reload();
      };
      view.appendChild(el);
    }

    // ── заявки: кто какую карту ищет ──
    const sec2 = document.createElement('div'); sec2.className = 'msec'; sec2.textContent = '🙋 Ищут';
    view.appendChild(sec2);
    if (!WANTS.length) {
      const e = document.createElement('div'); e.className = 'empty3';
      e.innerHTML = 'Заявок пока нет.<br>Тапни пустую ячейку в альбоме и оставь свою!';
      view.appendChild(e);
    }
    for (const w of WANTS) {
      const el = document.createElement('div'); el.className = 'lot want'; el.style.setProperty('--rc', col(w.grade));
      const canFill = !w.mine && w.i_have > 0 && w.funded;
      const state = w.mine ? 'твоя заявка'
        : !w.funded ? `${w.buyer} копит шишки`
        : w.i_have > 0 ? `у тебя есть ${w.i_have} шт — можно продать`
        : `ищет ${w.buyer}`;
      el.innerHTML = `<img src="${thumb(w.code, w.grade)}" loading="lazy">
        <div class="li"><div class="lt">${w.name}</div><div class="ls">${state} · ${w.price} 🌰</div></div>
        <button class="${w.mine ? 'cancel' : canFill ? 'buy' : 'off'}" ${canFill || w.mine ? '' : 'disabled'}>${w.mine ? 'Снять' : 'Продать'}</button>`;
      el.querySelector('button').onclick = async () => {
        if (w.mine) {
          const r = await api('/api/want/cancel', { id: w.id });
          if (r.error) note(r.error); else reload();
          return;
        }
        // предупреждаем, если это последняя такая карта — не сломать свою полку в альбоме
        const last = w.i_have === 1 ? ' Это твоя последняя такая карта — ячейка в альбоме опустеет.' : '';
        if (!await ask('Продать по заявке?', `«${w.name}» уйдёт игроку ${w.buyer} за ${w.price} 🌰.${last}`, 'Продать')) return;
        const r = await api('/api/want/fill', { id: w.id });
        if (r.error) { note(r.error); reload(); return; }
        if (r.balance != null) { const b = document.getElementById('topBal'); if (b) b.textContent = r.balance; }
        note(`Продано за ${r.earned} 🌰!`);
        reload();
      };
      view.appendChild(el);
    }
  }

  // плашка отмены сделки на 5 минут после покупки
  function showUndo(listingId, name) {
    if (!listingId) return;
    const old = document.getElementById('undoBar'); if (old) old.remove();
    const bar = document.createElement('div'); bar.id = 'undoBar';
    bar.style.cssText = 'position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:50;background:#fffaf0;border:2px solid #d9c39a;border-radius:14px;padding:10px 14px;box-shadow:0 6px 16px rgba(0,0,0,.3);display:flex;align-items:center;gap:10px;max-width:88%';
    bar.innerHTML = `<span style="font-weight:800;color:#5b4636;font-size:13px">Куплено: ${esc(name)}</span>
      <button style="background:#e0864b;border:none;color:#fff;font-weight:900;border-radius:10px;padding:7px 12px;font-size:13px;cursor:pointer">Отменить <span id="undoT">5:00</span></button>`;
    document.querySelector('.phone').appendChild(bar);
    let left = 300;
    const tick = setInterval(() => {
      left--; const t = document.getElementById('undoT');
      if (t) t.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) { clearInterval(tick); bar.remove(); }
    }, 1000);
    bar.querySelector('button').onclick = async () => {
      const r = await api('/api/market/undo', { id: listingId });
      clearInterval(tick); bar.remove();
      if (r.error) note(r.error);
      else { note('Сделка отменена, шишки возвращены'); const s = await api('/api/state'); const b = document.getElementById('topBal'); if (b && s.balance != null) b.textContent = s.balance; reload(); }
    };
  }

  // ── Первый вход: три коротких экрана вместо «разбирайся сам» ──
  const INTRO = [
    { emo: '🗂', title: 'Это твой альбом',
      text: 'У каждого лесного жителя шесть обликов — от уличного сорванца до духа леса. Собери все шесть, и он появится в альбоме целиком.' },
    { emo: '🔥', title: 'Дубли — не мусор',
      text: 'Три одинаковые карты сливаются в одну рангом выше. Лишние можно обменять на обменной полке или подарить другу.' },
    { emo: '🙋', title: 'Не хватает карты?',
      text: 'Тапни пустую ячейку — увидишь, продаёт ли её кто-то в лесу, и сможешь оставить заявку. Друзья её увидят.' },
  ];
  async function showIntro() {
    if (localStorage.getItem('cardsIntro')) return;
    const ov = document.getElementById('askOv'), sheet = document.getElementById('askSheet');
    for (let i = 0; i < INTRO.length; i++) {
      const s = INTRO[i];
      await new Promise((resolve) => {
        sheet.innerHTML = `<div class="introemo">${s.emo}</div><h3>${s.title}</h3>
          <div class="asktext">${s.text}</div>
          <div class="dots">${INTRO.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
          <div class="acts"><button class="a-ok">${i === INTRO.length - 1 ? 'Понятно!' : 'Дальше'}</button></div>`;
        sheet.querySelector('.a-ok').onclick = resolve;
        ov.onclick = null;
        ov.classList.add('on');
      });
    }
    ov.classList.remove('on');
    localStorage.setItem('cardsIntro', '1');
  }

  reload().then(showIntro);
}
