// Переводы / подарки / оплата по QR.
// Зависит от window.api, window.esc, window.refreshBalance.
window.runTransfers = function () {
  const api = window.api;
  const esc = window.esc;
  const refreshBalance = window.refreshBalance;

// ── Переводы ──
let selFriend = null;
async function loadFriends() {
  const fr = await api('/api/friends');
  const c = document.getElementById('friendList'); c.innerHTML = '';
  fr.forEach((f, i) => {
    const el = document.createElement('div'); el.className = 'friend' + (i === 0 ? ' sel' : '');
    if (i === 0) selFriend = f.id;
    el.innerHTML = `<img src="assets/${f.avatar}"><span>${esc(f.name)}</span>`;
    el.onclick = () => { selFriend = f.id; [...c.children].forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); };
    c.appendChild(el);
  });
}
let giftAmount = 25, qrRecipient = null, qrFixedAmt = null;
// пришли по QR продавца (?pay=КОД) — режим ОПЛАТЫ (pay_cones, не подарок)
const payCode = new URLSearchParams(location.search).get('pay');
if (payCode && payCode.toUpperCase() !== (localStorage.getItem('childCode') || '')) {
  api('/api/link', { code: payCode }).then((r) => {
    if (r.error) { loadFriends(); return; }
    qrRecipient = payCode.toUpperCase();
    document.querySelector('.title').textContent = 'Оплата';
    document.getElementById('friendList').innerHTML =
      `<div class="friend sel" style="flex:none;width:100%;padding:12px"><span style="font-size:15px">Платишь: ${esc(r.name)}</span></div>`;
    const cards = document.querySelector('.cards'); if (cards) cards.style.display = 'none';   // открытки — только для подарков
    const anonRow = document.getElementById('anonRow'); if (anonRow) anonRow.style.display = 'none';   // тайно — только для подарков
    const fixedAmt = parseInt(new URLSearchParams(location.search).get('amt'), 10);
    const paintPayBtn = (label) => {
      const b = document.getElementById('giftSendBtn'); if (!b) return;
      b.className = 'btn btn-lg'; b.innerHTML = ''; b.textContent = label;
      b.style.cssText = 'display:block;margin:14px auto 0;max-width:280px;width:100%';
    };
    const amtBig = document.querySelector('.amt-big'); if (amtBig) amtBig.style.display = 'none';
    if (fixedAmt > 1) {   // продавец назначил цену — это счёт, сумма зафиксирована
      qrFixedAmt = fixedAmt;
      document.querySelector('.apick').style.display = 'none';
      document.querySelector('.apick').insertAdjacentHTML('afterend',
        `<div class="on-art" style="text-align:center;font-weight:900;color:var(--ink);font-size:22px;margin:10px auto 0;display:block;width:fit-content">К оплате: ${fixedAmt} шишек</div>
         <div class="on-art" style="color:#8a7358;font-weight:700;font-size:12px;margin:6px auto 0;display:block;width:fit-content">Комиссия Банка — 1 шишка со сделки</div>`);
      paintPayBtn('Оплатить ' + fixedAmt);
      return;
    }
    document.querySelector('.apick').insertAdjacentHTML('afterend',
      `<div style="text-align:center;margin-top:8px"><input id="payAmt" type="number" min="2" placeholder="или своя сумма" inputmode="numeric"
         style="width:70%;background:#fffaf0;border:3px solid #d9c39a;border-radius:14px;padding:10px;font-size:18px;font-weight:900;color:var(--ink);text-align:center;outline:none">
       <div class="on-art" style="color:#8a7358;font-weight:700;font-size:12px;margin-top:6px">Комиссия Банка — 1 шишка со сделки</div></div>`);
    paintPayBtn('Оплатить');
  });
} else loadFriends();
const paintAmt = () => {
  const n = document.getElementById('giftAmtN'); if (n) n.textContent = giftAmount;
};
document.querySelectorAll('.apick .ap').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.apick .ap').forEach((x) => x.classList.remove('sel')); a.classList.add('sel');
  giftAmount = +a.dataset.a; paintAmt();
});
const btn = document.getElementById('giftSendBtn') || document.querySelector('.btn-lg');
if (btn) btn.onclick = async () => {
  const custom = parseInt(document.getElementById('payAmt')?.value, 10);
  const isAnon = document.getElementById('anon')?.checked;
  const r = qrRecipient
    ? await api('/api/pay', { toCode: qrRecipient, amount: qrFixedAmt || (custom > 0 ? custom : giftAmount) })
    : isAnon
      ? await api('/api/surprise', { to: selFriend, amount: giftAmount })
      : await api('/api/transfer', { to: selFriend, amount: giftAmount });
  const n = document.getElementById('note'); if (!n) return;
  n.style.display = 'block';
  if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
  else { n.textContent = qrRecipient ? `Оплачено! ${r.to} получил шишки. Осталось ` + r.balance
    : isAnon ? `Тайный подарок отправлен! Друг не узнает кто — если не расследует. Осталось ` + r.balance
    : `Подарок ${giftAmount} отправлен! Осталось ` + r.balance; n.style.color = '#5f8e37'; refreshBalance(); }
};
};
