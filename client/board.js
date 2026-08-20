// Поляна леса: весь лес или только друзья. Шишки / дела / карты.
window.runBoard = function () {
  const api = window.api;
  const esc = window.esc;
  const MEDAL = ['', '🥇', '🥈', '🥉'];
  let sort = 'cones';
  let scope = 'all';
  let data = null;

  const scoreOf = (row) => Number(row[sort] || 0);
  const labelOf = (n) => {
    if (sort === 'tasks') return String(n);
    if (sort === 'cards') return String(n);
    return String(n);
  };
  const openMail = (id, name) => {
    try { sessionStorage.setItem('mailOpenChat', JSON.stringify({ id, name })); } catch {}
    location.href = 'mail.html';
  };
  const actsOf = (p) => {
    if (p.mine) return '';
    const write = `<button type="button" class="ask write" data-act="write" data-id="${p.id}" data-name="${esc(p.name)}">✉</button>`;
    if (p.friend) return `<div class="acts">${write}</div>`;
    if (p.pending) return `<div class="acts">${write}<div class="wait">ждём</div></div>`;
    return `<div class="acts">${write}<button type="button" class="ask" data-act="ask" data-id="${p.id}" data-name="${esc(p.name)}">В друзья</button></div>`;
  };

  function render() {
    const box = document.getElementById('boardList');
    if (!box || !data) return;
    const pool = (data.rows || []).filter((r) => scope === 'all' || r.friend || r.mine);
    const rows = [...pool].sort((a, b) => {
      const d = scoreOf(b) - scoreOf(a);
      if (d) return d;
      return String(a.name).localeCompare(String(b.name), 'ru');
    });
    if (!rows.length) {
      box.innerHTML = scope === 'friends'
        ? '<div class="empty">Друзей пока нет — открой «Весь лес» и подай заявку 🌲</div>'
        : '<div class="empty">В лесу пока тихо.</div>';
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
          <div class="nm">${esc(p.name)}${p.mine ? ' · ты' : (scope === 'all' && p.friend ? ' · друг' : '')}</div>
          <div class="sc">${labelOf(scoreOf(p))}</div>
          ${actsOf(p)}
        </div>`);
      });
      parts.push('</div>');
    }
    rest.forEach((p, i) => {
      const place = i + 4;
      parts.push(`<div class="bRow${p.mine ? ' mine' : ''}">
        <div class="rk">${place}</div>
        <img src="assets/${p.avatar || 'friend1.webp'}" alt="">
        <div class="nm">${esc(p.name)}${p.mine ? '<span class="you">ты</span>' : (scope === 'all' && p.friend ? '<span class="pal">друг</span>' : '')}</div>
        <div class="sc">${labelOf(scoreOf(p))}</div>
        ${actsOf(p)}
      </div>`);
    });
    if (scope === 'friends' && rows.length === 1 && rows[0].mine) {
      parts.push('<div class="empty" style="margin-top:6px">Добавь друга с поляны — и сравнитесь.</div>');
    }
    box.innerHTML = parts.join('');
    box.querySelectorAll('[data-act="write"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openMail(btn.dataset.id, btn.dataset.name || '');
      };
    });
    box.querySelectorAll('[data-act="ask"]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const r = await api('/api/friends/request', { to: btn.dataset.id });
        if (r.error) { alert(r.error); btn.disabled = false; return; }
        const row = data.rows.find((x) => x.id === btn.dataset.id);
        if (row) {
          row.pending = r.status === 'pending';
          row.friend = r.status === 'accepted';
        }
        render();
      };
    });
  }

  document.getElementById('scopeTabs')?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      scope = b.dataset.scope || 'all';
      document.querySelectorAll('#scopeTabs button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
  });
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
