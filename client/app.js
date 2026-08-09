// Связка клиента с локальным сервером: баланс, задания, магазин — живые данные.
// SPA-lite: весь роутинг экрана в runApp() — вызывается при загрузке И при навигации без перезагрузки.
// Таймеры экранов трекаются, чтобы гасить их при уходе (иначе тикают в мёртвый DOM).
if (!window.__spaInit) {
  window.__spaInit = true;
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array('BCsLnC1aJlENYUggedmMT3Gb-wns2cOD5T4gRRMUgW609m3KWFHvVrIlJbx5WzrjhWxYH3kyfPspd_VEmZSfT8o') });
        fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      } catch {}
    });
  }
  window.__timers = [];
  const _si = window.setInterval.bind(window);
  window.setInterval = (f, t) => { const id = _si(f, t); window.__timers.push(id); return id; };
}
function urlBase64ToUint8Array(s) { const pad = '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)); }

// Единый URL карты: thumb (сетки) / md (диалог, игры) / full (крупный просмотр, evo, jackpot).
window.cardUrl = function (code, grade, size) {
  const g = grade == null ? 1 : grade;
  if (size === 'thumb') return `assets/cards/thumb/${code}_${g}.webp`;
  if (size === 'md') return `assets/cards/md/${code}_${g}.webp`;
  return `assets/cards/${code}_${g}.webp`;
};
// Снять decoded bitmaps карт с DOM (SPA-уход / pagehide) — иначе Chrome копит сотни МБ.
window.releaseCardImages = function (root) {
  (root || document).querySelectorAll('img[src*="assets/cards/"]').forEach((img) => {
    try { img.removeAttribute('src'); } catch {}
  });
};
if (!window.__cardMemHook) {
  window.__cardMemHook = true;
  window.addEventListener('pagehide', () => { try { window.releaseCardImages(); } catch {} });
}

function runApp() {
function hasSession() {
  return !!(localStorage.getItem('deviceToken') || localStorage.getItem('childCode'));
}
function clearSession() {
  localStorage.removeItem('deviceToken');
  localStorage.removeItem('childCode');
}
function saveSession({ token, code }) {
  if (token) localStorage.setItem('deviceToken', token);
  if (code) localStorage.setItem('childCode', String(code).toUpperCase());
}
async function api(path, body, method) {
  const headers = {};
  const token = localStorage.getItem('deviceToken');
  const code = localStorage.getItem('childCode');
  if (token) headers['x-device-token'] = token;                    // основной вход после саморегистрации
  else if (code) headers['x-child-code'] = encodeURIComponent(code); // legacy / запасной код
  const post = body !== undefined || method === 'POST';
  const opt = post ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }
                   : { headers };
  try {
    if (!post) {
      // GET — stale-while-revalidate: экран рисуется из кэша МГНОВЕННО, свежее подтягивается фоном.
      // Любое действие (POST) чистит кэш, поэтому свои изменения видны сразу; чужие — в пределах 3 минут.
      const k = 'ac:' + (token || code || '') + ':' + path;
      const hit = JSON.parse(sessionStorage.getItem(k) || 'null');
      const age = hit ? Date.now() - hit.t : Infinity;
      const load = async () => {
        const res = await fetch(path, opt);
        const d = await res.json();
        if (!res.ok && d.error) d.error = friendlyError(res.status, d.error);
        if (d && !d.error) try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch {}
        return d;
      };
      if (age < 20e3) return hit.d;                               // только что смотрели — сеть не трогаем
      if (age < 18e4) { load().catch(() => {}); return hit.d; }   // до 3 мин: мгновенно из кэша + обновление фоном
      return load();                                              // кэша нет или протух — ждём сеть
    }
    const r = await (await fetch(path, opt)).json();  // действие — сбросить кэш, данные изменились
    if (path !== '/api/guild/chat') for (const k of Object.keys(sessionStorage)) if (k.startsWith('ac:')) sessionStorage.removeItem(k);
    return r;
  }
  catch { return { error: 'Нет связи с лесом — проверь интернет и попробуй ещё раз' }; }
}
// экранирование пользовательских строк перед вставкой в innerHTML (защита от stored XSS)
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// камера → сжатие до 1280px → base64 jpeg. Общий для фото заданий и фото лавок/товаров.
function capturePhoto() {
  return new Promise((res) => {
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
      const viaImg = () => {   // резерв: некоторые HEIC/EXIF не берёт createImageBitmap, а <img> декодирует
        const img = new Image();
        img.onload = () => draw(img, img.width, img.height);
        img.onerror = () => res(null);
        img.src = URL.createObjectURL(f);
      };
      if (window.createImageBitmap) {   // уважает EXIF-поворот — фото не ляжет боком
        createImageBitmap(f, { imageOrientation: 'from-image' })
          .then((bm) => draw(bm, bm.width, bm.height))
          .catch(viaImg);
      } else viaImg();
    };
    inp.oncancel = () => res(null);
    inp.click();
  });
}
const page = location.pathname.split('/').pop() || 'index.html';
const urlParams = new URLSearchParams(location.search);
// вход по ссылке ?code=РОСТ-01 (родитель может дать прямую ссылку)
const urlCode = urlParams.get('code');
if (urlCode) localStorage.setItem('childCode', urlCode.toUpperCase());
// реферал ?ref=XXXX — помним до посадки дерева
const urlRef = (urlParams.get('ref') || '').toUpperCase().trim();
if (urlRef) sessionStorage.setItem('refCode', urlRef);
function pendingRef() { return (sessionStorage.getItem('refCode') || '').toUpperCase().trim(); }
// не привязан → экран старта (родителю и онбордингу сессия не нужна)
if (page !== 'link.html' && page !== 'parent.html' && page !== 'onboard.html' && !hasSession())
  location.href = 'link.html';

