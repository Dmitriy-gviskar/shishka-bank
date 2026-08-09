const CACHE = 'shishka-v27';
const PAGES = ['/', 'index.html', 'quests.html', 'shop.html', 'transfers.html', 'market.html', 'profile.html',
  'forest.html', 'games.html', 'album.html', 'news.html', 'achievements.html', 'deposit.html', 'horoscope.html', 'pot.html',
  'skins.html', 'mail.html', 'auction.html', 'insurance.html', 'council.html', 'guilds.html', 'quest.html', 'collection.html',
  'parent.html', 'surprises.html', 'link.html',
  'style.css', 'app.js', 'cards.js', 'deposit.js', 'horoscope.js', 'quest.js', 'news.js', 'guilds.js', 'nav.js',
  'assets/qrcode.js', 'assets/jsqr.js'];
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
  // не перезагружаем открытые вкладки принудительно — теряется состояние (форма перевода, фото).
  // Новый sw подхватится при следующей навигации; кэш уже обновлён.
  if (hadOld) {
    const wins = await clients.matchAll({ type: 'window' });
    for (const c of wins) c.postMessage('update');  // мягкий сигнал «обнови страницу когда удобно»
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
