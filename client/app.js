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
const page = location.pathname.split('/').pop() || 'index.html';
// вход по ссылке ?code=РОСТ-01 (родитель может дать прямую ссылку)
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) localStorage.setItem('childCode', urlCode.toUpperCase());
// не привязан → на экран ввода кода (родителю и онбордингу код не нужен)
if (page !== 'link.html' && page !== 'onboarding.html' && page !== 'parent.html' && !localStorage.getItem('childCode'))
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
    const b = document.querySelector('.bubble'); if (b) b.innerHTML = `С возвращением,<br>${s.name}!`;
    const lvl = document.querySelector('.level'); if (lvl) lvl.innerHTML = `Дубок<br>Уровень ${s.tree_level}`;
    const av = document.querySelector('.avatar img'); if (av && s.tree_asset) av.src = 'assets/' + s.tree_asset;  // надетый наряд
  });
  const add = document.querySelector('.add');   // «Пополнить» → зарабатывай заданиями
  if (add) add.onclick = () => location.href = 'quests.html';
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
    el.innerHTML = `<div class="nm">${it.title}</div>
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
    el.innerHTML = `<img src="assets/${f.avatar}"><span>${f.name}</span>`;
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
      bc.innerHTML = p.badges.length ? p.badges.map((b) => `<div class="badge"><img src="assets/${arts[b.code] || 'badge1.webp'}"><span>${b.title}</span></div>`).join('')
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
      el.innerHTML = `${p.guild ? `<span class="tag">${p.guild}</span>` : ''}
        <div class="pn">${p.title}</div><div class="pa">поставил: ${p.author}</div>
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

// ── Онбординг ──
if (page === 'onboarding.html') {
  let sp = 'pine';
  document.querySelectorAll('.sp').forEach((s) => s.onclick = () => {
    document.querySelectorAll('.sp').forEach((x) => x.classList.remove('sel')); s.classList.add('sel'); sp = s.dataset.tree;
  });
  document.getElementById('startBtn').onclick = async () => {
    const name = document.getElementById('treeName').value.trim() || 'Росточек';
    localStorage.setItem('childCode', 'ТАЯ-01');   // онбординг привязывает к первому профилю
    await api('/api/onboard', { name, tree: sp }); location.href = 'index.html';
  };
}

// PWA: офлайн-кэш
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ── Почта ──
async function loadInbox() {
  const list = await api('/api/inbox'); const c = document.getElementById('inbox'); c.innerHTML = '';
  for (const m of list) { const el = document.createElement('div'); el.className = 'card msg' + (m.whisper ? ' whisper' : '');
    el.innerHTML = `<div class="who">${m.from_name}</div><div class="txt">${m.content}</div>${m.whisper ? '<span class="wtag">Шёпот</span>' : `<span class="k">${m.kind}</span>`}`;
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
  const render = (a) => { document.getElementById('lotName').textContent = a.title || '—';
    curBidNow = a.current_bid || 0;
    document.getElementById('curBid').textContent = curBidNow;
    document.getElementById('lead').textContent = 'Лидер: ' + (a.leader || 'нет'); };
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
    el.innerHTML = `<div class="t">${cl.title}</div><div class="row"><span class="votes">За ${cl.yes} · Против ${cl.no} · нужно ${cl.amount}${!resolved && cl.voted ? ' · твой голос учтён' : ''}</span>${resolved ? voteOutcome(cl.status) : (cl.voted ? '' : '<button class="vbtn yes">За</button><button class="vbtn no">Против</button>')}</div>`;
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
    el.innerHTML = `<div class="t">${p.title}</div><div class="row"><span class="tally">За ${p.yes} · Против ${p.no}${!resolved && p.voted ? ' · ты проголосовал' : ''}</span>${resolved ? voteOutcome(p.status) : (p.voted ? '' : '<button class="vbtn yes">За</button><button class="vbtn no">Против</button>')}</div>`;
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
      el.innerHTML = `<div class="gn">${g.name}</div><div class="gm">${g.members.map((m) => m.name).join(', ')}</div>
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
      el.innerHTML = `<div class="who">${m.who}</div><div class="txt">${m.content}</div>`; c.appendChild(el); }
    c.scrollTop = c.scrollHeight;
  }

  function showGuild(g) {
    curGuild = g;
    document.getElementById('listView').style.display = 'none';
    document.getElementById('guildView').style.display = 'flex';
    document.getElementById('gTitle').textContent = g.name;
    const m = document.getElementById('gMembers'); m.innerHTML = '';
    for (const x of g.members) { const el = document.createElement('div'); el.className = 'card mrow';
      el.innerHTML = `<span class="nm">${x.name}</span><span class="share">доля ${x.share}</span>`; m.appendChild(el); }
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
    el.innerHTML = `${rarName[s.rarity] ? `<b>${rarName[s.rarity]}</b>` : ''}<img src="assets/${asset}" onerror="this.src='assets/tree.webp'"><div class="t">${s.title}</div>${ctrl}`;
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
        el.innerHTML = `<img src="assets/coin1.webp"><div><div class="nm">${e.title || label}</div><div class="k">${label} · ${when}</div></div>` +
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
          <div class="info"><div class="nm">${k.name}</div><div class="meta">Уровень ${k.level}</div>
            <span class="code" title="нажми, чтобы скопировать">${k.code}</span></div>
          <div class="bal">${k.balance}<small>шишек</small></div>
        </div>
        <div class="give-row">
          <input class="amt" type="number" min="1" placeholder="сколько" inputmode="numeric">
          <button class="mini g add">Начислить</button>
          <button class="mini r sub">Списать</button>
        </div>`;
      el.querySelector('.code').onclick = () => { navigator.clipboard?.writeText(k.code); note(`Код ${k.name} скопирован: ${k.code}`, 1); };
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
      el.innerHTML = `<div class="t">${p.title}</div>${p.photo ? `<img src="${p.photo}" style="width:100%;border-radius:12px;margin:6px 0;border:2px solid #d9c39a" loading="lazy">` : ''}<div class="row"><span class="who">${p.childName} · +${p.reward} шишек</span><button class="mini g ap">Одобрить</button><button class="mini r rj">Вернуть</button></div>`;
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
      el.innerHTML = `<div class="kid-head"><div class="info"><div class="nm">${g.name}</div>
          <div class="meta">${g.members.join(', ')}</div></div></div>
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
  loadKids(); loadPending();
}
