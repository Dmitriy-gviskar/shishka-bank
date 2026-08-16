// Поляна друзей: рейтинг по добытым шишкам / делам / картам.
window.runBoard = function () {
  const api = window.api;
  const esc = window.esc;
  const MEDAL = ['', '🥇', '🥈', '🥉'];
  let sort = 'cones';
  let data = null;

  const scoreOf = (row) => Number(row[sort] || 0);
  const labelOf = (n) => {
    if (sort === 'tasks') return String(n);
    if (sort === 'cards') return String(n);
    return String(n);
  };

  function render() {
    const box = document.getElementById('boardList');
    if (!box || !data) return;
    const rows = [...(data.rows || [])].sort((a, b) => {
      const d = scoreOf(b) - scoreOf(a);
      if (d) return d;
      return String(a.name).localeCompare(String(b.name), 'ru');
    });
    if (!rows.length) {
      box.innerHTML = '<div class="empty">Пока только ты. Добавь друга по коду — появитесь вместе 🌲</div>';
      return;
    }
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    const parts = [];
    if (top.length) {
      const order = top.length === 1 ? [top[0]]
        : top.length === 2 ? [top[1], top[0]]
        : [top[1], top[0], top[2]];
      const places = top.length === 1 ? [1]
        : top.length === 2 ? [2, 1]
        : [2, 1, 3];
      const cols = top.length === 1 ? '1fr' : top.length === 2 ? '1fr 1fr' : '1fr 1.15fr 1fr';
      parts.push(`<div class="podium" style="grid-template-columns:${cols}">`);
      order.forEach((p, i) => {
        const place = places[i];
        parts.push(`<div class="pod p${place}${p.mine ? ' mine' : ''}">
          <div class="place">${MEDAL[place] || place}</div>
          <img src="assets/${p.avatar || 'friend1.webp'}" alt="">
          <div class="nm">${esc(p.name)}${p.mine ? ' · ты' : ''}</div>
          <div class="sc">${labelOf(scoreOf(p))}</div>
        </div>`);
      });
      parts.push('</div>');
    }
    rest.forEach((p, i) => {
      const place = i + 4;
      parts.push(`<div class="bRow${p.mine ? ' mine' : ''}">
        <div class="rk">${place}</div>
        <img src="assets/${p.avatar || 'friend1.webp'}" alt="">
        <div class="nm">${esc(p.name)}${p.mine ? '<span class="you">ты</span>' : ''}</div>
        <div class="sc">${labelOf(scoreOf(p))}</div>
      </div>`);
    });
    if (rows.length === 1 && rows[0].mine) {
      parts.push('<div class="empty" style="margin-top:6px">Добавь друга по коду — и поляна оживет.</div>');
    }
    box.innerHTML = parts.join('');
  }

  document.getElementById('sortTabs')?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      sort = b.dataset.sort || 'cones';
      document.querySelectorAll('#sortTabs button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
  });

  api('/api/board').then((d) => {
    if (!d || d.error) {
      const box = document.getElementById('boardList');
      if (box) box.innerHTML = `<div class="empty">${esc(d && d.error ? d.error : 'не загрузилось')}</div>`;
      return;
    }
    data = d;
    render();
  });
};
