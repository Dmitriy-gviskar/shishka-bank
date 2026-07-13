const CACHE = 'shishka-v4';
const PAGES = ['/', 'index.html', 'quests.html', 'shop.html', 'transfers.html', 'market.html', 'profile.html',
  'forest.html', 'album.html', 'news.html', 'achievements.html', 'deposit.html', 'horoscope.html', 'pot.html',
  'skins.html', 'mail.html', 'auction.html', 'insurance.html', 'council.html', 'guilds.html', 'quest.html',
  'style.css', 'app.js', 'nav.js', 'assets/qrcode.js', 'assets/jsqr.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PAGES)).catch(() => {}));  // все экраны в кэш сразу
  self.skipWaiting();
});
self.addEventListener('activate', (e) => { e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);  // снести старый кэш
  await clients.claim();
})()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;                          // API — всегда сеть
  // разметка/код — stale-while-revalidate: отдаём из кэша МГНОВЕННО, обновляем фоном
  if (u.pathname === '/' || /\.(html|js|css)$/.test(u.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => {
      const fresh = fetch(e.request)
        .then((res) => { caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => hit);
      return hit || fresh;
    }));
    return;
  }
  // картинки/ассеты — cache-first (быстро, они не меняются)
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request).then((hit) =>
    hit || fetch(e.request).then((res) => { c.put(e.request, res.clone()); return res; }).catch(() => hit))));
});
