const CACHE = 'shishka-v110';
const CARDS_CACHE = 'shishka-cards-v2';
const CARDS_MAX = 500;       // альбом тянет сотни thumb — 120 было мало, промахи ломали картинки
const CARDS_FULL_MAX = 40;   // full-res отдельно жёстче
const PAGES = ['/', 'landing.html', 'index.html', 'quests.html', 'shop.html', 'transfers.html', 'market.html', 'profile.html',
  'forest.html', 'games.html', 'album.html', 'news.html', 'achievements.html', 'deposit.html', 'horoscope.html', 'pot.html',
  'skins.html', 'mail.html', 'auction.html', 'insurance.html', 'council.html', 'guilds.html', 'quest.html', 'collection.html',
  'parent.html', 'surprises.html', 'link.html', 'onboard.html',
  'style.css', 'app.js', 'games.js', 'wallet.js', 'transfers.js', 'market.js', 'profile.js', 'mail.js', 'parent.js', 'cards.js', 'deposit.js', 'horoscope.js', 'quest.js', 'news.js', 'guilds.js', 'nav.js',
  'assets/qrcode.js', 'assets/jsqr.js',
  'assets/home_btn_earn.webp', 'assets/shop_btn_buy.webp', 'assets/gift_btn_send.webp',
  'assets/shop/shop_ic_cartoon.webp', 'assets/shop/shop_ic_phone.webp', 'assets/shop/shop_ic_dinner.webp',
  'assets/shop/shop_ic_hut.webp', 'assets/shop/shop_ic_gift.webp',
  'assets/quest/cam.svg', 'assets/quest/done.svg',
  'assets/quest/quest_btn_done.webp', 'assets/quest/quest_btn_photo.webp',
  'assets/quest/quest_ic_home.webp', 'assets/quest/quest_ic_care.webp', 'assets/quest/quest_ic_health.webp',
  'assets/quest/quest_ic_learn.webp', 'assets/quest/quest_ic_self.webp', 'assets/quest/quest_ic_adventure.webp'];

function isCardUrl(pathname) {
  return pathname.startsWith('/assets/cards/');
}
function isFullCard(pathname) {
  // /assets/cards/code_1.webp — не thumb/ и не md/
  return /^\/assets\/cards\/[^/]+\.webp$/.test(pathname);
}

async function trimCardsCache(cache) {
  let keys = await cache.keys();
  const fulls = keys.filter((r) => isFullCard(new URL(r.url).pathname));
  while (fulls.length > CARDS_FULL_MAX) {
    await cache.delete(fulls.shift());
  }
  keys = await cache.keys();
  while (keys.length > CARDS_MAX) {
    await cache.delete(keys.shift());
    keys = await cache.keys();
  }
}

async function cardsFetch(request) {
  const cache = await caches.open(CARDS_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    // LRU: повторный put двигает запись «в конец» порядка keys()
    cache.put(request, hit.clone()).catch(() => {});
    return hit;
  }
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone()).then(() => trimCardsCache(cache)).catch(() => {});
    }
    return res;
  } catch {
    // сеть упала — только реальный cache hit; undefined ломает <img>
    const again = await cache.match(request);
    if (again) return again;
    return new Response('', { status: 504, statusText: 'card offline' });
  }
}

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PAGES)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => { e.waitUntil((async () => {
  const keys = await caches.keys();
  const keep = new Set([CACHE, CARDS_CACHE]);
  const hadOld = keys.some((k) => !keep.has(k));
  await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
  await clients.claim();
  if (hadOld) {
    const wins = await clients.matchAll({ type: 'window' });
    for (const c of wins) c.postMessage('update');
  }
})()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;
  if (isCardUrl(u.pathname)) {
    e.respondWith(cardsFetch(e.request));
    return;
  }
  // разметка/код — NETWORK-FIRST
  if (u.pathname === '/' || /\.(html|js|css)$/.test(u.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // прочие ассеты — cache-first в shell-кэше (не карты)
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request).then((hit) =>
    hit || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit))));
});
// Push-уведомления
self.addEventListener('push', (e) => {
  if (!e.data) return;
  try {
    const { title, body } = e.data.json();
    e.waitUntil(self.registration.showNotification(title, {
      body,
      icon: '/assets/app-icon-192.png',
      badge: '/assets/coin1.webp',
      vibrate: [200, 100, 200],
      tag: 'shishka-msg'
    }));
  } catch {}
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then((wins) => {
    if (wins.length) { wins[0].focus(); wins[0].navigate('mail.html'); }
    else clients.openWindow('/mail.html');
  }));
});
