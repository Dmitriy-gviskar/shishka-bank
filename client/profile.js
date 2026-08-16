// Профиль / поляна дружбы.
// Зависит от window.api, window.esc, window.refreshBalance, window.clearSession, window.navigate.
window.runProfile = function () {
  const api = window.api;
  const esc = window.esc;
  const refreshBalance = window.refreshBalance;
  const clearSession = window.clearSession;
  const navigate = window.navigate || ((href) => { location.href = href; });

const su = document.getElementById('switchUser');   // сменить пользователя → экран кода
if (su) su.onclick = (e) => { e.preventDefault(); clearSession(); location.href = 'link.html'; };
const nar = document.querySelector('.profile-btn'); // «Сменить наряд» → экран нарядов
if (nar) nar.onclick = () => navigate('skins.html');
// с дома / реф-кнопки: поляна, но так чтобы плашки друзей не уезжали под док
if (location.hash === '#grove') {
  const g = document.getElementById('grove');
  if (g) setTimeout(() => {
    const friends = document.getElementById('refFriends');
    const target = friends || g;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}
api('/api/state').then((s) => {
  const h = document.querySelector('.hero img'); if (h && s.skin_on) h.src = 'assets/' + s.tree_asset;
  const fc = document.getElementById('freezeCount'); if (fc) fc.textContent = s.streak_freezes || 0;
});
const buyFz = document.getElementById('buyFreezeBtn');
if (buyFz) buyFz.onclick = async () => {
  if (!confirm('Купить дождик-защитник за 20 шишек?\nОн спасёт серию, если пропустишь один день.')) return;
  buyFz.disabled = true;
  const r = await api('/api/freeze/buy', {});
  buyFz.disabled = false;
  const n = document.getElementById('pnote');
  if (r.error) {
    if (n) { n.style.display = 'block'; n.textContent = r.error; n.style.color = '#b3452e'; }
    return;
  }
  const fc = document.getElementById('freezeCount'); if (fc) fc.textContent = r.streak_freezes;
  if (n) { n.style.display = 'block'; n.textContent = `Дождик куплен! Теперь 🌧×${r.streak_freezes}`; n.style.color = '#5f8e37'; }
  refreshBalance();
};
api('/api/profile').then((p) => {
  const title = p.tree_title || 'Саженец';
  const hn = document.getElementById('heroName');
  if (hn && p.name) hn.textContent = p.name;
  const ll = document.getElementById('levelLabel');
  if (ll) {
    const breed = p.tree_breed ? `${p.tree_breed} · ` : '';
    ll.textContent = `${breed}${title} · Уровень ${p.tree_level}`;
  }
  const story = document.getElementById('chStory');
  if (story && p.chronicle) story.textContent = p.chronicle;
  const prog = document.getElementById('treeProg') || document.querySelector('.progress i');
  if (prog) prog.style.width = Math.min(100, p.progress ?? 0) + '%';
  const cap = document.getElementById('treeProgCap');
  if (cap) {
    if (!p.next_level_at) cap.textContent = 'Максимум — могучее дерево!';
    else if (p.days_to_next <= 0) cap.textContent = `Уровень ${p.tree_level + 1} почти тут — забери подарок на главной`;
    else cap.textContent = `До ур. ${p.tree_level + 1}: ещё ${p.days_to_next} дн. лучшей серии (сейчас ${p.best_streak || 0})`;
  }
  const tip = document.getElementById('treeTip');
  if (tip) {
    tip.textContent = p.next_level_at
      ? `Как качать: каждый день заходи на главную и жми «Забрать» у подарка. Серия дней растит дерево (7→21→45→90 дн.). Сейчас серия ${p.streak || 0}, лучшая ${p.best_streak || 0}.`
      : `Ты на максимуме! Лучшая серия — ${p.best_streak || 0} дн. Паспорт ниже растёт от дел и подарков.`;
  }
  for (const [k, v] of Object.entries(p.reputation || {})) {
    const bar = document.querySelector(`[data-trait="${k}"]`);
    if (bar) bar.style.width = Math.min(100, Number(v) || 0) + '%';
  }
  const bc = document.querySelector('.badges'); if (bc) {   // бейджи из данных ребёнка, а не хардкод
    const arts = { guardian: 'badge1.webp', philanthropist: 'badge2.webp', saver: 'badge3.webp' };
    bc.innerHTML = p.badges.length ? p.badges.map((b) => `<div class="badge"><img src="assets/${arts[b.code] || 'badge1.webp'}"><span>${esc(b.title)}</span></div>`).join('')
      : '<div style="width:100%;text-align:center;padding:6px"><span class="on-art" style="color:#8a7358;font-weight:700;font-size:13px">Пока нет наград — выполняй задания!</span></div>';
  }
});
// Поляна дружбы: код / ссылка / QR / список приведённых
let refLink = '';
api('/api/referral').then((d) => {
  if (!d || d.error) return;
  const codeEl = document.getElementById('refCode'); if (codeEl) codeEl.textContent = d.code;
  const c = document.getElementById('refCount'); if (c) c.textContent = d.count;
  const deep = document.getElementById('refCountDeep');
  if (deep) deep.textContent = (d.countL2 || 0) + (d.countL3 || 0);
  const e = document.getElementById('refEarned'); if (e) e.textContent = d.earned;
  const rw = document.getElementById('refReward'); if (rw) rw.textContent = d.reward;
  const rw2 = document.getElementById('refRewardL2'); if (rw2) rw2.textContent = d.rewardL2 || 50;
  const rw3 = document.getElementById('refRewardL3'); if (rw3) rw3.textContent = d.rewardL3 || 25;
  // корень = лендинг для интернета; ref пробрасывается в link.html
  refLink = location.origin + '/?ref=' + encodeURIComponent(d.code);
  const box = document.getElementById('refFriends');
  if (box) {
    box.innerHTML = d.friends.length
      ? d.friends.map((f) => `<div class="ref-row"><div class="nm">${esc(f.name)}</div>
          <div class="rw">+${f.reward}<img src="assets/coin1.webp" alt=""></div></div>`).join('')
      : '<div class="ref-empty">Пока никого — позови первого!</div>';
  }
  const cas = document.getElementById('refCascade');
  if (cas) {
    const list = d.cascade || [];
    cas.innerHTML = list.length
      ? list.map((f) => `<div class="ref-row"><div class="nm">${esc(f.name)}${f.via ? ` <span style="color:#a1876a;font-weight:700">через ${esc(f.via)}</span>` : ''} <span style="color:#a1876a;font-weight:700">· L${f.level}</span></div>
          <div class="rw">+${f.reward}<img src="assets/coin1.webp" alt=""></div></div>`).join('')
      : '<div class="ref-empty">Друг друга / 3-й круг — здесь +50 и +25</div>';
  }
});
const copyBtn = document.getElementById('refCopyBtn');
if (copyBtn) copyBtn.onclick = async () => {
  if (!refLink) return;
  try {
    await navigator.clipboard.writeText(refLink);
    const n = document.getElementById('pnote');
    if (n) {
      n.style.display = 'block'; n.style.color = '#5f8e37';
      n.textContent = 'Ссылка скопирована! Друг откроет сайт в браузере — ставить приложение не надо.';
    }
  } catch {
    prompt('Скопируй ссылку:', refLink);
  }
};
const qrBtn = document.getElementById('refQrBtn');
const qrBox = document.getElementById('refQrBox');
if (qrBtn && qrBox) qrBtn.onclick = () => {
  if (!refLink || typeof qrcode !== 'function') return;
  const qr = qrcode(0, 'M'); qr.addData(refLink); qr.make();
  const svg = qr.createSvgTag({ cellSize: 5, margin: 2 });
  document.getElementById('refQrSvg').innerHTML = svg.replace('<svg ', '<svg style="width:200px;height:200px" ');
  qrBox.classList.add('on');
};
const qrClose = document.getElementById('refQrClose');
if (qrClose && qrBox) qrClose.onclick = () => qrBox.classList.remove('on');
};
