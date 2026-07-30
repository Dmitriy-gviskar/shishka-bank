// Лесная коллекция: альбом, паки, слияния, рынок, аукционы карт.
// Вынесено из app.js — этот код нужен только на collection.html, а грузился на всех экранах.
// Зависит от глобальных api(), esc(), refreshBalance() из app.js — подключать ПОСЛЕ него.
window.runCards = function () {
  const api = window.api, esc = window.esc, refreshBalance = window.refreshBalance;
  const CAT = { zver: '🦊 Звери', rastenie: '🌿 Растения', nasekomoe: '🐞 Насекомые', special: '🎖 Особые' };
  const asset = (code, grade) => `assets/cards/${code}_${grade}.webp`;          // крупный показ
  const thumb = (code, grade) => `assets/cards/thumb/${code}_${grade}.webp`;    // сетки: в 5 раз легче
  let RAR = {}, DATA = null, LOTS = [], WANTS = [], AUCS = [], LORE = {}, FAM = null, FACTS = {}, HIST = {}, SEASONS = [], MARKET = true;
  const note = (t) => {   // всплывающая подсказка поверх экрана
    const el = document.createElement('div'); el.textContent = t;
    el.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);z-index:50;background:#fffaf0;border:2px solid #d9c39a;border-radius:12px;padding:9px 16px;font-weight:800;color:#b3452e;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:80%;text-align:center';
    document.querySelector('.phone').appendChild(el); setTimeout(() => el.remove(), 2200);
  };

  // ── свои диалоги вместо системных: детям 7-12 нативные prompt/confirm неудобны ──
  function ask(title, text, okText = 'Да', cancelText = 'Отмена') {
    return new Promise((resolve) => {
      const ov = document.getElementById('askOv'), sheet = document.getElementById('askSheet');
      sheet.innerHTML = `<h3>${title}</h3><div class="asktext">${text}</div>
        <div class="acts"><button class="a-ok">${okText}</button><button class="a-no">${cancelText}</button></div>`;
      const close = (v) => { ov.classList.remove('on'); ov.onclick = null; resolve(v); };
      sheet.querySelector('.a-ok').onclick = () => close(true);
      sheet.querySelector('.a-no').onclick = () => close(false);
      ov.onclick = (e) => { if (e.target.id === 'askOv') close(false); };
      ov.classList.add('on');
    });
  }

  // выбор цены ползунком и пресетами: без клавиатуры и без ввода чисел
  function askPrice(title, { base, lo, hi, initial, hint, okText = 'Готово' }) {
    return new Promise((resolve) => {
      const ov = document.getElementById('askOv'), sheet = document.getElementById('askSheet');
      const start = Math.min(hi, Math.max(lo, initial || base));
      sheet.innerHTML = `<h3>${title}</h3>
        ${hint ? `<div class="asktext">${hint}</div>` : ''}
        <div class="pricebig"><span id="pv">${start}</span> 🌰</div>
        <input class="pricerange" type="range" id="pr" min="${lo}" max="${hi}" value="${start}">
        <div class="presets">
          <button data-v="${Math.max(lo, Math.round(base * 0.7))}">дешевле</button>
          <button data-v="${Math.min(hi, Math.max(lo, base))}">обычная</button>
          <button data-v="${Math.min(hi, Math.round(base * 1.5))}">дороже</button>
        </div>
        <div class="asktext" id="pdeal"></div>
        <div class="acts"><button class="a-ok">${okText}</button><button class="a-no">Отмена</button></div>`;
      const range = sheet.querySelector('#pr'), val = sheet.querySelector('#pv'), deal = sheet.querySelector('#pdeal');
      const paint = () => {
        val.textContent = range.value;
        const v = +range.value;
        deal.textContent = v <= base * 0.7 ? 'дёшево — купят быстро'
          : v >= base * 1.5 ? 'дорого — можно ждать долго' : 'обычная цена';
      };
      range.oninput = paint; paint();
      sheet.querySelectorAll('.presets button').forEach((b) => b.onclick = () => { range.value = b.dataset.v; paint(); });
      const close = (v) => { ov.classList.remove('on'); ov.onclick = null; resolve(v); };
      sheet.querySelector('.a-ok').onclick = () => close(+range.value);
      sheet.querySelector('.a-no').onclick = () => close(null);
      ov.onclick = (e) => { if (e.target.id === 'askOv') close(null); };
      ov.classList.add('on');
    });
  }

  function render(d) {
    DATA = d;
    RAR = {}; d.rarities.forEach((r) => RAR[r.grade] = r);
    LORE = {}; (d.lore || []).forEach((l) => LORE[l.category + ':' + l.grade] = l);   // титул+фраза по категории и грейду
    FAM = d.familiar || null;
    FACTS = {}; (d.facts || []).forEach((f) => FACTS[f.code] = f.fact);   // только за собранных целиком
    HIST = {}; (d.history || []).forEach((h) => HIST[h.code + ':' + h.grade] = h);   // за сколько такие уходили в круге
    MARKET = d.market_allowed !== false;   // ведущий может закрыть торговлю ребёнку
    const isFull = (c) => c.grades.filter((x) => x.qty > 0).length === 6;
    document.getElementById('progTxt').textContent = `Собрано: ${d.collected} / ${d.total}`;
    document.getElementById('progBar').style.width = Math.round(d.collected / d.total * 100) + '%';
    // гарант новинки — видно, сколько паков осталось
    const pityEl = document.getElementById('pityTxt');
    if (pityEl) {
      const guar = !d.pity ? '' : d.pity.to_top <= d.pity.to_new
        ? ` · через ${d.pity.to_top} ${plural(d.pity.to_top, 'пак', 'пака', 'паков')} — Эпическая+, которой нет`
        : ` · через ${d.pity.to_new} ${plural(d.pity.to_new, 'пак', 'пака', 'паков')} — новая карта точно`;
      pityEl.textContent = `Всего собрано ${d.collected} из ${d.total}${guar}`;
    }
    const av = document.getElementById('albumView'); av.innerHTML = '';
    const allCards = d.cards.filter((c) => c.category !== 'special');
    renderGroups(allCards, av);
    // Категорийные табы: показать + скролл по клику
    const catTabs = document.getElementById('catTabs');
    if (catTabs) {
      catTabs.style.display = 'flex';
      catTabs.querySelectorAll('button').forEach((btn) => {
        btn.onclick = () => {
          const cat = btn.dataset.cat;
          const hdr = av.querySelector('.cat[data-cat="' + cat + '"]') || av.querySelectorAll('.cat')[['zver','rastenie','nasekomoe'].indexOf(cat)];
          if (hdr) hdr.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      });
    }

    // ── Особые карты: их не выпадает из паков, их вручает ведущий за дело ──
    const specials = d.cards.filter((c) => c.category === 'special');
    if (specials.length) {
      const have = specials.filter((c) => c.grades.some((g) => g.qty > 0)).length;
      const h = document.createElement('div'); h.className = 'season sp';
      h.innerHTML = `<span class="sn">🎖 Особые</span><span class="stag off">за дело, не из паков</span>
        <span class="cc-count">${have}/${specials.length}</span>`;
      av.appendChild(h);
      const box = document.createElement('div'); box.className = 'sbody';
      for (const c of specials) {
        const g6 = c.grades.find((g) => g.grade === 6) || { qty: 0 };
        const owned = g6.qty > 0;
        const el = document.createElement('div'); el.className = 'being spone' + (owned ? ' full' : '');
        el.innerHTML = `<div class="spcell ${owned ? 'has' : 'locked'}">
            <img src="${thumb(c.code, 6)}" alt="" loading="lazy">
            ${g6.qty > 1 ? `<div class="gdup">×${g6.qty}</div>` : ''}</div>
          <div class="spinfo"><div class="bn">${c.name}</div>
            <div class="spwhy">${owned ? 'у тебя есть' : (c.occasion || 'особый случай')}</div></div>`;
        el.onclick = () => openDetail(c, 6);
        box.appendChild(el);
      }
      av.appendChild(box);
    }
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function renderGroups(cards, host) {
    const groups = {};
    cards.forEach((c) => (groups[c.category] ||= []).push(c));
    const av = host;
    for (const cat of ['zver', 'rastenie', 'nasekomoe']) {
      if (!groups[cat]) continue;
      const fullN = groups[cat].filter((c) => c.grades.filter((x) => x.qty > 0).length === 6).length;
      const h = document.createElement('div'); h.className = 'cat';
      h.setAttribute('data-cat', cat);
      h.innerHTML = `${CAT[cat]}<span class="cc-count">${fullN}/${groups[cat].length}</span>`;
      av.appendChild(h);
      // каждое существо = полка из 6 ячеек-грейдов (Panini)
      for (const c of groups[cat]) {
        const have6 = c.grades.filter((x) => x.qty > 0).length;
        const full = have6 === 6;
        const being = document.createElement('div'); being.className = 'being' + (full ? ' full' : '');
        const cells = c.grades.map((gr) => {
          const rc = (RAR[gr.grade] || {}).color || '#9aa4b2';
          const has = gr.qty > 0;
          return `<div class="gcell ${has ? 'has g' + gr.grade : 'locked'}" style="--gc:${rc}">
            <img src="${thumb(c.code, gr.grade)}" alt="" loading="lazy">
            ${has && gr.qty > 1 ? `<div class="gdup">×${gr.qty}</div>` : ''}</div>`;
        }).join('');
        // подсказка возврата: где-то осталась ровно одна карта до слияния
        const almost = c.grades.some((g) => g.qty === 2 && g.grade < 6);
        being.innerHTML = `<div class="being-head"><span class="bn">${esc(c.name)}</span>
          ${almost ? '<span class="bnear">🔥 ещё 1 до эволюции</span>' : ''}
          <span class="bp ${full ? 'done' : ''}">${have6}/6${full ? ' ✓' : ''}</span></div>
          <div class="grades6">${cells}</div>`;
        being.onclick = () => openDetail(c);
        // тап по конкретной ячейке открывает деталь сразу на этом грейде (пустая — с предложением «Хочу такую»)
        being.querySelectorAll('.gcell').forEach((cell, i) => cell.onclick = (e) => {
          e.stopPropagation(); openDetail(c, c.grades[i].grade);
        });
        av.appendChild(being);
      }
    }
  }

  function openDetail(c, startGrade) {
    const sheet = document.getElementById('sheet');
    const owned = c.grades.filter((g) => g.qty > 0);
    // активный грейд для действий: заданный тапом по ячейке, иначе лучший собранный
    let sel = startGrade || (owned.length ? owned[owned.length - 1].grade : (c.best || 1));
    const draw = () => {
      const best = c.best || 1;
      const have6 = c.grades.filter((g) => g.qty > 0).length;
      const rows = c.grades.map((gr) => {
        const r = RAR[gr.grade];
        const active = gr.grade === sel ? ' active' : '';
        return `<div class="gr ${gr.qty > 0 ? 'has' : 'no'}${active}" data-g="${gr.grade}" style="--gc:${r.color}">
          <span class="dot"></span><span class="gn">${r.name}</span>
          <span class="gq">${gr.qty > 0 ? '×' + gr.qty : '—'}</span></div>`;
      }).join('');
      const isSpecial = c.category === 'special';
      const gr = c.grades.find((g) => g.grade === sel) || { qty: 0 };
      const r = RAR[sel] || RAR[1];
      // топливо для слияния: карты того же ранга у ДРУГИХ существ (излишки дублей — отдельно)
      const fuelQty = (DATA.cards || []).filter((x) => x.id !== c.id)
        .map((x) => (x.grades.find((g) => g.grade === sel) || {}).qty || 0);
      const fuelTotal = fuelQty.reduce((s, n) => s + n, 0);
      const fuelDup = fuelQty.reduce((s, n) => s + Math.max(0, n - 1), 0);
      // что доступно по этой карте на рынке и есть ли моя заявка на неё
      const offers = LOTS.filter((l) => l.code === c.code && l.grade === sel && !l.mine)
        .sort((a, b) => a.price - b.price);
      const myWant = WANTS.find((w) => w.mine && w.code === c.code && w.grade === sel);
      let acts = '';
      if (isSpecial && gr.qty > 0) {
        acts = `<div class="sub">Памятная карта${c.occasion ? `: ${c.occasion.toLowerCase()}` : ''}. Её не продают — но можно подарить другу.</div>`
          + `<button class="a-fam">${FAM && FAM.type === c.id && FAM.grade === sel ? '⭐ Снять с поляны' : '⭐ Сделать питомцем'}</button>`
          + `<button class="a-gift">🎁 Подарить другу</button>`;
      } else if (isSpecial && gr.qty === 0) {
        acts = `<div class="sub">Такую карту не выпадет из пака — её вручает ведущий${c.occasion ? `: ${c.occasion.toLowerCase()}` : ''}.</div>`;
      } else if (gr.qty > 0) {
        if (gr.qty >= 3 && sel < 6) acts += `<button class="a-merge">⬆ Прокачать · 3 шт → ${RAR[sel + 1].name}</button>`;
        // 2 своих + 4 любых того же ранга — выход из тупика «дубли есть, тройки нет»
        else if (gr.qty === 2 && sel < 6 && fuelTotal >= 4) {
          acts += `<button class="a-fuel">🔥 Слить с топливом · обе твои + 4 любых</button>`;
        }
        // видно, сколько осталось до эволюции — иначе «нужно 3» узнаёшь только упершись
        if (gr.qty < 3 && sel < 6) {
          const left = 3 - gr.qty;
          acts += `<div class="evoprog">До эволюции в «${RAR[sel + 1].name}» ${left === 1 ? 'осталась 1 карта' : `осталось ${left} карты`}
            <div class="ebar"><i style="width:${Math.round(gr.qty / 3 * 100)}%;background:${RAR[sel + 1].color}"></i></div></div>`;
        }
        if (!isSpecial) {
          acts += `<button class="a-sell">💰 Продать Банку · ${r.quicksell} 🌰</button>`;
          if (MARKET) acts += sel >= 6 ? `<button class="a-auc">🔨 На аукцион · 24 часа</button>`
                                        : `<button class="a-list">🏷 Выставить на рынок</button>`;
        }
        const isFam = FAM && FAM.type === c.id && FAM.grade === sel;
        acts += `<button class="a-fam">${isFam ? '⭐ Снять с поляны' : '⭐ Сделать питомцем'}</button>`;
        acts += `<button class="a-gift">🎁 Подарить другу</button>`;
      } else {
        acts = `<div class="sub">Этой карты у тебя ещё нет — ${MARKET ? 'открывай паки или найди на рынке' : 'открывай паки'}.</div>`;
      }
      // «Хочу такую»: сначала готовые лоты, потом — объявить свою цену
      if (MARKET && !isSpecial) {
        if (offers.length) acts += `<button class="a-buy">🛒 Купить на рынке · ${offers[0].price} 🌰${offers.length > 1 ? ` (лотов: ${offers.length})` : ''}</button>`;
        if (myWant) acts += `<button class="a-unwant">🙋 Снять заявку (${myWant.price} 🌰)</button>`;
        else acts += `<button class="a-want">🙋 Хочу такую · оставить заявку</button>`;
      }
      sheet.style.setProperty('--rc', (RAR[sel] || RAR[best]).color);
      const lo = LORE[c.category + ':' + sel] || {};
      sheet.innerHTML = `<button class="x">&times;</button>
        <img class="big" src="${asset(c.code, gr.qty > 0 ? sel : best)}" alt="${c.name}">
        <h3>${c.name}${lo.title ? ' — ' + lo.title.toLowerCase() : ''}</h3>
        <div class="sub">${CAT[c.category].slice(2)} · ${r.name}</div>
        ${lo.lore ? `<div class="lore">${lo.lore}</div>` : ''}
        ${gr.merged > 0 ? `<div class="mtag">✨ прокачана тобой${gr.merged > 1 ? ` (${gr.merged} раза)` : ''}</div>` : ''}
        ${FACTS[c.code] ? `<div class="fact"><b>Знаешь ли ты?</b> ${FACTS[c.code]}</div>`
          : (!isSpecial && have6 < 6 ? `<div class="factlock">Собери все 6 карт — узнаешь про ${c.name.toLowerCase()} кое-что настоящее</div>` : '')}
        ${isSpecial ? '' : `<div class="grades">${rows}</div>`}
        <div class="acts">${acts}</div>
        <div class="note2" id="dnote"></div>`;
      sheet.querySelector('.x').onclick = closeDetail;
      sheet.querySelectorAll('.gr').forEach((el) => el.onclick = () => { sel = +el.dataset.g; draw(); });
      const dnote = sheet.querySelector('#dnote');
      const m = sheet.querySelector('.a-merge');
      if (m) m.onclick = async () => {
        const from = sel;
        if (gr.qty === 3 && !await ask('Прокачать?', `Все три карты «${r.name}» уйдут на эволюцию, и эта ячейка в альбоме опустеет.`, 'Прокачать')) return;
        m.disabled = true;
        const r2 = await api('/api/card/merge', { type: c.id, grade: from });
        if (r2.error) { m.disabled = false; dnote.textContent = r2.error; dnote.style.color = '#b3452e'; return; }
        closeDetail();
        await evolveRitual(c, from, r2.new_grade, r2.bonus);   // ритуал: три карты → одна грейдом выше
        showRewards(r2.rewards);
        reload();
      };
      const s = sheet.querySelector('.a-sell');
      if (s) s.onclick = async () => {
        const r2 = await api('/api/card/sell', { type: c.id, grade: sel });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { dnote.textContent = 'Продано за ' + r2.payout + ' 🌰!'; dnote.style.color = '#5f8e37'; refreshBalance(); setTimeout(reload, 700); }
      };
      const bAuc = sheet.querySelector('.a-auc');
      if (bAuc) bAuc.onclick = async () => {
        const base = RAR[sel].price, lo = Math.max(1, Math.floor(base / 2)), hi = base * 3;
        const val = await askPrice('С какой цены начать торги?',
          { base, lo, hi, hint: 'Золотая карта уходит только с молотка — торги идут сутки. Банк удержит 10%.', okText: 'Начать торги' });
        if (val === null) return;
        const r2 = await api('/api/card-auction/start', { type: c.id, grade: sel, price: val });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { dnote.textContent = '🔨 Торги начались! Смотри на вкладке «Рынок»'; dnote.style.color = '#5f8e37'; setTimeout(reload, 900); }
      };
      const bGift = sheet.querySelector('.a-gift');
      if (bGift) bGift.onclick = async () => {
        const friends = await api('/api/friends');
        if (friends.error || !friends.length) { dnote.textContent = 'в твоём лесу пока нет друзей'; dnote.style.color = '#b3452e'; return; }
        const gs = document.getElementById('giftSheet');
        gs.innerHTML = `<button class="x">&times;</button><h3>Кому подарить?</h3>
          <div class="sub">«${c.name}» · ${RAR[sel].name}. Подарок бесплатный, но не больше трёх в день.</div>
          ${friends.map((f) => `<button class="gfriend" data-id="${f.id}">${f.name}</button>`).join('')}
          <div class="note2" id="gnote"></div>`;
        gs.querySelector('.x').onclick = () => document.getElementById('giftOv').classList.remove('on');
        gs.querySelectorAll('.gfriend').forEach((btn) => btn.onclick = async () => {
          document.getElementById('giftOv').classList.remove('on');
          if (!await ask('Подарить карту?', `«${c.name}» (${RAR[sel].name}) уйдёт другу ${btn.textContent} насовсем.`, 'Подарить')) { document.getElementById('giftOv').classList.add('on'); return; }
          btn.disabled = true;
          const r = await api('/api/card/gift', { to: btn.dataset.id, type: c.id, grade: sel });
          const gn = gs.querySelector('#gnote');
          if (r.error) { btn.disabled = false; gn.textContent = r.error; gn.style.color = '#b3452e'; return; }
          document.getElementById('giftOv').classList.remove('on');
          note(`🎁 Подарено! Сегодня можно ещё ${r.left_today}`);
          reload();
        });
        document.getElementById('giftOv').classList.add('on');
      };
      const bFuel = sheet.querySelector('.a-fuel');
      if (bFuel) bFuel.onclick = async () => {
        // слияние с топливом всегда забирает ОБЕ твои карты — ячейка этого ранга опустеет
        const allow = fuelDup < 4;
        const warn = `Обе твои карты «${r.name}» уйдут в слияние — эта ячейка в альбоме опустеет, `
          + `зато появится ${RAR[sel + 1].name}.`
          + (allow ? ' К тому же дублей на топливо не хватает: сгорят и чужие карты, которых у тебя по одной.' : '');
        if (!await ask('Слить с топливом?', warn, 'Слить')) return;
        bFuel.disabled = true;
        const from = sel;
        const r2 = await api('/api/card/merge-fuel', { type: c.id, grade: from, allow_unique: allow });
        if (r2.error) { bFuel.disabled = false; dnote.textContent = r2.error; dnote.style.color = '#b3452e'; return; }
        closeDetail();
        await evolveRitual(c, from, r2.new_grade, r2.bonus);
        showRewards(r2.rewards);
        reload();
      };
      const bFam = sheet.querySelector('.a-fam');
      if (bFam) bFam.onclick = async () => {
        const isFam = FAM && FAM.type === c.id && FAM.grade === sel;
        const r2 = await api('/api/familiar', isFam ? {} : { type: c.id, grade: sel });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; return; }
        FAM = isFam ? null : { type: c.id, grade: sel };
        draw();
        const dn = sheet.querySelector('#dnote');
        dn.textContent = isFam ? 'Питомец снят с поляны' : '⭐ Теперь он живёт на твоей поляне!';
        dn.style.color = '#5f8e37';
      };
      const bBuy = sheet.querySelector('.a-buy');
      if (bBuy) bBuy.onclick = async () => { if (await buyLot(offers[0])) reload(); };
      const bWant = sheet.querySelector('.a-want');
      if (bWant) bWant.onclick = async () => {
        const base = RAR[sel].price, lo = Math.max(1, Math.floor(base / 2)), hi = base * 3;
        const val = await askPrice(`Сколько дашь за «${c.name}»?`,
          { base, lo, hi, hint: `${RAR[sel].name}. Друзья увидят заявку и смогут продать тебе эту карту.`, okText: 'Оставить заявку' });
        if (val === null) return;
        const r2 = await api('/api/want', { type: c.id, grade: sel, price: val });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { await fetchMarket(); draw(); const dn = sheet.querySelector('#dnote'); dn.textContent = '🙋 Заявка размещена — друзья увидят её на рынке'; dn.style.color = '#5f8e37'; }
      };
      const bUnwant = sheet.querySelector('.a-unwant');
      if (bUnwant) bUnwant.onclick = async () => {
        const r2 = await api('/api/want/cancel', { id: myWant.id });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { await fetchMarket(); draw(); }
      };
      const l = sheet.querySelector('.a-list');
      if (l) l.onclick = async () => {
        const base = RAR[sel].price, lo = Math.max(1, Math.floor(base / 2)), hi = base * 3;
        const h = HIST[c.code + ':' + sel];
        const hint = (h ? ` В вашем лесу такие уходили в среднем за ${h.avg} 🌰 (сделок: ${h.deals}).` : '')
          + ' Банк удержит 10% с продажи (с цены меньше 10 🌰 — ничего).';
        const val = await askPrice(`За сколько продать «${c.name}»?`,
          { base, lo, hi, initial: h ? h.avg : base, hint: `${RAR[sel].name}.${hint}`, okText: 'Выставить' });
        if (val === null) return;
        const r2 = await api('/api/card/list', { type: c.id, grade: sel, price: val });
        if (r2.error) { dnote.textContent = r2.error; dnote.style.color = '#b3452e'; }
        else { dnote.textContent = '🏷 Выставлено на рынок!'; dnote.style.color = '#5f8e37'; setTimeout(reload, 700); }
      };
    };
    draw();
    document.getElementById('detail').classList.add('on');
  }
  // показать альбом-награду (после merge может собраться существо)
  function showRewards(rewards) {
    (rewards || []).forEach((rw) => {
      const t = rw.kind === 'being' ? `✨ Собрано существо «${rw.name}» +${rw.reward}🌰`
              : rw.kind === 'season' ? `🌲 Сезон «${rw.name}» собран целиком! +${rw.reward}🌰`
              : rw.kind === 'category' ? `🏆 Альбом «${rw.name}» собран! +${rw.reward}🌰`
              : `👑 Вся коллекция! +${rw.reward}🌰`;
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:50%;top:80px;transform:translateX(-50%);z-index:55;background:linear-gradient(135deg,#fff3d6,#ffd062);border:3px solid #e0a52e;border-radius:14px;padding:10px 16px;font-weight:900;color:#6b4a12;font-size:14px;box-shadow:0 6px 16px rgba(0,0,0,.4);max-width:86%;text-align:center';
      el.textContent = t; document.querySelector('.phone').appendChild(el);
      setTimeout(() => el.remove(), 3200);
    });
  }
  function closeDetail() { document.getElementById('detail').classList.remove('on'); }
  document.getElementById('detail').onclick = (e) => { if (e.target.id === 'detail') closeDetail(); };

  async function reload() {
    closeDetail();
    const [d] = await Promise.all([api('/api/cards'), fetchMarket()]);
    if (!d.error) render(d);
    if (document.getElementById('tabMarket').classList.contains('on')) renderMarket();
  }

  // честные шансы выпадения (веса открыты — красная линия)
  document.getElementById('oddsBtn').onclick = () => {
    if (!DATA) return;
    const total = DATA.rarities.reduce((s, r) => s + (r.weight || 0), 0) || 100;
    const rows = DATA.rarities.map((r) => {
      const pct = ((r.weight || 0) / total * 100);
      return `<div class="gr has" style="--gc:${r.color}"><span class="dot"></span>
        <span class="gn">${r.name}</span>
        <span class="gq">${pct % 1 === 0 ? pct : pct.toFixed(1)}%</span></div>`;
    }).join('');
    const sh = document.getElementById('oddsSheet');
    const p = DATA.pity;
    const active = (DATA.seasons || []).find((s) => s.status === 'active');
    sh.innerHTML = `<button class="x">&times;</button>
      <h3>Шансы выпадения</h3>
      <div class="sub">В паке 7 карт. У каждой — свой шанс:</div>
      <div class="grades">${rows}</div>
      ${p ? `<div class="guar"><b>Без удачи тоже не останешься</b>
        Каждый 10-й пак приносит карту, которой у тебя ещё нет.
        Каждый 50-й — карту Эпическую или выше из тех, что у тебя не собраны.
        ${p.to_new === p.to_top ? `Следующий такой пак — через ${p.to_new}.`
          : `Новая карта — через ${p.to_new}, Эпическая+ — через ${p.to_top}.`}</div>` : ''}
      ${active ? `<div class="sub" style="line-height:1.4">Собрано ${d.collected} из ${d.total} существ. Карты можно выменять или купить у друзей.</div>` : ''}
      <div class="sub" style="margin-top:8px;line-height:1.4">Мы честно показываем шансы. Шишки нельзя купить за деньги — только заработать. 🌲</div>`;
    sh.querySelector('.x').onclick = () => document.getElementById('oddsOv').classList.remove('on');
    document.getElementById('oddsOv').classList.add('on');
  };
  document.getElementById('oddsOv').onclick = (e) => { if (e.target.id === 'oddsOv') document.getElementById('oddsOv').classList.remove('on'); };

  // ── Обменная полка: 5 лишних карт одного ранга → 1 недостающая того же ранга ──
  function openExchange() {
    if (!DATA) return;
    const sheet = document.getElementById('exchSheet');
    const spare = (g) => (DATA.cards || []).reduce((s, c) => {
      const q = (c.grades.find((x) => x.grade === g) || {}).qty || 0; return s + Math.max(0, q - 1); }, 0);
    const draw = () => {
      const rows = DATA.rarities.map((r) => {
        const n = spare(r.grade);
        return `<div class="exrow" style="--gc:${r.color}"><span class="dot"></span>
          <span class="en">${r.name}</span><span class="es">лишних: ${n}</span>
          <button data-g="${r.grade}" ${n >= 5 ? '' : 'disabled'}>Обменять 5</button></div>`;
      }).join('');
      sheet.innerHTML = `<button class="x">&times;</button>
        <h3>Обменная полка</h3>
        <div class="sub">Отдай 5 лишних карт одного ранга — получишь одну того же ранга, которой у тебя ещё нет.
          Карты из альбома не пострадают: в обмен уходят только дубли.</div>
        ${rows}<div class="note2" id="exnote"></div>`;
      sheet.querySelector('.x').onclick = () => document.getElementById('exchOv').classList.remove('on');
      sheet.querySelectorAll('.exrow button').forEach((btn) => btn.onclick = async () => {
        btn.disabled = true;
        const r = await api('/api/card/exchange', { grade: +btn.dataset.g });
        const note2 = sheet.querySelector('#exnote');
        if (r.error) { note2.textContent = r.error; note2.style.color = '#b3452e'; return; }
        document.getElementById('exchOv').classList.remove('on');
        await revealCard(r.card);           // новая карта — с той же подачей, что в паке
        showRewards(r.rewards);
        await reload(); openExchange();     // полка остаётся открытой: можно менять дальше
      });
    };
    draw();
    document.getElementById('exchOv').classList.add('on');
  }
  document.getElementById('exchBtn').onclick = openExchange;
  document.getElementById('exchOv').onclick = (e) => { if (e.target.id === 'exchOv') document.getElementById('exchOv').classList.remove('on'); };
  document.getElementById('giftOv').onclick = (e) => { if (e.target.id === 'giftOv') document.getElementById('giftOv').classList.remove('on'); };

  // показать одну полученную карту: топовые — с walkout, простые — крупно на пару секунд
  function revealCard(card) {
    if (card.grade >= 5) return jackpotWalkout(card);
    return new Promise((resolve) => {
      const ov = document.getElementById('packOv'), box = document.getElementById('packCards');
      const done = document.getElementById('packDone'), h = document.getElementById('packH');
      document.getElementById('crate').style.display = 'none';
      document.getElementById('packRewards').innerHTML = '';
      box.innerHTML = ''; h.style.display = 'block'; h.textContent = '♻ Обмен удался!';
      const col = (RAR[card.grade] || {}).color || '#9aa4b2';
      const el = document.createElement('div'); el.className = 'pcard'; el.style.setProperty('--rc', col);
      el.style.width = '150px';
      el.innerHTML = `<img src="${asset(card.code, card.grade)}">`;
      box.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
      done.style.display = 'block'; done.textContent = 'Забрать';
      ov.classList.add('on');
      done.onclick = () => { ov.classList.remove('on'); done.textContent = 'Забрать'; resolve(); };
    });
  }

  // щепки + дождь шишек из точки рубки
  function burstChips(n) {
    const box = document.getElementById('chips'); box.innerHTML = '';
    const parts = ['🪵', '🌰', '🪵', '🌰', '✨', '🌰'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.textContent = parts[i % parts.length];
      const ang = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 160;
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist - 60) + 'px');   // чуть вверх
      s.style.setProperty('--dr', (Math.random() * 720 - 360) + 'deg');
      s.style.fontSize = (18 + Math.random() * 20) + 'px';
      box.appendChild(s);
      requestAnimationFrame(() => s.classList.add('fly'));
    }
    setTimeout(() => { box.innerHTML = ''; }, 1000);
  }

  // JACKPOT walkout: топ-карта (легендарка/золото) огромной в центр с лучами и тряской
  function jackpotWalkout(card) {
    return new Promise((resolve) => {
      const jp = document.getElementById('jackpot'), img = document.getElementById('jpImg');
      const label = document.getElementById('jpLabel'), cardEl = document.getElementById('jpCard');
      const parts = document.getElementById('jpParts');
      const rar = DATA.rarities.find((x) => x.grade === card.grade) || {};
      const col = rar.color || '#ffc21f';
      jp.style.setProperty('--jc', col);
      img.src = asset(card.code, card.grade);
      label.textContent = card.grade === 6 ? 'Золотая!!!' : 'Легендарная!';
      // рестарт анимаций
      cardEl.style.animation = 'none'; label.style.animation = 'none'; void cardEl.offsetWidth;
      cardEl.style.animation = ''; label.style.animation = '';
      jp.classList.add('on');
      const phone = document.querySelector('.phone');
      phone.classList.remove('shake'); void phone.offsetWidth; phone.classList.add('shake');
      // взрыв частиц
      parts.innerHTML = '';
      const emo = card.grade === 6 ? ['🌟', '🌰', '✨', '👑', '💫'] : ['⭐', '🌰', '✨', '🔥'];
      for (let i = 0; i < 26; i++) {
        const s = document.createElement('span'); s.textContent = emo[i % emo.length];
        const a = Math.random() * 6.28, d = 120 + Math.random() * 220;
        s.style.setProperty('--dx', Math.cos(a) * d + 'px');
        s.style.setProperty('--dy', Math.sin(a) * d + 'px');
        s.style.setProperty('--dr', (Math.random() * 720 - 360) + 'deg');
        s.style.fontSize = (16 + Math.random() * 22) + 'px';
        s.style.animationDelay = (Math.random() * .3) + 's';
        parts.appendChild(s);
      }
      const close = () => { jp.classList.remove('on'); jp.onclick = null; resolve(); };
      // авто-продолжение через 2.6с или по тапу (не раньше 0.8с, чтоб не проскочить)
      setTimeout(() => { jp.onclick = close; }, 800);
      setTimeout(close, 2600);
    });
  }

  // РИТУАЛ ЭВОЛЮЦИИ: три карты грейда N слетаются в центр, вспышка — рождается карта грейда N+1
  function evolveRitual(c, fromGrade, toGrade, bonus) {
    return new Promise((resolve) => {
      const ov = document.getElementById('evo');
      const rTo = RAR[toGrade] || {}, rFrom = RAR[fromGrade] || {};
      ov.style.setProperty('--ec', rTo.color || '#ffc21f');
      ov.style.setProperty('--ec0', rFrom.color || '#9aa4b2');
      ['evoS1', 'evoS2', 'evoS3'].forEach((id) => document.getElementById(id).src = thumb(c.code, fromGrade));
      document.getElementById('evoNewImg').src = asset(c.code, toGrade);
      document.getElementById('evoLabel').innerHTML = bonus
        ? `Двойная эволюция! ${c.name} перескочил ранг<b>${rTo.name || ''}!</b>`
        : `${c.name} стал сильнее<b>${rTo.name || ''}!</b>`;
      // частицы разлетаются в момент вспышки (0.85с) — эмодзи ярче на верхних грейдах
      const parts = document.getElementById('evoParts'); parts.innerHTML = '';
      const emo = toGrade >= 5 ? ['🌟', '✨', '👑', '💫'] : ['✨', '🍃', '⭐', '🌰'];
      for (let i = 0; i < 22; i++) {
        const s = document.createElement('span'); s.textContent = emo[i % emo.length];
        const a = Math.random() * 6.28, d = 90 + Math.random() * 190;
        s.style.setProperty('--dx', Math.cos(a) * d + 'px');
        s.style.setProperty('--dy', Math.sin(a) * d + 'px');
        s.style.setProperty('--dr', (Math.random() * 720 - 360) + 'deg');
        s.style.fontSize = (14 + Math.random() * 18) + 'px';
        s.style.animationDelay = (0.85 + Math.random() * 0.3) + 's';
        parts.appendChild(s);
      }
      // рестарт CSS-анимаций (ритуал может запускаться подряд)
      ov.classList.remove('on'); void ov.offsetWidth; ov.classList.add('on');
      const phone = document.querySelector('.phone');
      setTimeout(() => { phone.classList.remove('shake'); void phone.offsetWidth; phone.classList.add('shake'); }, 850);
      const close = () => { ov.classList.remove('on'); ov.onclick = null; resolve(); };
      setTimeout(() => { ov.onclick = close; }, 1600);   // тап не раньше, чем родилась карта
      setTimeout(close, 3400);
    });
  }

  // открытие пака: коробка → руби тапом → щепки/шишки → карты → награды
  document.getElementById('packBtn').onclick = async () => {
    const ov = document.getElementById('packOv'), box = document.getElementById('packCards');
    const done = document.getElementById('packDone'), h = document.getElementById('packH');
    const crate = document.getElementById('crate'), crateBox = document.getElementById('crateBox');
    const rwBox = document.getElementById('packRewards');
    box.innerHTML = ''; rwBox.innerHTML = ''; done.style.display = 'none'; h.style.display = 'none';
    crate.style.display = 'flex'; crateBox.className = 'crate-box'; crateBox.src = 'assets/chest_closed.webp';
    ov.classList.add('on');

    // запрашиваем пак заранее (пока ребёнок рубит)
    const packReq = api('/api/pack/open', {});
    let hits = 0, done_open = false;
    const reveal = async () => {
      const r = await packReq;
      if (r.error) { h.style.display = 'block'; h.textContent = r.error; setTimeout(() => ov.classList.remove('on'), 1500); return; }
      crate.style.display = 'none';
      // показываем от простых к редким; топовые (5/6) НЕ спойлерим в сетке — они придут walkout'ом
      const sorted = r.cards.slice().sort((a, b) => a.grade - b.grade);
      const addToGrid = (c) => {
        const col = (DATA.rarities.find((x) => x.grade === c.grade) || {}).color || '#9aa4b2';
        const el = document.createElement('div'); el.className = 'pcard'; el.style.setProperty('--rc', col);
        el.innerHTML = `<img src="${thumb(c.code, c.grade)}">${c.is_new ? '<div class="new">NEW</div>' : ''}`;
        box.appendChild(el); requestAnimationFrame(() => el.classList.add('show'));
      };
      const simple = sorted.filter((c) => c.grade < 5);
      const tops = sorted.filter((c) => c.grade >= 5);   // легендарка → золото, самое крутое последним
      // 1) простые карты по очереди (нарастание)
      simple.forEach((c, i) => setTimeout(() => addToGrid(c), 200 + i * 320));
      const afterSimple = 200 + simple.length * 320 + 300;
      setTimeout(async () => {
        // 2) топовые — драматичный walkout по одному, потом встают в сетку
        for (const c of tops) { await jackpotWalkout(c); addToGrid(c); }
        h.style.display = 'block';
        // альбом-награды, если пришли
        (r.rewards || []).forEach((rw) => {
          const t = rw.kind === 'being' ? `✨ Собрано существо «${rw.name}» +${rw.reward}🌰`
                  : rw.kind === 'season' ? `🌲 Сезон «${rw.name}» собран целиком! +${rw.reward}🌰`
                  : rw.kind === 'category' ? `🏆 Альбом «${rw.name}» собран! +${rw.reward}🌰`
                  : `👑 Вся коллекция! ${rw.name} +${rw.reward}🌰`;
          const el = document.createElement('div'); el.className = 'rw'; el.textContent = t; rwBox.appendChild(el);
        });
        done.style.display = 'block';
      }, afterSimple);
      const bal = document.getElementById('topBal'); if (bal) bal.textContent = r.balance;
    };
    crateBox.onclick = () => {
      if (done_open) return;
      hits++;
      crateBox.classList.remove('hit'); void crateBox.offsetWidth; crateBox.classList.add('hit');
      burstChips(6);
      if (hits >= 3) {   // 3 удара — сундук распахивается
        done_open = true;
        crateBox.src = 'assets/chest_open.webp';   // раскрытый сундук со взрывом света
        crateBox.classList.add('crack'); burstChips(20);
        setTimeout(reveal, 560);
      }
    };
    done.onclick = () => { ov.classList.remove('on'); reload(); };
  };

  // вкладки
  const tabA = document.getElementById('tabAlbum'), tabM = document.getElementById('tabMarket');
  const viewA = document.getElementById('albumView'), viewM = document.getElementById('marketView');
  tabA.onclick = () => { tabA.classList.add('on'); tabM.classList.remove('on'); viewA.style.display = ''; viewM.style.display = 'none'; };
  tabM.onclick = () => { tabM.classList.add('on'); tabA.classList.remove('on'); viewM.style.display = ''; viewA.style.display = 'none'; loadMarket(); };

  // лоты и заявки круга — в кэш, чтобы деталь карты сразу знала, где её купить
  async function fetchMarket() {
    const [lots, wants, aucs] = await Promise.all([api('/api/market'), api('/api/wants'), api('/api/card-auctions')]);
    LOTS = Array.isArray(lots) ? lots : [];
    WANTS = Array.isArray(wants) ? wants : [];
    AUCS = Array.isArray(aucs) ? aucs : [];
  }
  async function loadMarket() { await fetchMarket(); renderMarket(); }

  // покупка лота: подтверждение с «обычной ценой» → покупка → плашка отмены на 5 минут
  async function buyLot(l) {
    const deal = l.price <= l.nominal * 0.7 ? 'выгодно 👍' : l.price >= l.nominal * 1.5 ? 'дороговато' : 'обычная цена';
    const past = l.avg_price ? ` В вашем лесу такие уходили в среднем за ${l.avg_price} 🌰.` : '';
    if (!await ask(`Купить «${l.name}»?`,
      `Цена ${l.price} 🌰. Обычная цена этой карты — около ${l.nominal} 🌰 (${deal}).${past}`, 'Купить')) return false;
    const r = await api('/api/market/buy', { id: l.id });
    if (r.error) { note(r.error); return false; }
    if (r.balance != null) { const b = document.getElementById('topBal'); if (b) b.textContent = r.balance; }
    showRewards(r.rewards);
    showUndo(r.listing, l.name);
    return true;
  }

  function renderMarket() {
    const view = document.getElementById('marketView');
    view.innerHTML = '';
    if (!MARKET) {
      view.innerHTML = `<div class="empty2">Ведущий пока закрыл рынок.<br><br>
        Паки, альбом, слияния, обменная полка и подарки друзьям работают как обычно.</div>`;
      return;
    }
    const col = (g) => (DATA.rarities.find((x) => x.grade === g) || {}).color || '#9aa4b2';

    // ── аукцион золотых карт ──
    if (AUCS.length) {
      const sec0 = document.createElement('div'); sec0.className = 'msec'; sec0.textContent = '🔨 Торги';
      view.appendChild(sec0);
      for (const au of AUCS) {
        const el = document.createElement('div'); el.className = 'lot auc'; el.style.setProperty('--rc', col(au.grade));
        const left = () => {
          const ms = new Date(au.ends_at) - new Date();
          if (ms <= 0) return 'вот-вот закончится';
          const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3);
          return h > 0 ? `осталось ${h} ч ${m} мин` : `осталось ${m} мин`;
        };
        const state = au.current_bid == null ? `ставок нет · старт ${au.start_price} 🌰`
          : `${au.leading ? 'ты лидируешь' : 'лидер: ' + au.leader} · ${au.current_bid} 🌰`;
        el.innerHTML = `<img src="${thumb(au.code, au.grade)}" loading="lazy">
          <div class="li"><div class="lt">${au.name}</div><div class="ls">${au.mine ? 'твой лот' : 'от ' + au.seller} · ${state}</div>
            <div class="lh">${left()}</div></div>
          <button class="${au.mine || au.leading ? 'off' : 'buy'}" ${au.mine || au.leading ? 'disabled' : ''}>${au.mine ? 'твой' : au.leading ? 'лидер' : 'Ставка ' + au.next_bid}</button>`;
        el.querySelector('button').onclick = async () => {
          if (!await ask('Сделать ставку?', `${au.next_bid} 🌰 за «${au.name}». Шишки резервируются: если тебя перебьют, они сразу вернутся.`, 'Поставить')) return;
          const r = await api('/api/card-auction/bid', { id: au.id, amount: au.next_bid });
          if (r.error) { note(r.error); reload(); return; }
          if (r.balance != null) { const b = document.getElementById('topBal'); if (b) b.textContent = r.balance; }
          note('Ставка принята!'); reload();
        };
        view.appendChild(el);
      }
    }

    // ── лоты на продажу ──
    const sec1 = document.createElement('div'); sec1.className = 'msec'; sec1.textContent = '🏷 Продают';
    view.appendChild(sec1);
    if (!LOTS.length) {
      const e = document.createElement('div'); e.className = 'empty3';
      e.innerHTML = 'Пока никто ничего не продаёт.<br>Выставь свои дубли!';
      view.appendChild(e);
    }
    for (const l of LOTS) {
      const el = document.createElement('div'); el.className = 'lot'; el.style.setProperty('--rc', col(l.grade));
      // «обычно уходит за N» — детский урок про рыночную цену
      const past = l.avg_price ? `<div class="lh">обычно уходит за ${l.avg_price} 🌰${l.price > l.avg_price * 1.3 ? ' — сейчас дороже' : l.price < l.avg_price * 0.8 ? ' — сейчас дешевле' : ''}</div>` : '';
      el.innerHTML = `<img src="${thumb(l.code, l.grade)}" loading="lazy">
        <div class="li"><div class="lt">${l.name}</div><div class="ls">${l.mine ? 'твой лот' : 'от ' + l.seller} · ${l.price} 🌰</div>${past}</div>
        <button class="${l.mine ? 'cancel' : 'buy'}">${l.mine ? 'Снять' : 'Купить'}</button>`;
      el.querySelector('button').onclick = async () => {
        if (l.mine) {
          const r = await api('/api/market/cancel', { id: l.id });
          if (r.error) note(r.error); else reload();
          return;
        }
        if (await buyLot(l)) reload();
      };
      view.appendChild(el);
    }

    // ── заявки: кто какую карту ищет ──
    const sec2 = document.createElement('div'); sec2.className = 'msec'; sec2.textContent = '🙋 Ищут';
    view.appendChild(sec2);
    if (!WANTS.length) {
      const e = document.createElement('div'); e.className = 'empty3';
      e.innerHTML = 'Заявок пока нет.<br>Тапни пустую ячейку в альбоме и оставь свою!';
      view.appendChild(e);
    }
    for (const w of WANTS) {
      const el = document.createElement('div'); el.className = 'lot want'; el.style.setProperty('--rc', col(w.grade));
      const canFill = !w.mine && w.i_have > 0 && w.funded;
      const state = w.mine ? 'твоя заявка'
        : !w.funded ? `${w.buyer} копит шишки`
        : w.i_have > 0 ? `у тебя есть ${w.i_have} шт — можно продать`
        : `ищет ${w.buyer}`;
      el.innerHTML = `<img src="${thumb(w.code, w.grade)}" loading="lazy">
        <div class="li"><div class="lt">${w.name}</div><div class="ls">${state} · ${w.price} 🌰</div></div>
        <button class="${w.mine ? 'cancel' : canFill ? 'buy' : 'off'}" ${canFill || w.mine ? '' : 'disabled'}>${w.mine ? 'Снять' : 'Продать'}</button>`;
      el.querySelector('button').onclick = async () => {
        if (w.mine) {
          const r = await api('/api/want/cancel', { id: w.id });
          if (r.error) note(r.error); else reload();
          return;
        }
        // предупреждаем, если это последняя такая карта — не сломать свою полку в альбоме
        const last = w.i_have === 1 ? ' Это твоя последняя такая карта — ячейка в альбоме опустеет.' : '';
        if (!await ask('Продать по заявке?', `«${w.name}» уйдёт игроку ${w.buyer} за ${w.price} 🌰.${last}`, 'Продать')) return;
        const r = await api('/api/want/fill', { id: w.id });
        if (r.error) { note(r.error); reload(); return; }
        if (r.balance != null) { const b = document.getElementById('topBal'); if (b) b.textContent = r.balance; }
        note(`Продано за ${r.earned} 🌰!`);
        reload();
      };
      view.appendChild(el);
    }
  }

  // плашка отмены сделки на 5 минут после покупки
  function showUndo(listingId, name) {
    if (!listingId) return;
    const old = document.getElementById('undoBar'); if (old) old.remove();
    const bar = document.createElement('div'); bar.id = 'undoBar';
    bar.style.cssText = 'position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:50;background:#fffaf0;border:2px solid #d9c39a;border-radius:14px;padding:10px 14px;box-shadow:0 6px 16px rgba(0,0,0,.3);display:flex;align-items:center;gap:10px;max-width:88%';
    bar.innerHTML = `<span style="font-weight:800;color:#5b4636;font-size:13px">Куплено: ${esc(name)}</span>
      <button style="background:#e0864b;border:none;color:#fff;font-weight:900;border-radius:10px;padding:7px 12px;font-size:13px;cursor:pointer">Отменить <span id="undoT">5:00</span></button>`;
    document.querySelector('.phone').appendChild(bar);
    let left = 300;
    const tick = setInterval(() => {
      left--; const t = document.getElementById('undoT');
      if (t) t.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) { clearInterval(tick); bar.remove(); }
    }, 1000);
    bar.querySelector('button').onclick = async () => {
      const r = await api('/api/market/undo', { id: listingId });
      clearInterval(tick); bar.remove();
      if (r.error) note(r.error);
      else { note('Сделка отменена, шишки возвращены'); const s = await api('/api/state'); const b = document.getElementById('topBal'); if (b && s.balance != null) b.textContent = s.balance; reload(); }
    };
  }

  // ── Первый вход: три коротких экрана вместо «разбирайся сам» ──
  const INTRO = [
    { emo: '🌲', title: 'Что это за раздел',
      text: 'Лесная коллекция — карточки лесных жителей. Открываешь пак за 20 шишек и получаешь семь карт: кто-то попадётся часто, а кто-то очень редко. Шишки на паки зарабатываются заданиями, как и всё остальное в лесу.' },
    { emo: '🗂', title: 'Это твой альбом',
      text: 'У каждого лесного жителя шесть обликов — от уличного сорванца до духа леса. Собери все шесть, и он появится в альбоме целиком.' },
    { emo: '🔥', title: 'Дубли — не мусор',
      text: 'Три одинаковые карты сливаются в одну рангом выше. Лишние можно обменять на обменной полке или подарить другу.' },
    { emo: '🙋', title: 'Не хватает карты?',
      text: 'Тапни пустую ячейку — увидишь, продаёт ли её кто-то в лесу, и сможешь оставить заявку. Друзья её увидят.' },
    { emo: '🤝', title: 'Рынок и подарки',
      text: 'Свои карты можно продать друзьям или купить у них — цена подсказывается, чтобы не продешевить. Передумал? Покупку можно отменить в течение пяти минут. А ещё картой можно просто поделиться — подарить другу.' },
    { emo: '🌱', title: 'Сезоны и честный шанс',
      text: 'Каждый десятый пак обязательно принесёт карту, которой у тебя ещё нет, а каждый пятидесятый — редкую и выше. Собирай всех!' },
  ];
  // force=true — памятку открыли вручную кнопкой «Памятка», а не первым входом
  async function showIntro(force) {
    if (!force && localStorage.getItem('cardsIntro')) return;
    const ov = document.getElementById('askOv'), sheet = document.getElementById('askSheet');
    for (let i = 0; i < INTRO.length; i++) {
      const s = INTRO[i];
      await new Promise((resolve) => {
        sheet.innerHTML = `<div class="introemo">${s.emo}</div><h3>${s.title}</h3>
          <div class="asktext">${s.text}</div>
          <div class="dots">${INTRO.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
          <div class="acts"><button class="a-ok">${i === INTRO.length - 1 ? 'Понятно!' : 'Дальше'}</button></div>`;
        sheet.querySelector('.a-ok').onclick = resolve;
        ov.onclick = null;
        ov.classList.add('on');
      });
    }
    ov.classList.remove('on');
    localStorage.setItem('cardsIntro', '1');
  }

  const helpBtn = document.getElementById('helpBtn');       // памятку можно перечитать в любой момент
  if (helpBtn) helpBtn.onclick = () => showIntro(true);
  reload().then(showIntro);
}
