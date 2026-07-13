// Единый нижний навбар: рендерит иконки, подсвечивает активный экран, ведёт переходы.
// Экран без навбара помечается <body data-no-nav>.
(function () {
  if (document.body.dataset.noNav !== undefined) return;
  const items = [
    { i: 'n1', href: 'index.html' },   // Кошелёк
    { i: 'n2', href: 'transfers.html' }, // Подарки
    { i: 'n3', href: 'shop.html' },    // Магазин
    { i: 'n4', href: 'quests.html' },  // Задания
    { i: 'n5', href: 'market.html' },  // Лавки
    { i: 'n6', href: 'forest.html' },  // Лес (меню механик)
  ];
  let file = location.pathname.split('/').pop() || 'index.html';
  const nav = document.createElement('nav');
  nav.className = 'nav';
  for (const it of items) {
    const b = document.createElement('button');
    if (it.href === file) b.className = 'active';
    b.innerHTML = `<img src="assets/nav/${it.i}.png" alt="">`;
    b.addEventListener('click', () => { if (it.href !== file) location.href = it.href; });
    nav.appendChild(b);
  }
  document.querySelector('.wrap').appendChild(nav);
  // подэкраны (не из навбара) получают кнопку «Назад»
  if (!items.some((it) => it.href === file)) {
    const back = document.createElement('button');
    back.setAttribute('aria-label', 'Назад');
    back.style.cssText = 'position:absolute;top:14px;left:12px;z-index:5;background:rgba(255,250,240,.94);' +
      'border:3px solid #d9c39a;border-radius:14px;padding:6px 13px;font-size:19px;font-weight:900;color:#6b4f3a;cursor:pointer';
    back.textContent = '\u2190';
    back.onclick = () => { if (history.length > 1) history.back(); else location.href = 'forest.html'; };
    document.querySelector('.wrap').appendChild(back);
  }
})();
