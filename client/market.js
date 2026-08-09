// Лавки / ярмарка.
// Зависит от window.api, window.esc, window.refreshBalance, window.capturePhoto.
window.runMarket = function () {
  const api = window.api;
  const esc = window.esc;
  const refreshBalance = window.refreshBalance;
  const capturePhoto = window.capturePhoto;

// ── Лавки ──
function marketNote(text, ok) {
  const n = document.getElementById('note'); if (!n) return;
  n.style.display = 'block'; n.textContent = text; n.style.color = ok ? '#5f8e37' : '#b3452e';
}
async function loadOrders() {
  const box = document.getElementById('ordersBox'); if (!box) return;
  const list = await api('/api/orders');
  if (!Array.isArray(list) || !list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<h3>Мои сделки</h3>' + list.map((o) => {
    const buy = o.role === 'buy';
    const meta = buy
      ? `У ${esc(o.seller_name)} · ${o.price} 🌰 · ждёт получения`
      : `От ${esc(o.buyer_name)} · ${o.price} 🌰 · отдай товар`;
    const acts = buy
      ? `<button class="btn btn-sm conf" type="button" data-id="${o.id}">Получил</button>
         <button class="cancel" type="button" data-id="${o.id}">Отмена</button>`
      : `<button class="cancel" type="button" data-id="${o.id}">Отменить</button>`;
    return `<div class="ord-row"><div class="info"><div class="t">${esc(o.title)}</div><div class="m">${meta}</div></div>
      <div class="acts">${acts}</div></div>`;
  }).join('');
  box.querySelectorAll('.conf').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Товар у тебя? Шишки уйдут продавцу.')) return;
      btn.disabled = true;
      const r = await api('/api/order/confirm', { id: btn.dataset.id });
      if (r.error) { marketNote(r.error, false); btn.disabled = false; return; }
      marketNote('Сделка закрыта — спасибо!', true); refreshBalance(); loadMarket();
    };
  });
  box.querySelectorAll('.cancel').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Отменить заказ? Шишки вернутся покупателю.')) return;
      btn.disabled = true;
      const r = await api('/api/order/cancel', { id: btn.dataset.id });
      if (r.error) { marketNote(r.error, false); btn.disabled = false; return; }
      marketNote('Заказ отменён', true); refreshBalance(); loadMarket();
    };
  });
}
async function loadMarket() {
  await loadOrders();
  const shops = await api('/api/shops');
  const c = document.getElementById('marketList'); c.innerHTML = '';
  const openBtn = document.getElementById('openShopBtn');
  const hasMine = Array.isArray(shops) && shops.some((s) => s.mine);
  if (openBtn) openBtn.hidden = !!hasMine;
  if (!Array.isArray(shops) || shops.error) {
    c.innerHTML = `<div class="mkt-empty">${esc(shops?.error || 'Не удалось загрузить лавки')}</div>`;
    return;
  }
  if (!shops.length) {
    c.innerHTML = '<div class="mkt-empty">Пока никого на ярмарке.<br>Открой первую лавку!</div>';
    return;
  }
  for (const s of shops) {
    const art = s.photo ? s.photo : ('assets/' + (s.avatar || 'friend1.webp'));
    const artClass = s.photo ? '' : ' avatar-fallback';
    const el = document.createElement('div'); el.className = 'shop-card';
    el.innerHTML = `${s.is_heir ? '<span class="heir">Наследник</span>' : ''}${s.mine ? '<span class="mine-tag">Моя</span>' : ''}
      <div class="stall"><img class="${artClass.trim()}" src="${art}" alt=""></div>
      <div class="shop-name">${esc(s.name)}</div>
      ${s.mine ? `<div class="shop-mgmt">
          <button class="mini rename" type="button">✏️ Имя</button>
          <button class="mini logo" type="button">🖼 Фото</button>
          <button class="mini close" type="button">Закрыть</button>
        </div>` : ''}
      <div class="lots"></div>
      ${s.mine ? `<div class="lotForm">
          <input class="lTitle" placeholder="Название товара" maxlength="24">
          <div class="row"><input class="lPrice" type="number" placeholder="Цена" min="1" style="flex:1">
            <button class="btn btn-sm lPhoto" type="button">📷</button></div>
          <button class="btn btn-lg lSave" type="button" style="margin-top:2px">Сохранить</button>
        </div>
        <div class="addLotBtn"><button class="btn btn-sm addLot" type="button">+ Добавить товар</button></div>` : ''}`;

    const lots = el.querySelector('.lots');
    if (!s.lots.length) {
      lots.innerHTML = s.mine
        ? '<div class="lot-empty">Пока пусто — добавь первый товар</div>'
        : '<div class="lot-empty">Лавка пока пуста</div>';
    }
    for (const l of s.lots) {
      const row = document.createElement('div'); row.className = 'lot-row';
      const thumb = l.photo ? l.photo : 'assets/shop/shop_ic_gift.webp';
      row.innerHTML = `<img class="lot-thumb" src="${thumb}" alt="">
        <div class="lt">${esc(l.title)}</div>
        <div class="lot-side">
          <div class="price"><img src="assets/coin1.webp" alt="">${l.price}</div>
          ${s.mine
            ? `<div class="lot-mgmt"><button class="mini le" type="button" title="Изменить">✏️</button>
                 <button class="mini lr" type="button" title="Убрать">🗑</button></div>`
            : `<button class="shop-buy" type="button">Купить</button>`}
        </div>`;
      if (s.mine) {
        row.querySelector('.le').onclick = () => openLotForm(el, l);
        row.querySelector('.lr').onclick = async () => {
          if (!confirm(`Убрать «${l.title}» из продажи?`)) return;
          const r = await api('/api/lot/remove', { id: l.id });
          if (r.error) marketNote(r.error, false); else loadMarket();
        };
      } else {
        row.querySelector('.shop-buy').onclick = async () => {
          if (!confirm(`Заказать «${l.title}» за ${l.price} 🌰?\nШишки заморозятся, пока не подтвердишь получение.`)) return;
          const r = await api('/api/lot/buy', { id: l.id });
          if (r.error) marketNote(r.error, false);
          else {
            marketNote('Заказано у ' + s.name + '! Когда получишь — жми «Получил» выше.', true);
            refreshBalance(); loadMarket();
          }
        };
      }
      lots.appendChild(row);
    }

    if (s.mine) {
      el.querySelector('.rename').onclick = async () => {
        const name = prompt('Новое название лавки:', s.name); if (!name) return;
        const r = await api('/api/shop/rename', { name: name.trim() });
        if (r.error) marketNote(r.error, false); else loadMarket();
      };
      el.querySelector('.logo').onclick = async () => {
        const photo = await capturePhoto(); if (!photo) return;
        const r = await api('/api/shop/photo', { photo });
        if (r.error) marketNote(r.error, false); else loadMarket();
      };
      el.querySelector('.close').onclick = async () => {
        if (!confirm('Закрыть лавку? Все товары уйдут с витрины.')) return;
        const r = await api('/api/shop/close', {});
        if (r.error) marketNote(r.error, false); else loadMarket();
      };
      const form = el.querySelector('.lotForm');
      let photoBuf = null, editId = null;
      el.querySelector('.addLot').onclick = () => openLotForm(el, null);
      function openLotForm(card, lot) {
        editId = lot ? lot.id : null; photoBuf = null;
        card.querySelector('.lTitle').value = lot ? lot.title : '';
        card.querySelector('.lPrice').value = lot ? lot.price : '';
        card.querySelector('.lPhoto').textContent = '📷';
        card.querySelector('.lotForm').style.display = 'block';
        card.querySelector('.lTitle').focus();
      }
      form.querySelector('.lPhoto').onclick = async () => {
        const p = await capturePhoto(); if (!p) return;
        photoBuf = p; form.querySelector('.lPhoto').textContent = '📷 ✓';
      };
      form.querySelector('.lSave').onclick = async () => {
        const title = form.querySelector('.lTitle').value.trim(), price = form.querySelector('.lPrice').value;
        if (!title || !(price > 0)) { marketNote('Укажи название и цену больше 0', false); return; }
        const r = editId
          ? await api('/api/lot/edit', { id: editId, title, price })
          : await api('/api/lot/add', { title, price, photo: photoBuf });
        if (r.error) { marketNote(r.error, false); return; }
        if (editId && photoBuf) await api('/api/lot/photo', { id: editId, photo: photoBuf });
        form.style.display = 'none'; loadMarket();
      };
    }
    c.appendChild(el);
  }
}
loadMarket();
document.getElementById('openShopBtn').onclick = () => {
  const f = document.getElementById('createForm');
  f.classList.toggle('on');
  if (f.classList.contains('on')) document.getElementById('shopName')?.focus();
};
document.getElementById('createShopBtn').onclick = async () => {
  const name = document.getElementById('shopName').value, lot = document.getElementById('shopLot').value, price = document.getElementById('shopPrice').value;
  const r = await api('/api/shop/create', { name, lot, price });
  if (r.error) marketNote(r.error, false);
  else {
    marketNote('Твоя лавка открыта!', true);
    document.getElementById('createForm').classList.remove('on');
    loadMarket();
  }
};
};
