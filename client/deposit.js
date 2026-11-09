// Дупло-сейф: депозит под процент.
// Зависит от глобальных api(), refreshBalance() из app.js.
window.runDeposit = function () {
  const api = window.api, refreshBalance = window.refreshBalance;
  let depDays = 3, depAmount = 10;

  async function loadSafes() {
    const safes = await api('/api/safes'); const c = document.getElementById('safeList'); c.innerHTML = '';
    if (!safes.length) { c.innerHTML = '<div style="text-align:center;padding:10px"><span class="on-art" style="color:#8a7358;font-weight:700;font-size:13px">Пока ничего не заморожено</span></div>'; return; }
    for (const s of safes) {
      const el = document.createElement('div'); el.className = 'card safe';
      el.innerHTML = `<div class="amt">${s.amount} <img src="assets/coin1.webp" style="width:20px;vertical-align:-3px"> +${s.rate}%</div>
        ${s.ready ? '<button class="btn btn-sm">Забрать</button>' : `<span class="st">осталось ${s.days_left} дн.</span>`}`;
      if (s.ready) el.querySelector('button').onclick = async () => {
        const r = await api('/api/safe/redeem', { id: s.id }); const n = document.getElementById('note'); n.style.display = 'block';
        if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
        else { n.textContent = 'Забрал ' + r.gained + ' шишек!'; n.style.color = '#5f8e37'; loadSafes(); refreshBalance(); }
      };
      c.appendChild(el);
    }
  }

  loadSafes();
  document.querySelectorAll('.term').forEach((t) => t.onclick = () => { document.querySelectorAll('.term').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); depDays = +t.dataset.days; });
  document.querySelectorAll('.sum .s').forEach((t) => t.onclick = () => { document.querySelectorAll('.sum .s').forEach((x) => x.classList.remove('sel')); t.classList.add('sel'); depAmount = +t.dataset.a; });
  document.getElementById('freeze').onclick = async () => {
    const r = await api('/api/safe/open', { amount: depAmount, days: depDays }); const n = document.getElementById('note'); n.style.display = 'block';
    if (r.error) { n.textContent = r.error; n.style.color = '#b3452e'; }
    else { n.textContent = `Заморожено ${depAmount} на ${depDays} дн.`; n.style.color = '#5f8e37'; loadSafes(); refreshBalance(); }
  };
};