// ── Старт: новый лес или вход по коду ──
if (page === 'link.html') {
  if (hasSession()) location.href = 'index.html';
  const plantBtn = document.getElementById('plantBtn');
  if (plantBtn) plantBtn.onclick = () => {
    const r = pendingRef();
    location.href = r ? 'onboard.html?ref=' + encodeURIComponent(r) : 'onboard.html';
  };
  if (pendingRef()) {
    const lead = document.querySelector('.lead');
    if (lead) lead.textContent = 'Тебя зовут в лес! Посади дерево — другу начислят шишки.';
    const tip = document.getElementById('webTip');
    if (tip) tip.textContent = 'Всё в браузере: жми «Посадить дерево». Приложение ставить не нужно.';
  }
  const codeToggle = document.getElementById('codeToggle');
  const codeBox = document.getElementById('codeBox');
  if (codeToggle && codeBox) {
    codeToggle.onclick = (e) => {
      e.preventDefault();
      const open = codeBox.style.display === 'block';
      codeBox.style.display = open ? 'none' : 'block';
      if (!open) document.getElementById('codeInput')?.focus();
    };
  }
  const linkBtn = document.getElementById('linkBtn');
  if (linkBtn) linkBtn.onclick = async () => {
    const code = document.getElementById('codeInput').value.trim();
    const r = await api('/api/link', { code });
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { saveSession({ code }); location.href = 'onboard.html'; }
  };
}

