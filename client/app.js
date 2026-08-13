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
  // APK: отдать deviceToken нативному пуш-сервису
  const syncNativePush = () => {
    try {
      const t = localStorage.getItem('deviceToken') || '';
      if (t && window.ShishkaNative && window.ShishkaNative.setDeviceToken) {
        window.ShishkaNative.setDeviceToken(t);
      }
    } catch {}
  };
  syncNativePush();
  window.addEventListener('storage', syncNativePush);
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
// Снять decoded bitmaps карт с DOM (SPA-уход / фон) — иначе Chrome копит сотни МБ.
// Важно: сохраняем data-src и восстанавливаем на pageshow — иначе после Telegram/Safari
// выбитые карты остаются пустыми (у locked есть «?», у owned — нет).
window.releaseCardImages = function (root) {
  (root || document).querySelectorAll('img[src*="assets/cards/"], img[data-card-src]').forEach((img) => {
    try {
      const cur = img.getAttribute('src');
      if (cur && cur.includes('assets/cards/')) img.dataset.cardSrc = cur;
      if (cur) img.removeAttribute('src');
    } catch {}
  });
};
window.restoreCardImages = function (root) {
  (root || document).querySelectorAll('img[data-card-src]').forEach((img) => {
    try {
      if (!img.getAttribute('src') && img.dataset.cardSrc) img.src = img.dataset.cardSrc;
    } catch {}
  });
};
if (!window.__cardMemHook) {
  window.__cardMemHook = true;
  window.addEventListener('pagehide', () => { try { window.releaseCardImages(); } catch {} });
  window.addEventListener('pageshow', () => { try { window.restoreCardImages(); } catch {} });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try { window.restoreCardImages(); } catch {}
    }
  });
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
  try {
    if (token && window.ShishkaNative && window.ShishkaNative.setDeviceToken) {
      window.ShishkaNative.setDeviceToken(token);
    }
  } catch {}
}
// Telegram / Instagram in-app browser — другой localStorage, чем у Safari/Chrome
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /\bTelegram\b/i.test(ua) || /\bFBAN\b|\bFBAV\b/i.test(ua)
    || /\bInstagram\b/i.test(ua) || /\bLine\//i.test(ua) || /\bVKApp\b|\bVKAndroidApp\b/i.test(ua);
}
function recoverLink(code) {
  return location.origin + '/link.html?code=' + encodeURIComponent(String(code || '').toUpperCase());
}
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text); return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
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
    // опрос чата/реакции не должны сбрасывать весь кэш экранов — иначе лаг раз в 2с
    if (path !== '/api/guild/chat' && path !== '/api/chat' && path !== '/api/chat/list'
        && path !== '/api/message/react' && path !== '/api/message/read') {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('ac:')) sessionStorage.removeItem(k);
      window.__balAt = 0;   // следующий refreshBalance обязан сходить в сеть
    }
    return r;
  }
  catch { return { error: 'Нет связи с лесом — проверь интернет и попробуй ещё раз' }; }
}
// экранирование пользовательских строк перед вставкой в innerHTML (защита от stored XSS)
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// камера/галерея → сжатие до 1280px → base64 jpeg. Общий для фото заданий и фото лавок/товаров.
// На Android НЕ трогаем <input type=file>: в APK WebView chooser часто роняет приложение.
// Вместо этого снимаем кадр через getUserMedia прямо на странице — без новой раздачи APK.
function isAndroidApp() {
  return /Android/i.test(navigator.userAgent || '');
}
function shrinkToJpeg(img, w, h) {
  if (!(w > 0 && h > 0)) return null;
  const k = Math.min(1, 1280 / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  try { return cv.toDataURL('image/jpeg', 0.8); }
  catch { return null; }
}
function capturePhotoLive() {
  return new Promise(async (res) => {
    if (!navigator.mediaDevices?.getUserMedia) return res(null);
    let stream = null, settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { stream?.getTracks?.().forEach((t) => t.stop()); } catch {}
      try { ov.remove(); } catch {}
      res(v);
    };
    const ov = document.createElement('div');
    ov.setAttribute('role', 'dialog');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(20,28,16,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:12px';
    const video = document.createElement('video');
    video.playsInline = true; video.muted = true; video.autoplay = true;
    video.style.cssText = 'width:min(100%,420px);max-height:62vh;border-radius:18px;background:#111;object-fit:cover;border:3px solid #c9a86a';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;width:min(100%,420px)';
    const mkBtn = (label, bg) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = `flex:1;padding:14px 12px;border:3px solid #3f6b2e;border-radius:14px;font-weight:900;font-size:16px;font-family:Fredoka,Nunito,sans-serif;color:#fff;background:${bg};cursor:pointer`;
      return b;
    };
    const shoot = mkBtn('Снять фото', 'linear-gradient(180deg,#9ad65f,#6fad45)');
    const cancel = mkBtn('Отмена', 'linear-gradient(180deg,#8a6a48,#6b4f3a)');
    cancel.style.borderColor = '#5a3a18';
    row.appendChild(cancel); row.appendChild(shoot);
    const tip = document.createElement('div');
    tip.textContent = 'Наведи камеру на выполненное дело';
    tip.style.cssText = 'color:#fff8eb;font-weight:800;font-size:14px;text-align:center;font-family:Fredoka,Nunito,sans-serif';
    ov.appendChild(tip); ov.appendChild(video); ov.appendChild(row);
    document.body.appendChild(ov);
    cancel.onclick = () => finish(null);
    shoot.onclick = () => {
      try {
        const w = video.videoWidth || 0, h = video.videoHeight || 0;
        finish(shrinkToJpeg(video, w, h));
      } catch { finish(null); }
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      video.srcObject = stream;
      try { await video.play(); } catch {}
    } catch {
      finish(null);
    }
  });
}
function capturePhotoFile() {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.setAttribute('aria-hidden', 'true');
    inp.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0.01;z-index:9999';
    document.body.appendChild(inp);
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('visibilitychange', onVis);
      try { inp.remove(); } catch {}
      res(v);
    };
    const encode = (f) => {
      if (!f) return finish(null);
      const draw = (img, w, h) => finish(shrinkToJpeg(img, w, h));
      const viaImg = () => {
        const img = new Image();
        const url = URL.createObjectURL(f);
        img.onload = () => { try { URL.revokeObjectURL(url); } catch {} draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height); };
        img.onerror = () => { try { URL.revokeObjectURL(url); } catch {} finish(null); };
        img.src = url;
      };
      const viaReader = () => {
        const r = new FileReader();
        r.onload = () => {
          const img = new Image();
          img.onload = () => draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
          img.onerror = viaImg;
          img.src = r.result;
        };
        r.onerror = viaImg;
        r.readAsDataURL(f);
      };
      if (window.createImageBitmap) {
        createImageBitmap(f, { imageOrientation: 'from-image' })
          .then((bm) => { draw(bm, bm.width, bm.height); try { bm.close && bm.close(); } catch {} })
          .catch(viaReader);
      } else viaReader();
    };
    const tryFiles = () => {
      if (settled) return;
      const f = inp.files && inp.files[0];
      if (f) encode(f);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') setTimeout(tryFiles, 400);
    };
    document.addEventListener('visibilitychange', onVis);
    inp.addEventListener('change', () => encode(inp.files && inp.files[0]));
    inp.addEventListener('cancel', () => finish(null));
    setTimeout(() => { if (!settled && !(inp.files && inp.files[0])) finish(null); }, 120000);
    try { inp.click(); }
    catch { finish(null); }
  });
}
async function capturePhoto() {
  // Android (приложение и браузер): живая камера на странице — без системного file chooser
  if (isAndroidApp()) {
    const live = await capturePhotoLive();
    if (live) return live;
    return null;
  }
  return capturePhotoFile();
}
const page = location.pathname.split('/').pop() || 'index.html';
const urlParams = new URLSearchParams(location.search);
// вход по ссылке ?code=РОСТ-01 (родитель может дать прямую ссылку)
const urlCode = urlParams.get('code');
if (urlCode) localStorage.setItem('childCode', urlCode.toUpperCase());
// реферал ?ref=XXXX — в localStorage тоже: sessionStorage в Telegram иногда теряется
const urlRef = (urlParams.get('ref') || '').toUpperCase().trim();
if (urlRef) {
  try { sessionStorage.setItem('refCode', urlRef); } catch {}
  try { localStorage.setItem('refCode', urlRef); } catch {}
}
function pendingRef() {
  try {
    return (sessionStorage.getItem('refCode') || localStorage.getItem('refCode') || '').toUpperCase().trim();
  } catch { return ''; }
}
function clearPendingRef() {
  try { sessionStorage.removeItem('refCode'); } catch {}
  try { localStorage.removeItem('refCode'); } catch {}
}
// не привязан → экран старта (родителю, лендингу и онбордингу сессия не нужна)
if (page !== 'link.html' && page !== 'parent.html' && page !== 'onboard.html' && page !== 'landing.html' && !hasSession()) {
  const keep = location.search || '';
  location.href = 'link.html' + keep;
}

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
  if (isInAppBrowser()) {
    const tip = document.getElementById('webTip');
    if (tip) tip.textContent = 'Ты в браузере Telegram. После посадки сохрани код — в Safari/Chrome зайдёшь по нему, без второй регистрации.';
  }
  const codeToggle = document.getElementById('codeToggle');
  const codeBox = document.getElementById('codeBox');
  const openCodeBox = () => {
    if (!codeBox) return;
    codeBox.style.display = 'block';
    document.getElementById('codeInput')?.focus();
  };
  if (codeToggle && codeBox) {
    codeToggle.onclick = (e) => {
      e.preventDefault();
      const open = codeBox.style.display === 'block';
      codeBox.style.display = open ? 'none' : 'block';
      if (!open) document.getElementById('codeInput')?.focus();
    };
  }
  // с лендинга: link.html?open=code
  if (urlParams.get('open') === 'code') openCodeBox();
  // тот же телефон уже сажал (часто: Telegram → потом Safari) — сразу предложить код / имя
  api('/api/signup/hint').then((h) => {
    if (!h || !h.recent) return;
    const lead = document.querySelector('.lead');
    if (lead) {
      lead.textContent = h.name
        ? `С этого телефона уже сажали дерево «${h.name}». Войди по коду или имени — не сажай второе.`
        : 'С этого телефона уже сажали дерево. Войди по коду или имени — не сажай второе.';
    }
    const tip = document.getElementById('webTip');
    if (tip) tip.textContent = 'Код показывали после посадки. Не помнишь — жми «войти по имени дерева».';
    openCodeBox();
    const rn = document.getElementById('recoverName');
    if (rn && h.name) rn.value = h.name;
  }).catch(() => {});
  const recoverToggle = document.getElementById('recoverToggle');
  const recoverBox = document.getElementById('recoverBox');
  if (recoverToggle && recoverBox) {
    recoverToggle.onclick = (e) => {
      e.preventDefault();
      const open = recoverBox.style.display === 'block';
      recoverBox.style.display = open ? 'none' : 'block';
      if (!open) document.getElementById('recoverName')?.focus();
    };
  }
  const recoverBtn = document.getElementById('recoverBtn');
  if (recoverBtn) recoverBtn.onclick = async () => {
    const name = document.getElementById('recoverName')?.value.trim() || '';
    const r = await api('/api/recover', { name });
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; return; }
    saveSession({ token: r.token, code: r.code });
    n.style.color = '#5f8e37';
    n.textContent = `Нашли «${r.name}»! Код: ${r.code}`;
    location.href = 'index.html';
  };
  const linkBtn = document.getElementById('linkBtn');
  if (linkBtn) linkBtn.onclick = async () => {
    const code = document.getElementById('codeInput').value.trim();
    const r = await api('/api/link', { code });
    const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { saveSession({ token: r.token, code: r.code || code }); location.href = 'onboard.html'; }
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
    let r;
    if (isNew) {
      r = await api('/api/signup', { name, tree: selTree, ref: ref || undefined });
      if (r.need_confirm) {
        const ok = confirm(
          (r.recent_name
            ? `С этого телефона уже сажали дерево «${r.recent_name}».\n\n`
            : 'С этого телефона уже сажали дерево.\n\n')
          + 'Если это ты (например, заходил из Telegram) — нажми «Отмена» и войди по коду.\n\n'
          + 'Создать ещё один новый лес?');
        if (!ok) {
          btn.disabled = false;
          location.href = 'link.html';
          return;
        }
        r = await api('/api/signup', { name, tree: selTree, ref: ref || undefined, force: true });
      }
    } else {
      r = await api('/api/onboard', { name, tree: selTree });
    }
    btn.disabled = false;
    if (r.error) {
      note.style.display = 'block'; note.style.color = '#b3452e'; note.textContent = r.error; return;
    }
    if (isNew) {
      saveSession({ token: r.token, code: r.code });
      clearPendingRef();
      if (form) form.style.display = 'none';
      if (pick) pick.style.display = 'none';
      if (done) {
        done.style.display = 'block';
        const codeEl = document.getElementById('recoverCode');
        if (codeEl) codeEl.textContent = r.code;
        const linkEl = document.getElementById('recoverLink');
        if (linkEl) linkEl.textContent = recoverLink(r.code);
        const tgTip = document.getElementById('tgRecoverTip');
        if (tgTip && isInAppBrowser()) tgTip.style.display = 'block';
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
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  if (copyCodeBtn) copyCodeBtn.onclick = async () => {
    const code = document.getElementById('recoverCode')?.textContent?.trim();
    if (!code) return;
    const ok = await copyText(code);
    copyCodeBtn.textContent = ok ? 'Код скопирован' : 'Не удалось скопировать';
  };
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  if (copyLinkBtn) copyLinkBtn.onclick = async () => {
    const code = document.getElementById('recoverCode')?.textContent?.trim();
    if (!code) return;
    const ok = await copyText(recoverLink(code));
    copyLinkBtn.textContent = ok ? 'Ссылка скопирована — вставь в Safari' : 'Не удалось скопировать';
  };
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
  const redo = tasks.filter((t) => t.status === 'rejected');
  const daily = tasks.filter((t) => t.is_daily && t.status !== 'rejected');
  const other = tasks.filter((t) => !t.is_daily && t.status !== 'rejected');
  const sections = [];
  if (redo.length) sections.push(['Вернули — переделай', redo]);
  if (daily.length) sections.push(['Сегодня', daily]);
  if (other.length) sections.push(['От ведущего', other]);
  const bind = (el, t) => {
    const btn = el.querySelector('button'); if (!btn) return;
    btn.onclick = async () => {
      const say = (t2, ok) => { const n = document.getElementById('note'); if (n) { n.style.display = 'block'; n.textContent = t2; n.style.color = ok ? '#5f8e37' : '#b3452e'; } };
      let photo;
      if (t.needs_photo) {
        photo = await capturePhoto();
        if (!photo) { say('Не удалось сделать фото — разреши камеру и попробуй ещё раз', 0); return; }
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
    if (t.status === 'rejected') {
      return t.needs_photo
        ? `<button class="quest-act-img" type="button" aria-label="Переснять фото">
            <img src="assets/quest/quest_btn_photo.webp" alt="Переснять"></button>`
        : `<button class="quest-act-img" type="button" aria-label="Отправить снова">
            <img src="assets/quest/quest_btn_done.webp" alt="Снова"></button>`;
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
      const el = document.createElement('div');
      el.className = 'quest' + (t.is_daily ? ' daily' : '') + (t.status === 'rejected' ? ' rejected' : '');
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
  const say = (t, ok) => {
    const n = document.getElementById('note'); if (!n) return;
    n.style.display = 'block'; n.textContent = t; n.style.color = ok ? '#5f8e37' : '#b3452e';
  };
  const [items, mine, wards] = await Promise.all([
    api('/api/shop'), api('/api/shop/purchases'), api('/api/guardian/purchases')]);
  const cont = document.getElementById('shopList'); cont.innerHTML = '';
  if (Array.isArray(wards) && wards.length) {
    const box = document.createElement('div'); box.className = 'ward-box';
    box.innerHTML = '<div class="mp-h">Обещания моих детей</div>';
    for (const p of wards) {
      const row = document.createElement('div'); row.className = 'ward-row';
      row.innerHTML = `<div class="t">${esc(p.title)}</div>
        <div class="who">${esc(p.childName)} · ${p.price} шишек</div>
        <div class="acts"><button class="ok" type="button">Исполнено</button>
          <button class="no" type="button">Отменить</button></div>`;
      row.querySelector('.ok').onclick = async () => {
        const r = await api('/api/guardian/purchase/fulfill', { id: p.id });
        if (r.error) return say(r.error, false);
        say('Обещание исполнено', true); loadShop();
      };
      row.querySelector('.no').onclick = async () => {
        if (!confirm('Отменить и вернуть шишки ребёнку?')) return;
        const r = await api('/api/guardian/purchase/cancel', { id: p.id });
        if (r.error) return say(r.error, false);
        say('Отменено, шишки возвращены', true); loadShop();
      };
      box.appendChild(row);
    }
    cont.appendChild(box);
  }
  if (Array.isArray(mine) && mine.length) {
    const box = document.createElement('div'); box.className = 'my-purchases';
    box.innerHTML = '<div class="mp-h">Мои впечатления</div>' + mine.map((p) =>
      `<div class="mp-row ${p.status}"><span class="mp-t">${esc(p.title)}</span>
        <span class="mp-s">${p.status === 'promised' ? 'ждёт родителей' : 'получено'} · ${p.price} 🌰</span></div>`
    ).join('');
    cont.appendChild(box);
  }
  for (const it of items) {
    const el = document.createElement('div'); el.className = 'lot';
    el.innerHTML = `<div class="pic"><img src="${shopIcon(it.title)}" alt="" loading="lazy"></div>
      <div class="mid"><div class="nm">${esc(it.title)}</div>
        <div class="price"><img src="assets/coin1.webp" alt="">${it.price}</div></div>
      <div class="right"><button class="shop-buy" type="button">Купить</button></div>`;
    el.querySelector('button').onclick = async () => {
      if (!confirm(`Купить «${it.title}» за ${it.price} 🌰?\nРодители получат обещание исполнить.`)) return;
      const r = await api('/api/shop/buy', { id: it.id });
      if (r.error) say(r.error, false);
      else { say('Куплено! Жди, когда родители исполнят обещание.', true); loadShop(); refreshBalance(); }
    };
    cont.appendChild(el);
  }
}
if (page === 'shop.html') loadShop();




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
      <div class="t">${esc(a.title)}</div>
      <div class="d">${esc(a.desc)}${a.reward ? ` · +${a.reward}🌰` : ''}</div>
      <div class="pb"><i style="width:${pct}%"></i></div>`;
    el.title = `${a.desc} — ${a.current}/${a.threshold}` + (a.reward ? ` · награда ${a.reward}` : '');
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
  const phone = document.querySelector('.phone');
  phone.appendChild(t);
  const wrap = phone.querySelector('.wrap, .cwrap');
  if (wrap) wrap.classList.add('has-topbar');
}
async function refreshBalance(force) {
  const el = document.getElementById('topBal'); if (!el) return;
  // SPA: не дёргать /api/state на каждом экране, если шапка уже свежая (api сам кэширует GET ≤20с)
  const age = Date.now() - (window.__balAt || 0);
  if (!force && el.textContent && el.textContent !== '…' && age < 15e3) return;
  const s = await api('/api/state');
  if (s && s.balance != null) {
    el.textContent = s.balance;
    window.__balAt = Date.now();
  }
}
mountTopbar(); refreshBalance();

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
        ${full
          ? (p.mine
            ? '<button class="btn btn-sm potFul" type="button" style="margin-top:8px;width:100%">Исполнить цель</button>'
            : '<div class="pa" style="color:#5f8e37;font-weight:800;margin-top:6px">Цель достигнута — ждём исполнения!</div>')
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
      const ful = el.querySelector('.potFul');
      if (ful) ful.onclick = async () => {
        if (!confirm('Отметить «' + p.title + '» исполненным?')) return;
        const r = await api('/api/pot/fulfill', { id: p.id });
        if (r.error) note(r.error); else { note('Цель исполнена! 🎉', 1); loadPots(); }
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

// PWA: офлайн-кэш + обновление без выброса из чата/игры/съёмки фото
if ('serviceWorker' in navigator) {
  let reloading = false;
  let pendingReload = false;
  const reloadUnsafe = () => {
    // чат, игра, камера фото-задания, запись голоса
    if (document.querySelector('.phone.chat-open')) return true;
    if (document.querySelector('.phone.game-open')) return true;
    if (document.querySelector('[role="dialog"]')) return true;
    if (document.getElementById('micBtn')?.classList.contains('recording')) return true;
    if (document.hidden) return true; // не рвём, пока в фоне — дождёмся возврата
    return false;
  };
  const tryReloadSafe = () => {
    if (!pendingReload || reloading) return;
    if (reloadUnsafe()) return;
    reloading = true;
    pendingReload = false;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pendingReload = true;
    tryReloadSafe();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data === 'update') { pendingReload = true; tryReloadSafe(); }
  });
  setInterval(tryReloadSafe, 4000);
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (sw) sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skip');
      });
    });
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    tryReloadSafe(); // вернулись из фона — если ждали обновление, можно применить
  });
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
  document.getElementById('claimBtn').onclick = async () => {
    const n = document.getElementById('note'); n.style.display = 'block';
    const r = await api('/api/claim', {
      amount: document.getElementById('claimAmt').value,
      reason: document.getElementById('claimReason').value,
    });
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; return; }
    n.textContent = 'Заявка ушла на голосование семьи!'; n.style.color = '#5f8e37';
    document.getElementById('claimReason').value = '';
    api('/api/insurance').then(renderIns);
  };
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
if (page === 'council.html') {
  const paintProps = (list) => {
    renderProps(Array.isArray(list) ? list : []);
    if (!Array.isArray(list) || !list.length) {
      const c = document.getElementById('props');
      if (c && !c.children.length) {
        c.innerHTML = '<div class="card prop"><div class="t" style="text-align:center;color:#8a7358;font-size:14px">Пока тишина — предложи тему выше</div></div>';
      }
    }
  };
  api('/api/proposals').then(paintProps);
  document.getElementById('propBtn').onclick = async () => {
    const n = document.getElementById('note'); n.style.display = 'block';
    const r = await api('/api/proposals', { title: document.getElementById('propTitle').value });
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; return; }
    n.textContent = 'Тема предложена — голосуйте!'; n.style.color = '#5f8e37';
    document.getElementById('propTitle').value = '';
    api('/api/proposals').then(paintProps);
  };
}

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
  const KIND_RU = {
    earn: ['Заработано', '+'],
    gift_in: ['Подарок', '+'], gift_out: ['Подарок', '−'],
    trade_in: ['Продажа', '+'], trade_out: ['Покупка', '−'],
    pay_in: ['Оплата тебе', '+'], pay_out: ['Оплата', '−'],
    buy: ['Покупка', '−'], spend: ['Комиссия', '−'],
    interest: ['Проценты Дупла', '+'], deposit: ['Дупло-сейф', '−'],
    insurance: ['Страховка', '−'], pot: ['Вклад в котёл', '−'],
    payout: ['От Банка', '+'], achievement: ['Достижение', '+'], photo: ['Фотоотчёт', ''],
  };
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



// ══════════════ Лесная коллекция (карточки) ══════════════

  window.api = api; window.esc = esc; window.refreshBalance = refreshBalance;
  window.capturePhoto = capturePhoto; window.clearSession = clearSession;
  // per-page модули — только после window.api (иначе холодный заход падает)
  if (page === 'deposit.html' && window.runDeposit) window.runDeposit();
  if (page === 'horoscope.html' && window.runHoroscope) window.runHoroscope();
  if (page === 'games.html' && window.runGames) window.runGames();
  if (page === 'collection.html' && window.runCards) window.runCards();
  if (page === 'guilds.html' && window.runGuilds) window.runGuilds();
  if (page === 'quest.html' && window.runQuest) window.runQuest();
  if (page === 'news.html' && window.runNews) window.runNews();
  if ((page === 'index.html' || page === '') && window.runWallet) window.runWallet();
  if (page === 'transfers.html' && window.runTransfers) window.runTransfers();
  if (page === 'market.html' && window.runMarket) window.runMarket();
  if (page === 'profile.html' && window.runProfile) window.runProfile();
  if (page === 'mail.html' && window.runMail) window.runMail();
  if (page === 'parent.html' && window.runParent) window.runParent();
  (function ensureNav(n) {   // nav.js может ещё не загрузиться на самой первой отрисовке — ждём его (гонка порядка скриптов)
    if (window.mountNav) window.mountNav();
    else if ((n || 0) < 60) setTimeout(() => ensureNav((n || 0) + 1), 40);
  })();
}
window.runApp = runApp;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runApp);
else runApp();
