// Нарративный квест от Лесного Духа.
window.runQuest = function () {
  const api = window.api, refreshBalance = window.refreshBalance;
  function qnote(t) { const n = document.getElementById('note'); if (n) { n.style.display = 'block'; n.textContent = t; n.style.color = '#b3452e'; } }
  function renderQuest(q) {
    const btn = document.getElementById('qact'), pr = document.getElementById('qprog');
    if (q.done || q.status === 'completed') { document.getElementById('story').textContent = 'Квест пройден! Награда получена всей семьёй.';
      document.getElementById('stepTag').textContent = 'Завершено'; btn.style.display = 'none'; pr.style.display = 'none'; return; }
    const st = q.step; document.getElementById('story').textContent = st.text;
    document.getElementById('stepTag').textContent = 'Шаг ' + st.ord;
    const stepDone = (st.kind === 'collect' || st.kind === 'task') && st.progress >= st.goal;
    if (st.kind === 'collect' || st.kind === 'task') { pr.style.display = 'block';
      document.getElementById('qfill').style.width = Math.min(100, Math.round(st.progress / st.goal * 100)) + '%';
      document.getElementById('qtext').textContent = st.progress + ' / ' + st.goal; } else pr.style.display = 'none';
    if (st.kind === 'narrative' || stepDone) { btn.textContent = 'Дальше';
      btn.onclick = async () => { const r = await api('/api/quest/advance', {}); if (r.error) qnote(r.error); else renderQuest(r); }; }
    else if (st.kind === 'collect') { btn.textContent = 'Вложить 5 в фонд';
      btn.onclick = async () => { const r = await api('/api/quest/act', { amount: 5 }); if (r.error) qnote(r.error); else { renderQuest(r); refreshBalance(); } }; }
    else { btn.textContent = 'Обыскать поляну'; btn.onclick = async () => renderQuest(await api('/api/quest/act', {})); }
  }
  api('/api/quest').then(renderQuest);
};
