// Новости леса: события Банка и семьи.
window.runNews = function () {
  const api = window.api, esc = window.esc;
  const ICON = { achievement: 'ach/icon_work.webp', rain: 'coin1.webp', payout: 'coin1.webp', guild_pay: 'coin1.webp',
    pot: 'pot.webp', guild_new: 'nav/n5.webp', auction: 'auction.webp', event: 'spirit.webp' };
  api('/api/news').then((list) => {
    const c = document.getElementById('newsList'); c.innerHTML = '';
    if (list.error || !list.length) { c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700">В лесу пока тихо</span></div>'; return; }
    for (const n of list) {
      const when = new Date(n.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      const el = document.createElement('div'); el.className = 'card ev';
      el.innerHTML = `<img src="assets/${ICON[n.kind] || 'coin1.webp'}" onerror="this.src='assets/coin1.webp'">
        <div><div class="nm">${n.kind === 'achievement' ? `${esc(n.who)} открыл награду «${esc(n.what)}»` : (n.who ? esc(n.who) + ': ' : '') + esc(n.what)}</div>
        <div class="k">${when}</div></div>` +
        (n.amount ? `<div class="amt" style="color:#5f8e37">${n.amount}</div>` : '');
      c.appendChild(el);
    }
  });
};
