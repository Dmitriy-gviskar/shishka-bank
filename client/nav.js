// Единый нижний навбар + SPA-lite навигация без перезагрузки страницы.
// Экран без навбара помечается <body data-no-nav>.
(function () {
  // 5 слотов: дом / круг / сток / дела / лес. Лавки живут в «Ещё в лесу», не в таббаре.
  const ITEMS = [
    { i: 'n1', href: 'index.html' },     // Дом (кошелёк)
    { i: 'n2', href: 'transfers.html' }, // Подарки
    { i: 'n3', href: 'shop.html' },      // Магазин впечатлений
    { i: 'n4', href: 'quests.html' },    // Дела
    { i: 'n6', href: 'forest.html' },    // Лес
  ];

  window.mountNav = function () {
    if (document.body.dataset.noNav !== undefined) return;
    const wrap = document.querySelector('.wrap, .cwrap'); if (!wrap) return;  // collection использует .cwrap
    if (wrap.querySelector('nav.nav')) return;                 // уже отрисован на этом экране
    const file = location.pathname.split('/').pop() || 'index.html';
    const nav = document.createElement('nav'); nav.className = 'nav';
    for (const it of ITEMS) {
      const b = document.createElement('button');
      if (it.href === file) b.className = 'active';
      b.innerHTML = `<img src="assets/nav/${it.i}.png" alt="">`;
      b.addEventListener('click', () => { if (it.href !== file) navigate(it.href); });
      nav.appendChild(b);
    }
    wrap.appendChild(nav);
    // подэкраны (не из навбара) получают кнопку «Назад»
    if (!ITEMS.some((it) => it.href === file)) {
      const back = document.createElement('button');
      back.setAttribute('aria-label', 'Назад');
      back.style.cssText = 'position:absolute;top:14px;left:12px;z-index:5;background:rgba(255,250,240,.94);' +
        'border:3px solid #d9c39a;border-radius:14px;padding:6px 13px;font-size:19px;font-weight:900;color:#6b4f3a;cursor:pointer';
      back.textContent = '←';
      back.onclick = () => { if (history.length > 1) history.back(); else navigate('forest.html'); };
      wrap.appendChild(back);
    }
  };

  // догрузка per-page скриптов нового экрана (cards.js, qrcode.js, jsqr.js…). Каждый один раз.
  // app.js/nav.js есть на КАЖДОМ экране; cards.js и vendored — только на своих, грузим по требованию.
  const loaded = new Set(['app.js', 'nav.js']);
  function ensureScript(src) {
    return new Promise((res) => {
      if (loaded.has(src) || document.querySelector(`script[src="${src}"]`)) { loaded.add(src); return res(); }
      const sc = document.createElement('script'); sc.src = src; sc.dataset.spaSrc = src;
      sc.onload = () => { loaded.add(src); res(); }; sc.onerror = () => res();
      document.head.appendChild(sc);
    });
  }

  async function navigate(href, push = true) {
    href = href.split('#')[0];
    if (!href) return;
    try {
      const res = await fetch(href);
      if (!res.ok) throw 0;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const newPhone = doc.querySelector('.phone');
      if (!newPhone) throw 0;                                  // не наш шаблон — обычная навигация
      // 1) гасим таймеры прошлого экрана (иначе тикают в мёртвый DOM)
      (window.__timers || []).forEach(clearInterval); window.__timers = [];
      // 2) переносим per-page стили из <head> (общий style.css оставляем как есть)
      document.querySelectorAll('[data-spa-style]').forEach((e) => e.remove());
      doc.querySelectorAll('head style, head link[rel="stylesheet"]').forEach((e) => {
        if (e.tagName === 'LINK' && (e.getAttribute('href') || '').endsWith('style.css')) return;
        const c = e.cloneNode(true); c.setAttribute('data-spa-style', '1'); document.head.appendChild(c);
      });
      // 3) флаг no-nav переносим с нового экрана
      if (doc.body.dataset.noNav !== undefined) document.body.dataset.noNav = '';
      else delete document.body.dataset.noNav;
      // 5) подменяем весь .phone (у collection контейнер .cwrap, у прочих .wrap — заменяем общий .phone)
      document.querySelector('.phone').replaceWith(newPhone);
      document.title = doc.title;
      if (push) history.pushState({ spa: 1 }, '', href);
      window.scrollTo(0, 0);
      // 6) догружаем скрипты нового экрана
      for (const sc of doc.querySelectorAll('script[src]')) {
        const s = sc.getAttribute('src');
        if (s === 'app.js' || s === 'nav.js') continue;
        await ensureScript(s);
      }
      // 7) переинициализируем экран
      window.runApp();
    } catch (e) { location.href = href; }                     // любой сбой → надёжная обычная навигация
  }
  window.navigate = navigate;

  // Перехват внутренних ссылок (плитки Леса, ссылки Кошелька). Внешние/новые вкладки — не трогаем.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!/\.html($|[?#])/.test(href) || /^(https?:)?\/\//.test(href) || a.target === '_blank') return;
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => navigate(location.pathname.split('/').pop() || 'index.html', false));
})();
