// Лесной гороскоп: ежедневное предсказание.
window.runHoroscope = function () {
  const api = window.api, refreshBalance = window.refreshBalance;
  api('/api/horoscope').then((h) => {
    document.getElementById('pred').textContent = h.text;
    if (h.bonus > 0) { document.getElementById('bonus').style.display = 'block';
      document.getElementById('bonusN').textContent = '+' + h.bonus + ' счастливых шишек'; refreshBalance(); }
  });
};