// ── Онбординг: новый лес (signup) или ритуал после кода ──
if (page === 'onboard.html') {
  let selTree = 'pine';
  const isNew = !hasSession();
  const pick = document.getElementById('treePick');
  const nameIn = document.getElementById('treeName');
  const note = document.getElementById('note');
  const form = document.getElementById('onboardForm');
  const done = document.getElementById('onboardDone');
  const webTip = document.getElementById('webTip');
  if (webTip && (isNew || pendingRef())) webTip.classList.add('on');
  const paintSel = () => {
    pick.querySelectorAll('.tree-opt').forEach((b) => {
      const on = b.dataset.tree === selTree;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };
  pick.querySelectorAll('.tree-opt').forEach((b) => {
    b.onclick = () => { selTree = b.dataset.tree; paintSel(); };
  });
  if (!isNew) {
    api('/api/state').then((s) => {
      if (s.error) return;
      if (s.name) nameIn.value = s.name;
      if (s.tree_type && ['pine', 'cedar', 'spruce'].includes(s.tree_type)) {
        selTree = s.tree_type; paintSel();
      }
    }).catch(() => {});
  }
  document.getElementById('startBtn').onclick = async () => {
    const name = nameIn.value.trim();
    if (name.length < 2) {
      note.style.display = 'block'; note.style.color = '#b3452e';
      note.textContent = 'Напиши имя дерева — хотя бы 2 буквы'; return;
    }
    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    const ref = pendingRef();
    const r = isNew
      ? await api('/api/signup', { name, tree: selTree, ref: ref || undefined })
      : await api('/api/onboard', { name, tree: selTree });
    btn.disabled = false;
    if (r.error) {
      note.style.display = 'block'; note.style.color = '#b3452e'; note.textContent = r.error; return;
    }
    if (isNew) {
      saveSession({ token: r.token, code: r.code });
      sessionStorage.removeItem('refCode');
      if (form) form.style.display = 'none';
      if (pick) pick.style.display = 'none';
      if (done) {
        done.style.display = 'block';
        const codeEl = document.getElementById('recoverCode');
        if (codeEl) codeEl.textContent = r.code;
        if (r.referral) {
          const tip = document.createElement('div');
          tip.style.cssText = 'margin-top:10px;font-weight:800;color:#5f8e37;font-size:13px;line-height:1.35';
          tip.textContent = `Ты пришёл от ${r.referral.referrer} — другу уже капнуло ${r.referral.reward} шишек!`;
          done.appendChild(tip);
        }
      } else location.href = 'index.html';
      return;
    }
    location.href = 'index.html';
  };
  const goHome = document.getElementById('goHomeBtn');
  if (goHome) goHome.onclick = () => { location.href = 'index.html'; };
}

// ── Кошелёк ──
if (page === 'index.html' || page === '') {
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
    if (lvl) lvl.innerHTML = `Уровень ${s.tree_level}<br>${esc(s.tree_title || 'Дубок')}`;
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
    if (!s.can_claim_daily) {   // уже забрал — тонкий чип, без второго этажа текста
      el.classList.add('got'); fire.textContent = '🔥';
      t1.textContent = s.streak > 0 ? `Серия ${s.streak} · завтра снова` : 'Заходи завтра за подарком';
      t2.textContent = '';
      return;
    }
    fire.textContent = s.streak > 0 ? '🔥' : '🎁';
    t1.textContent = 'Подарок ждёт!';
    t2.textContent = s.streak > 0 ? `Серия ${s.streak} дн.` : 'Начни серию';
    btn.onclick = async () => {
      btn.disabled = true;
      const r = await api('/api/daily', {});
      if (r.error) { btn.disabled = false; t2.textContent = r.error; return; }
      const total = (r.bonus || 0) + (r.milestone || 0) + (r.rain || 0);
      coneRain(12 + (r.milestone ? 18 : 0));
      el.classList.add('got'); fire.textContent = '🔥';
      t1.textContent = `+${total} 🌰 · серия ${r.streak}`;
      t2.textContent = '';
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
}

// ── Задания ──
function questIcon(category) {
  const map = {
    дом: 'quest_ic_home.webp', забота: 'quest_ic_care.webp', здоровье: 'quest_ic_health.webp',
    развитие: 'quest_ic_learn.webp', самостоятельность: 'quest_ic_self.webp', приключение: 'quest_ic_adventure.webp',
  };
  return 'assets/quest/' + (map[category] || 'quest_ic_home.webp');
}

async function loadTasks() {
  const tasks = await api('/api/tasks');
  const cont = document.getElementById('taskList'); cont.innerHTML = '';
  if (!Array.isArray(tasks) || !tasks.length) {
    cont.innerHTML = '<div class="quest-empty">Сегодня дел пока нет — загляни чуть позже</div>';
    return;
  }
  const daily = tasks.filter((t) => t.is_daily);
  const other = tasks.filter((t) => !t.is_daily);
  const sections = [];
  if (daily.length) sections.push(['Сегодня', daily]);
  if (other.length) sections.push(['От ведущего', other]);
  const bind = (el, t) => {
    const btn = el.querySelector('button'); if (!btn) return;
    btn.onclick = async () => {
      const say = (t2, ok) => { const n = document.getElementById('note'); if (n) { n.style.display = 'block'; n.textContent = t2; n.style.color = ok ? '#5f8e37' : '#b3452e'; } };
      let photo;
      if (t.needs_photo) {
        photo = await capturePhoto();
        if (!photo) { say('Не получилось обработать фото — попробуй ещё раз или другое фото', 0); return; }
        say('Отправляю фото…', 1);
      }
      const r = await api('/api/task/done', { id: t.id, photo });
      if (r.ok) { loadTasks(); say('Отправлено ведущему на проверку!', 1); }
      else say(r.error || 'не получилось');
    };
  };
  const statusHtml = (t) => {
    if (t.status === 'done') {
      return `<div class="quest-done"><img src="assets/quest/done.svg" alt=""><span>Выполнено</span></div>`;
    }
    if (t.status === 'submitted') {
      return `<div class="quest-wait"><b>…</b><span>На проверке</span></div>`;
    }
    if (t.needs_photo) {
      return `<button class="quest-act-img" type="button" aria-label="Отправить фото">
        <img src="assets/quest/quest_btn_photo.webp" alt="Отправить фото"></button>`;
    }
    return `<button class="quest-act-img" type="button" aria-label="Готово">
      <img src="assets/quest/quest_btn_done.webp" alt="Готово"></button>`;
  };
  for (const [label, list] of sections) {
    const h = document.createElement('div'); h.className = 'quest-sec'; h.textContent = label; cont.appendChild(h);
    for (const t of list) {
      const el = document.createElement('div'); el.className = 'quest' + (t.is_daily ? ' daily' : '');
      el.innerHTML = `<div class="ic"><img src="${questIcon(t.category)}" alt=""></div>
        <div class="mid"><div class="nm">${esc(t.title)}</div>
          <div class="rw"><img src="assets/coin1.webp" alt="">+${t.reward}</div></div>
        ${statusHtml(t)}`;
      bind(el, t);
      cont.appendChild(el);
    }
  }
}
if (page === 'quests.html') loadTasks();

// ── Магазин впечатлений ──
function shopIcon(title) {
  const t = (title || '').toLowerCase();
  if (/мультик|тв|кино|фильм/.test(t)) return 'assets/shop/shop_ic_cartoon.webp';
  if (/телефон|планшет|гаджет|экран/.test(t)) return 'assets/shop/shop_ic_phone.webp';
  if (/ужин|еда|обед|завтрак|слад/.test(t)) return 'assets/shop/shop_ic_dinner.webp';
  if (/шалаш|поход|лес|прогулк|папа|прогулка/.test(t)) return 'assets/shop/shop_ic_hut.webp';
  return 'assets/shop/shop_ic_gift.webp';
}
async function loadShop() {
  const items = await api('/api/shop');
  const cont = document.getElementById('shopList'); cont.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div'); el.className = 'lot';
    el.innerHTML = `<div class="pic"><img src="${shopIcon(it.title)}" alt="" loading="lazy"></div>
      <div class="mid"><div class="nm">${esc(it.title)}</div>
        <div class="price"><img src="assets/coin1.webp" alt="">${it.price}</div></div>
      <div class="right"><button class="shop-buy" type="button">Купить</button></div>`;
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
        `<div class="friend sel" style="flex:none;width:100%;padding:12px"><span style="font-size:15px">Платишь: ${esc(r.name)}</span></div>`;
      const cards = document.querySelector('.cards'); if (cards) cards.style.display = 'none';   // открытки — только для подарков
      const anonRow = document.getElementById('anonRow'); if (anonRow) anonRow.style.display = 'none';   // тайно — только для подарков
      const fixedAmt = parseInt(new URLSearchParams(location.search).get('amt'), 10);
      const paintPayBtn = (label) => {
        const b = document.getElementById('giftSendBtn'); if (!b) return;
        b.className = 'btn btn-lg'; b.innerHTML = ''; b.textContent = label;
        b.style.cssText = 'display:block;margin:14px auto 0;max-width:280px;width:100%';
      };
      const amtBig = document.querySelector('.amt-big'); if (amtBig) amtBig.style.display = 'none';
      if (fixedAmt > 1) {   // продавец назначил цену — это счёт, сумма зафиксирована
        qrFixedAmt = fixedAmt;
        document.querySelector('.apick').style.display = 'none';
        document.querySelector('.apick').insertAdjacentHTML('afterend',
          `<div class="on-art" style="text-align:center;font-weight:900;color:var(--ink);font-size:22px;margin:10px auto 0;display:block;width:fit-content">К оплате: ${fixedAmt} шишек</div>
           <div class="on-art" style="color:#8a7358;font-weight:700;font-size:12px;margin:6px auto 0;display:block;width:fit-content">Комиссия Банка — 1 шишка со сделки</div>`);
        paintPayBtn('Оплатить ' + fixedAmt);
        return;
      }
      document.querySelector('.apick').insertAdjacentHTML('afterend',
        `<div style="text-align:center;margin-top:8px"><input id="payAmt" type="number" min="2" placeholder="или своя сумма" inputmode="numeric"
           style="width:70%;background:#fffaf0;border:3px solid #d9c39a;border-radius:14px;padding:10px;font-size:18px;font-weight:900;color:var(--ink);text-align:center;outline:none">
         <div class="on-art" style="color:#8a7358;font-weight:700;font-size:12px;margin-top:6px">Комиссия Банка — 1 шишка со сделки</div></div>`);
      paintPayBtn('Оплатить');
    });
  } else loadFriends();
  const paintAmt = () => {
    const n = document.getElementById('giftAmtN'); if (n) n.textContent = giftAmount;
  };
  document.querySelectorAll('.apick .ap').forEach((a) => a.onclick = () => {
    document.querySelectorAll('.apick .ap').forEach((x) => x.classList.remove('sel')); a.classList.add('sel');
    giftAmount = +a.dataset.a; paintAmt();
  });
  // входящие подарки — кто и сколько подарил
  api('/api/gifts/received').then((list) => {
    const c = document.getElementById('giftsReceived');
    if (!c || list.error) return;
    if (!list.length) { c.innerHTML = '<div class="gifts-empty">Подарков пока нет</div>'; return; }
    c.innerHTML = list.map((g) => {
      const when = new Date(g.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      return `<div class="gift-row">
        <span class="who">${esc(g.sender)}</span>
        <span class="amt"><img src="assets/coin1.webp" alt="">+${g.amount}</span>
        <span class="when">${when}</span></div>`;
    }).join('');
  });
  const btn = document.getElementById('giftSendBtn') || document.querySelector('.btn-lg');
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
function marketNote(text, ok) {
  const n = document.getElementById('note'); if (!n) return;
  n.style.display = 'block'; n.textContent = text; n.style.color = ok ? '#5f8e37' : '#b3452e';
}
async function loadMarket() {
  const shops = await api('/api/shops');
  const c = document.getElementById('marketList'); c.innerHTML = '';
  for (const s of shops) {
    const el = document.createElement('div'); el.className = 'shop-card';
    el.innerHTML = `${s.is_heir ? '<span class="heir">Наследник</span>' : ''}${s.mine ? '<span class="mine-tag">Моя</span>' : ''}
      <div class="shop-head">
        <img class="av" src="${s.photo ? s.photo : 'assets/' + s.avatar}" alt="">
        <div class="sn">${esc(s.name)}</div>
        ${s.mine ? `<div class="shop-mgmt">
          <button class="mini rename" type="button" title="Переименовать">✏️</button>
          <button class="mini logo" type="button" title="Логотип">🖼</button>
          <button class="mini close" type="button" title="Закрыть лавку">🚫</button>
        </div>` : ''}
      </div>
      <div class="lots"></div>
      ${s.mine ? `<div class="lotForm">
          <input class="lTitle" placeholder="Название товара" maxlength="24">
          <div class="row"><input class="lPrice" type="number" placeholder="Цена в шишках" min="1" style="flex:1">
            <button class="btn btn-sm lPhoto" type="button">📷 Фото</button></div>
          <button class="btn btn-lg lSave" type="button" style="margin-top:2px">Сохранить</button>
        </div>
        <div class="addLotBtn"><button class="btn btn-sm addLot" type="button">+ Добавить товар</button></div>` : ''}`;

    const lots = el.querySelector('.lots');
    if (!s.lots.length) lots.innerHTML = s.mine ? '<div class="lot-empty">Пока нет товаров — добавь первый ниже</div>' : '<div class="lot-empty">Лавка пока пуста</div>';
    for (const l of s.lots) {
      const row = document.createElement('div'); row.className = 'lot-row';
      row.innerHTML = `<img class="lot-thumb" src="${l.photo ? l.photo : 'assets/coin1.webp'}" alt="">
        <div class="lt">${esc(l.title)}</div>
        <div class="price"><img src="assets/coin1.webp" alt="">${l.price}</div>
        ${s.mine ? `<button class="mini le" type="button" title="Изменить">✏️</button><button class="mini lr" type="button" title="Убрать">🗑</button>`
                 : `<button class="shop-buy" type="button">Купить</button>`}`;
      if (s.mine) {
        row.querySelector('.le').onclick = () => openLotForm(el, l);
        row.querySelector('.lr').onclick = async () => {
          if (!confirm(`Убрать «${l.title}» из продажи?`)) return;
          const r = await api('/api/lot/remove', { id: l.id });
          if (r.error) marketNote(r.error, false); else loadMarket();
        };
      } else {
        row.querySelector('button').onclick = async () => {
          const r = await api('/api/lot/buy', { id: l.id });
          if (r.error) marketNote(r.error, false);
          else { marketNote('Куплено у ' + s.name + '! Осталось ' + r.balance, true); refreshBalance(); }
        };
      }
      lots.appendChild(row);
    }

    if (s.mine) {
      el.querySelector('.rename').onclick = async () => {
        const name = prompt('Новое название лавки:', s.name); if (!name) return;
        const r = await api('/api/shop/rename', { name: name.trim() });
        if (r.error) marketNote(r.error, false); else loadMarket();
      };
      el.querySelector('.logo').onclick = async () => {
        const photo = await capturePhoto(); if (!photo) return;
        const r = await api('/api/shop/photo', { photo });
        if (r.error) marketNote(r.error, false); else loadMarket();
      };
      el.querySelector('.close').onclick = async () => {
        if (!confirm('Закрыть лавку? Все товары уйдут с витрины.')) return;
        const r = await api('/api/shop/close', {});
        if (r.error) marketNote(r.error, false); else loadMarket();
      };
      const form = el.querySelector('.lotForm');
      let photoBuf = null, editId = null;
      el.querySelector('.addLot').onclick = () => openLotForm(el, null);
      function openLotForm(card, lot) {
        editId = lot ? lot.id : null; photoBuf = null;
        card.querySelector('.lTitle').value = lot ? lot.title : '';
        card.querySelector('.lPrice').value = lot ? lot.price : '';
        card.querySelector('.lPhoto').textContent = '📷 Фото';
        card.querySelector('.lotForm').style.display = 'block';
        card.querySelector('.lTitle').focus();
      }
      form.querySelector('.lPhoto').onclick = async () => {
        const p = await capturePhoto(); if (!p) return;
        photoBuf = p; form.querySelector('.lPhoto').textContent = '📷 Фото ✓';
      };
      form.querySelector('.lSave').onclick = async () => {
        const title = form.querySelector('.lTitle').value.trim(), price = form.querySelector('.lPrice').value;
        if (!title || !(price > 0)) { marketNote('Укажи название и цену больше 0', false); return; }
        const r = editId
          ? await api('/api/lot/edit', { id: editId, title, price })
          : await api('/api/lot/add', { title, price, photo: photoBuf });
        if (r.error) { marketNote(r.error, false); return; }
        if (editId && photoBuf) await api('/api/lot/photo', { id: editId, photo: photoBuf });
        form.style.display = 'none'; loadMarket();
      };
    }
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
    if (r.error) marketNote(r.error, false);
    else { marketNote('Твоя лавка открыта!', true);
      document.getElementById('createForm').style.display = 'none'; loadMarket(); }
  };
}

// ── Профиль ──
if (page === 'profile.html') {
  const su = document.getElementById('switchUser');   // сменить пользователя → экран кода
  if (su) su.onclick = (e) => { e.preventDefault(); clearSession(); location.href = 'link.html'; };
  const nar = document.querySelector('.profile-btn'); // «Сменить наряд» → экран нарядов
  if (nar) nar.onclick = () => navigate('skins.html');
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
  // Поляна дружбы: код / ссылка / QR / список приведённых
  let refLink = '';
  api('/api/referral').then((d) => {
    if (!d || d.error) return;
    const codeEl = document.getElementById('refCode'); if (codeEl) codeEl.textContent = d.code;
    const c = document.getElementById('refCount'); if (c) c.textContent = d.count;
    const deep = document.getElementById('refCountDeep');
    if (deep) deep.textContent = (d.countL2 || 0) + (d.countL3 || 0);
    const e = document.getElementById('refEarned'); if (e) e.textContent = d.earned;
    const rw = document.getElementById('refReward'); if (rw) rw.textContent = d.reward;
    const rw2 = document.getElementById('refRewardL2'); if (rw2) rw2.textContent = d.rewardL2 || 50;
    const rw3 = document.getElementById('refRewardL3'); if (rw3) rw3.textContent = d.rewardL3 || 25;
    refLink = location.origin + '/link.html?ref=' + encodeURIComponent(d.code);
    const box = document.getElementById('refFriends');
    if (box) {
      box.innerHTML = d.friends.length
        ? d.friends.map((f) => `<div class="ref-row"><div class="nm">${esc(f.name)}</div>
            <div class="rw">+${f.reward}<img src="assets/coin1.webp" alt=""></div></div>`).join('')
        : '<div class="ref-empty">Пока никого — позови первого!</div>';
    }
    const cas = document.getElementById('refCascade');
    if (cas) {
      const list = d.cascade || [];
      cas.innerHTML = list.length
        ? list.map((f) => `<div class="ref-row"><div class="nm">${esc(f.name)}${f.via ? ` <span style="color:#a1876a;font-weight:700">через ${esc(f.via)}</span>` : ''} <span style="color:#a1876a;font-weight:700">· L${f.level}</span></div>
            <div class="rw">+${f.reward}<img src="assets/coin1.webp" alt=""></div></div>`).join('')
        : '<div class="ref-empty">Друг друга / 3-й круг — здесь +50 и +25</div>';
    }
  });
  const copyBtn = document.getElementById('refCopyBtn');
  if (copyBtn) copyBtn.onclick = async () => {
    if (!refLink) return;
    try {
      await navigator.clipboard.writeText(refLink);
      const n = document.getElementById('pnote');
      if (n) {
        n.style.display = 'block'; n.style.color = '#5f8e37';
        n.textContent = 'Ссылка скопирована! Друг откроет сайт в браузере — ставить приложение не надо.';
      }
    } catch {
      prompt('Скопируй ссылку:', refLink);
    }
  };
  const qrBtn = document.getElementById('refQrBtn');
  const qrBox = document.getElementById('refQrBox');
  if (qrBtn && qrBox) qrBtn.onclick = () => {
    if (!refLink || typeof qrcode !== 'function') return;
    const qr = qrcode(0, 'M'); qr.addData(refLink); qr.make();
    const svg = qr.createSvgTag({ cellSize: 5, margin: 2 });
    document.getElementById('refQrSvg').innerHTML = svg.replace('<svg ', '<svg style="width:200px;height:200px" ');
    qrBox.classList.add('on');
  };
  const qrClose = document.getElementById('refQrClose');
  if (qrClose && qrBox) qrClose.onclick = () => qrBox.classList.remove('on');
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

// ── Дупло-сейф (вынесен в deposit.js) ──
if (page === 'deposit.html' && window.runDeposit) window.runDeposit();

// ── Гороскоп (вынесен в horoscope.js) ──
if (page === 'horoscope.html' && window.runHoroscope) window.runHoroscope();

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
      el.innerHTML = `${p.mine ? '<button class="mini potDel" style="float:right;font-size:16px;line-height:1;padding:2px 6px" title="Удалить">×</button>' : ''}${p.guild ? `<span class="tag">${esc(p.guild)}</span>` : ''}
        <div class="pn">${esc(p.title)}</div><div class="pa">поставил: ${esc(p.author)}</div>
        <div class="scale"><i style="width:${pct}%"></i><span>${p.collected} / ${p.goal}</span></div>
        ${full ? '<div class="pa" style="color:#5f8e37;font-weight:800;margin-top:6px">Цель достигнута!</div>'
               : `<div class="give"><div class="s sel" data-a="5">5</div><div class="s" data-a="10">10</div><div class="s" data-a="20">20</div>
                  <button class="btn btn-sm">Вложить</button></div>`}`;
      let amt = 5;
      el.querySelectorAll('.give .s').forEach((t) => t.onclick = () => {
        el.querySelectorAll('.give .s').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); amt = +t.dataset.a; });
      const del = el.querySelector('.potDel');
      if (del) del.onclick = async () => {
        if (!confirm('Удалить котёл «' + p.title + '»?')) return;
        const r = await api('/api/pot/delete', { id: p.id });
        if (r.error) note(r.error); else loadPots();
      };
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

// PWA: офлайн-кэш + БЕСШОВНОЕ авто-обновление (без «открой два раза»)
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {   // новый воркер взял управление → один раз перезагружаемся на свежий код
    if (reloading) return; reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update();                                                          // сразу спросить сервер о новой версии
    reg.addEventListener('updatefound', () => {                           // нашёлся новый воркер → как встанет, попросить его взять управление немедленно
      const sw = reg.installing;
      if (sw) sw.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skip'); });
    });
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => {                    // вернулись в аппку из фона → проверить обновление
    if (!document.hidden) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  });
}

// ── Чат ──
const PHRASES = ['Привет! 👋','Как дела? 😊','Давай дружить! 🤝','Спасибо! ❤️','Классно! 🔥','Давай меняться? 🔄','Помоги 🙏','Ура! 🎉','Пока! 👋','Хорошего дня! ☀️','Ты супер! ⭐','Да! ✅','Нет 🙅','Грустно 😢','Весело! 😂'];
const STICKERS = ['🦊','🐿️','🦉','🐻','🦌','🐰','🌲','🍄','🌰','🍂','🌟','❤️','🔥','😂','👍','🎉','😢','😡','🤔','🙏'];
let chatFriend = null, chatFriendName = '', replyTo = null;
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
function openChat() {
  document.getElementById('chatList').style.display = 'none';
  document.getElementById('chatDetail').classList.add('open');
  document.getElementById('chName').textContent = chatFriendName;
  document.querySelector('.title').textContent = '↩ ' + chatFriendName;
  loadChat();
}
function closeChat() {
  document.getElementById('chatDetail').classList.remove('open');
  document.getElementById('chatList').style.display = '';
  document.querySelector('.title').textContent = 'Лесная почта';
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

if (page === 'mail.html') {
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

// ── Гильдии (вынесены в guilds.js) ──
if (page === 'guilds.html' && window.runGuilds) window.runGuilds();

// ── Нарративный квест (вынесен в quest.js) ──
if (page === 'quest.html' && window.runQuest) window.runQuest();

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

// ── Новости леса (вынесен в news.js) ──
if (page === 'news.html' && window.runNews) window.runNews();

// ── Кабинет родителя ──
if (page === 'parent.html') {
  const note = (t, ok) => { const n = document.getElementById('note'); n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e'; };
  async function loadKids() {
    const kids = await api('/api/parent/children');
    if (kids.error) { alert('Ошибка загрузки: ' + (kids.error || 'попробуйте позже')); return; }
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

// ── Питомцы на поляне: до 5 карт, каждая с фразой + диалог ──
if (page === 'forest.html') {
  api('/api/state').then((s) => {
    const cont = document.getElementById('famList');
    if (!cont) return;
    const fams = s && s.familiars;
    if (!fams || !fams.length) { cont.innerHTML = '<div style="text-align:center;color:#a1876a;font-weight:700;padding:8px">Питомцев пока нет — сделай карту питомцем в коллекции!</div>'; return; }
    cont.innerHTML = fams.map((f) => {
      return `<div class="famCard" style="--fc:${f.color || '#ffc21f'};display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:6px;background:rgba(255,250,240,.85);border:2px solid var(--fc);border-radius:14px;cursor:pointer">
        <img src="${cardUrl(f.code, f.grade, 'thumb')}" alt="${esc(f.name)}" loading="lazy" style="width:48px;height:48px;object-fit:contain;border-radius:10px;flex:none">
        <div style="flex:1;min-width:0">
          <div style="font-weight:900;color:var(--ink);font-size:14px">${esc(f.name)}</div>
          <div style="font-size:11px;color:#a1876a;font-weight:700;margin-top:1px">${esc(f.title || '')}</div>
          <div style="font-size:12px;color:var(--brown);font-style:italic;margin-top:2px">«${esc(f.phrase || 'Привет!')}»</div>
        </div>
      </div>`;
    }).join('');
    // тап по питомцу → диалог
    cont.querySelectorAll('.famCard').forEach((el, i) => {
      el.onclick = () => openFamiliarTalk(fams[i]);
    });
  });

  async function openFamiliarTalk(f) {
    const ov = document.getElementById('talkOv'), bubble = document.getElementById('talkBubble');
    const btns = document.getElementById('talkBtns');
    document.getElementById('talkImg').src = cardUrl(f.code, f.grade, 'md');
    document.getElementById('talkName').textContent = f.name;
    ov.classList.add('on');

    const say = async (trigger) => {
      bubble.textContent = '...';
      const r = await api('/api/familiar/talk', { type: f.type, grade: f.grade, trigger });
      bubble.textContent = r.phrase || '...';
    };

    const actions = [
      ['👋 Привет!', 'greet'],
      ['💚 Как дела?', 'howareyou'],
      ['🤫 Расскажи секрет', 'secret'],
    ];
    btns.innerHTML = actions.map(([label, trigger]) =>
      `<button class="btn btn-sm" style="background:#fff7e8;border:2px solid #d9c39a;color:var(--brown);font-weight:800">${label}</button>`
    ).join('');
    btns.querySelectorAll('button').forEach((btn, j) => {
      btn.onclick = () => say(actions[j][1]);
    });

    await say('greet');
  }
  const closeTalk = () => {
    const ov = document.getElementById('talkOv');
    if (ov) ov.classList.remove('on');
    const img = document.getElementById('talkImg');
    if (img) img.removeAttribute('src');
  };
  if (document.getElementById('talkClose')) document.getElementById('talkClose').onclick = closeTalk;
  if (document.getElementById('talkOv')) document.getElementById('talkOv').onclick = (e) => { if (e.target.id === 'talkOv') closeTalk(); };
}

  // ── Мини-игры (умножение / угадайка / блиц-счёт) ──
  let currentGame = null;
  let gameQuestions = [], gameIdx = 0, gameCorrect = 0;
  let guessQuestions = [], guessIdx = 0, guessCorrect = 0;
  let countQuestions = [], countIdx = 0, countScore = 0, countTimer = null, countLeft = 0;

  function setGameInputMode(mode) {
    const a = document.getElementById('gameA');
    if (!a) return;
    if (mode === 'text') {
      a.type = 'text';
      a.inputMode = 'text';
      a.style.width = '180px';
    } else {
      a.type = 'text';          // text+numeric — на iOS стабильнее, чем type=number
      a.inputMode = 'numeric';
      a.pattern = '[0-9]*';
      a.style.width = '100px';
    }
  }

  function closeGameOv() {
    clearInterval(countTimer);
    countTimer = null;
    const q = document.getElementById('gameQ');
    if (q) { q.innerHTML = ''; q.textContent = ''; }
    const ov = document.getElementById('gameOv');
    if (ov) ov.classList.remove('on');
  }

  function resetGameSheet(title) {
    clearInterval(countTimer);
    countTimer = null;
    document.getElementById('gameTitle').textContent = title;
    document.getElementById('gameQ').textContent = 'Загрузка...';
    document.getElementById('gameBtn').style.display = 'none';
    document.getElementById('gameBtn').textContent = 'Ответить';
    document.getElementById('gameA').style.display = 'none';
    document.getElementById('gameA').value = '';
    document.getElementById('gameA').placeholder = 'Ответ';
    document.getElementById('gameMsg').textContent = '';
    document.getElementById('gameDone').style.display = 'none';
    document.getElementById('gameOv').classList.add('on');
  }

  async function claimGameReward(score) {
    if (!currentGame) return closeGameOv();
    if (!score) return closeGameOv();
    const r = await api('/api/game/finish', { game: currentGame, score });
    if (r.ok && r.balance != null) {
      const b = document.getElementById('topBal');
      if (b) b.textContent = r.balance;
    }
    if (r.already) {
      document.getElementById('gameDone').style.display = 'block';
      document.getElementById('gameResult').textContent = 'Сегодня награда за эту игру уже получена';
      setTimeout(closeGameOv, 1400);
      return;
    }
    closeGameOv();
  }

  async function startMultiplyGame() {
    currentGame = 'multiply';
    resetGameSheet('Таблица умножения');
    setGameInputMode('number');
    const r = await api('/api/game/start', { level: 1 });
    if (r.error) { document.getElementById('gameMsg').textContent = r.error; document.getElementById('gameMsg').style.color = '#b3452e'; return; }
    gameQuestions = r.questions; gameIdx = 0; gameCorrect = 0;
    document.getElementById('gameTitle').textContent = `Таблица умножения · ур. ${r.level}`;
    document.getElementById('gameBtn').style.display = '';
    document.getElementById('gameA').style.display = '';
    showQuestion();
  }

  function showQuestion() {
    const q = gameQuestions[gameIdx];
    document.getElementById('gameQ').textContent = `${q.a} × ${q.b} = ?`;
    document.getElementById('gameProg').textContent = `${gameIdx} / 10`;
    document.getElementById('gameA').value = '';
    document.getElementById('gameMsg').textContent = '';
    document.getElementById('gameA').focus();
  }

  async function startGuessGame() {
    currentGame = 'guess';
    resetGameSheet('Лесная угадайка');
    setGameInputMode('text');
    const r = await api('/api/game/guess/start', {});
    if (r.error) { document.getElementById('gameMsg').textContent = r.error; document.getElementById('gameMsg').style.color = '#b3452e'; return; }
    guessQuestions = r.questions; guessIdx = 0; guessCorrect = 0;
    document.getElementById('gameProg').textContent = '0 / 5';
    document.getElementById('gameBtn').style.display = '';
    document.getElementById('gameBtn').textContent = 'Угадать';
    document.getElementById('gameA').style.display = '';
    document.getElementById('gameA').placeholder = 'Кто это?';
    showGuessQ();
  }

  function showGuessQ() {
    const q = guessQuestions[guessIdx];
    document.getElementById('gameQ').innerHTML = `<img src="${cardUrl(q.code, 1, 'md')}" style="width:140px;height:187px;object-fit:cover;border-radius:16px;border:3px solid #cbb083;filter:blur(12px) brightness(.7)">`;
    document.getElementById('gameMsg').innerHTML = q.hints.map((h) => `<div style="margin:2px 0">${h}</div>`).join('');
    document.getElementById('gameProg').textContent = `${guessIdx} / 5`;
    document.getElementById('gameA').value = '';
    document.getElementById('gameA').focus();
  }

  async function startCountGame() {
    currentGame = 'count';
    resetGameSheet('Блиц-счёт');
    setGameInputMode('number');
    const r = await api('/api/game/count/start', {});
    if (r.error) { document.getElementById('gameMsg').textContent = r.error; document.getElementById('gameMsg').style.color = '#b3452e'; return; }
    countQuestions = r.questions; countIdx = 0; countScore = 0; countLeft = r.duration;
    document.getElementById('gameProg').textContent = `⏱ ${countLeft}с · 0`;
    document.getElementById('gameBtn').style.display = '';
    document.getElementById('gameA').style.display = '';
    document.getElementById('gameQ').textContent = `${countQuestions[0].a} ${countQuestions[0].op} ${countQuestions[0].b} = ?`;
    document.getElementById('gameA').focus();
    clearInterval(countTimer);
    countTimer = setInterval(() => {
      countLeft--;
      document.getElementById('gameProg').textContent = `⏱ ${countLeft}с · ${countScore}`;
      if (countLeft <= 0) endCountGame('time');
    }, 1000);
  }

  function endCountGame(reason) {
    clearInterval(countTimer);
    countTimer = null;
    document.getElementById('gameBtn').style.display = 'none';
    document.getElementById('gameA').style.display = 'none';
    document.getElementById('gameProg').textContent = `⏱ ${Math.max(countLeft, 0)}с · ${countScore}`;
    document.getElementById('gameDone').style.display = 'block';
    const label = reason === 'wrong' ? 'Ошибка!' : reason === 'done' ? 'Готово!' : 'Время вышло!';
    document.getElementById('gameResult').textContent = `${label} Правильно: ${countScore}`;
  }

  if (document.getElementById('gameBtn')) document.getElementById('gameBtn').onclick = async () => {
    if (currentGame === 'count') {
      const val = parseInt(document.getElementById('gameA').value, 10);
      if (isNaN(val)) return;
      const q = countQuestions[countIdx];
      if (val === q.answer) {
        countScore++;
        document.getElementById('gameMsg').textContent = '✅';
        document.getElementById('gameMsg').style.color = '#5f8e37';
        countIdx++;
        if (countIdx >= countQuestions.length || countLeft <= 0) { endCountGame(countLeft <= 0 ? 'time' : 'done'); return; }
        document.getElementById('gameQ').textContent = `${countQuestions[countIdx].a} ${countQuestions[countIdx].op} ${countQuestions[countIdx].b} = ?`;
        document.getElementById('gameA').value = '';
        document.getElementById('gameA').focus();
      } else {
        document.getElementById('gameMsg').textContent = `❌ ${q.a} ${q.op} ${q.b} = ${q.answer}`;
        document.getElementById('gameMsg').style.color = '#b3452e';
        endCountGame('wrong');
      }
      return;
    }

    if (currentGame === 'guess') {
      const val = document.getElementById('gameA').value.trim();
      if (!val) return;
      const q = guessQuestions[guessIdx];
      const r = await api('/api/game/guess/answer', { answer: val, name: q.name });
      document.getElementById('gameQ').innerHTML = `<img src="${cardUrl(q.code, 1, 'md')}" style="width:160px;height:213px;object-fit:cover;border-radius:16px;border:3px solid #cbb083">`;
      if (r.correct) {
        guessCorrect++;
        document.getElementById('gameMsg').innerHTML = `<div style="color:#5f8e37;font-weight:900">✅ Верно! Это ${q.name}!</div>`;
      } else {
        document.getElementById('gameMsg').innerHTML = `<div style="color:#b3452e;font-weight:900">❌ Нет, это ${q.name}</div>`;
      }
      guessIdx++;
      if (guessIdx >= 5) {
        document.getElementById('gameBtn').style.display = 'none';
        document.getElementById('gameA').style.display = 'none';
        document.getElementById('gameProg').textContent = '5 / 5';
        document.getElementById('gameDone').style.display = 'block';
        document.getElementById('gameResult').textContent = `Угадано: ${guessCorrect} из 5`;
      } else {
        setTimeout(showGuessQ, 1200);
      }
      return;
    }

    if (currentGame === 'multiply') {
      const val = parseInt(document.getElementById('gameA').value, 10);
      if (isNaN(val)) return;
      const q = gameQuestions[gameIdx];
      const r = await api('/api/game/answer', { answer: val, expected: q.answer });
      if (r.correct) {
        gameCorrect++;
        document.getElementById('gameMsg').textContent = '✅ Верно!';
        document.getElementById('gameMsg').style.color = '#5f8e37';
      } else {
        document.getElementById('gameMsg').textContent = `❌ Нет, ${q.a} × ${q.b} = ${q.answer}`;
        document.getElementById('gameMsg').style.color = '#b3452e';
      }
      gameIdx++;
      if (gameIdx >= 10) {
        document.getElementById('gameBtn').style.display = 'none';
        document.getElementById('gameA').style.display = 'none';
        document.getElementById('gameProg').textContent = '10 / 10';
        document.getElementById('gameDone').style.display = 'block';
        document.getElementById('gameResult').textContent = `Правильно: ${gameCorrect} из 10`;
      } else {
        setTimeout(showQuestion, 800);
      }
    }
  };

  if (document.getElementById('gameA')) {
    document.getElementById('gameA').onkeydown = (e) => {
      if (e.key === 'Enter') document.getElementById('gameBtn').click();
    };
  }

  if (document.getElementById('gameClaim')) {
    document.getElementById('gameClaim').onclick = async () => {
      const score = currentGame === 'count' ? countScore
        : currentGame === 'guess' ? guessCorrect
        : gameCorrect;
      await claimGameReward(score);
    };
  }
  if (document.getElementById('gameClose')) document.getElementById('gameClose').onclick = closeGameOv;
  if (document.getElementById('gameOv')) document.getElementById('gameOv').onclick = (e) => {
    if (e.target.id === 'gameOv') closeGameOv();
  };

  window._startMultiply = startMultiplyGame;
  window._startGuess = startGuessGame;
  window._startCount = startCountGame;

  // привязка плиток на странице игр (SPA-навигация не выполняет inline-скрипты)
  if ((location.pathname.split('/').pop() || '') === 'games.html') (function bind() {
    const m = document.getElementById('gmMultiply');
    const g = document.getElementById('gmGuess');
    const c = document.getElementById('gmCount');
    if (!m || !g || !c) return setTimeout(bind, 50);
    m.onclick = (e) => { e.preventDefault(); window._startMultiply(); };
    g.onclick = (e) => { e.preventDefault(); window._startGuess(); };
    c.onclick = (e) => { e.preventDefault(); window._startCount(); };
  })();

// ══════════════ Лесная коллекция (карточки) ══════════════

  window.api = api; window.esc = esc; window.refreshBalance = refreshBalance;
  if (page === 'collection.html' && window.runCards) window.runCards();
  (function ensureNav(n) {   // nav.js может ещё не загрузиться на самой первой отрисовке — ждём его (гонка порядка скриптов)
    if (window.mountNav) window.mountNav();
    else if ((n || 0) < 60) setTimeout(() => ensureNav((n || 0) + 1), 40);
  })();
}
window.runApp = runApp;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runApp);
else runApp();
