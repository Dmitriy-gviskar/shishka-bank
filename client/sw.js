const CACHE = 'shishka-v16';
const PAGES = ['/', 'index.html', 'quests.html', 'shop.html', 'transfers.html', 'market.html', 'profile.html',
  'forest.html', 'album.html', 'news.html', 'achievements.html', 'deposit.html', 'horoscope.html', 'pot.html',
  'skins.html', 'mail.html', 'auction.html', 'insurance.html', 'council.html', 'guilds.html', 'quest.html', 'collection.html',
  'style.css', 'app.js', 'cards.js', 'nav.js', 'assets/qrcode.js', 'assets/jsqr.js'];
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });  // клиент просит новый воркер встать немедленно
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PAGES)).catch(() => {}));  // все экраны в кэш сразу
  self.skipWaiting();
});
self.addEventListener('activate', (e) => { e.waitUntil((async () => {
  const keys = await caches.keys();
  const hadOld = keys.some((k) => k !== CACHE);                                   // была прошлая версия = это ОБНОВЛЕНИЕ
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))); // снести старый кэш
  await clients.claim();
  if (hadOld) {                                                                   // сами перезагружаем открытые вкладки на свежий код — без «открой два раза»
    const wins = await clients.matchAll({ type: 'window' });
    await Promise.all(wins.map((c) => c.navigate(c.url).catch(() => {})));
  }
})()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;                          // API — всегда сеть
  // разметка/код — NETWORK-FIRST: свежий деплой всегда побеждает, офлайн — из кэша (precache)
  if (u.pathname === '/' || /\.(html|js|css)$/.test(u.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // картинки/ассеты — cache-first (быстро, они не меняются)
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request).then((hit) =>
    hit || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit))));
});
