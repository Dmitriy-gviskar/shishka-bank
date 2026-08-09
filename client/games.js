// Мини-игры: умножение / угадайка / блиц / память / слово / лишнее / числа / сравнение / задачи.
// Зависит от window.api, window.esc, window.cardUrl из app.js.
window.runGames = function () {
  const api = window.api;
  const esc = window.esc;
  const cardUrl = window.cardUrl;
  if (!api || !document.getElementById('gameOv')) return;

  // ── Мини-игры (умножение / угадайка / блиц / память / слово / лишнее) ──
  let currentGame = null;
let gameQuestions = [], gameIdx = 0, gameCorrect = 0;
let guessQuestions = [], guessIdx = 0, guessCorrect = 0;
let countQuestions = [], countIdx = 0, countScore = 0, countTimer = null, countLeft = 0, countDuration = 30;
let memoryTimer = null, memoryLeft = 0, memoryMatched = 0, memoryMoves = 0, memoryLock = false, memoryOpen = [];
let wordQuestions = [], wordIdx = 0, wordCorrect = 0, wordBuilt = '';
let oddRounds = [], oddIdx = 0, oddCorrect = 0;
let numberQuestions = [], numberIdx = 0, numberCorrect = 0;
let compareRounds = [], compareIdx = 0, compareCorrect = 0;
let storyQuestions = [], storyIdx = 0, storyCorrect = 0;

function setGameInputMode(mode) {
  const a = document.getElementById('gameA');
  const pad = document.getElementById('gamePad');
  if (!a) return;
  if (mode === 'text') {
    a.type = 'text';
    a.inputMode = 'text';
    a.removeAttribute('pattern');
    a.style.maxWidth = '220px';
    if (pad) pad.classList.remove('on');
  } else {
    a.type = 'text';
    a.inputMode = 'numeric';
    a.pattern = '[0-9]*';
    a.style.maxWidth = '160px';
    if (pad) pad.classList.add('on');
  }
}

function setGameProg(cur, total, label) {
  const p = document.getElementById('gameProg');
  const bar = document.getElementById('gameProgBar');
  if (p) p.textContent = label != null ? label : `${cur} / ${total}`;
  if (bar && total > 0) bar.style.width = `${Math.min(100, Math.round((cur / total) * 100))}%`;
}

function flashStage(ok) {
  const st = document.getElementById('gameStage');
  if (!st) return;
  st.classList.remove('ok', 'bad');
  void st.offsetWidth;
  st.classList.add(ok ? 'ok' : 'bad');
}

function showGamePlay(show) {
  const ans = document.getElementById('gameAnsRow');
  const btn = document.getElementById('gameBtn');
  const a = document.getElementById('gameA');
  const pad = document.getElementById('gamePad');
  const done = document.getElementById('gameDone');
  if (ans) ans.style.display = show ? '' : 'none';
  if (btn) btn.style.display = show ? '' : 'none';
  if (a) a.style.display = show ? '' : 'none';
  if (!show && pad) pad.classList.remove('on');
  if (done) done.classList.remove('on');
}

function showGameDone(text, cup) {
  showGamePlay(false);
  const done = document.getElementById('gameDone');
  const res = document.getElementById('gameResult');
  const c = document.getElementById('gameCup');
  if (c) c.textContent = cup || '🏆';
  if (res) res.textContent = text;
  if (done) done.classList.add('on');
}

function ensureGamePad() {
  const pad = document.getElementById('gamePad');
  if (!pad || pad.dataset.ready) return;
  pad.dataset.ready = '1';
  [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['⌫', 'bk'], ['0'], ['✓', 'go']].forEach(([k, cls]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k;
    if (cls) b.className = cls;
    b.onclick = () => {
      const a = document.getElementById('gameA');
      if (!a || a.style.display === 'none') return;
      if (k === '⌫') a.value = a.value.slice(0, -1);
      else if (k === '✓') document.getElementById('gameBtn')?.click();
      else if (a.value.length < 6) a.value += k;
    };
    pad.appendChild(b);
  });
}

function closeGameOv() {
  clearInterval(countTimer);
  countTimer = null;
  clearInterval(memoryTimer);
  memoryTimer = null;
  memoryOpen = [];
  memoryLock = false;
  const q = document.getElementById('gameQ');
  if (q) { q.innerHTML = ''; q.textContent = ''; }
  const lv = document.getElementById('gameLevels');
  if (lv) { lv.style.display = 'none'; lv.innerHTML = ''; }
  const ov = document.getElementById('gameOv');
  if (ov) ov.classList.remove('on');
}

function resetGameSheet(title) {
  clearInterval(countTimer);
  countTimer = null;
  clearInterval(memoryTimer);
  memoryTimer = null;
  ensureGamePad();
  document.getElementById('gameTitle').textContent = title;
  document.getElementById('gameQ').textContent = '…';
  document.getElementById('gameBtn').textContent = 'Ответить';
  document.getElementById('gameA').value = '';
  document.getElementById('gameA').placeholder = 'Ответ';
  document.getElementById('gameMsg').textContent = '';
  document.getElementById('gameMsg').style.color = '';
  const lv = document.getElementById('gameLevels');
  if (lv) { lv.style.display = 'none'; lv.innerHTML = ''; }
  showGamePlay(false);
  setGameProg(0, 10, '—');
  document.getElementById('gameOv').classList.add('on');
}

async function claimGameReward(score) {
  if (!currentGame) return closeGameOv();
  if (!score) return closeGameOv();
  const r = await api('/api/game/finish', { game: currentGame, score });
  if (r.ok && r.balance != null) {
    const b = document.getElementById('topBal');
    if (b) b.textContent = r.balance;
  }
  if (r.already) {
    showGameDone('Сегодня награда за эту игру уже получена', '😴');
    setTimeout(closeGameOv, 1600);
    return;
  }
  if (r.reward) showGameDone(`+${r.reward} шишек!`, '🌰');
  setTimeout(closeGameOv, r.reward ? 900 : 200);
}

async function startMultiplyGame() {
  currentGame = 'multiply';
  resetGameSheet('Таблица умножения');
  const lv = document.getElementById('gameLevels');
  document.getElementById('gameQ').textContent = 'Выбери уровень';
  setGameProg(0, 10, 'уровень');
  lv.style.display = '';
  [
    [1, 'Лёгкий', '×2, 3, 5 · награда 3 🌰'],
    [2, 'Средний', '×4, 6, 7, 8 · награда 5 🌰'],
    [3, 'Сложный', 'вся таблица · награда 8 🌰'],
  ].forEach(([n, name, sub]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${name}<small>${sub}</small>`;
    b.onclick = () => beginMultiply(n);
    lv.appendChild(b);
  });
}

async function beginMultiply(level) {
  const lv = document.getElementById('gameLevels');
  if (lv) { lv.style.display = 'none'; lv.innerHTML = ''; }
  setGameInputMode('number');
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/start', { level });
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  gameQuestions = r.questions; gameIdx = 0; gameCorrect = 0;
  document.getElementById('gameTitle').textContent = `Умножение · ур. ${r.level}`;
  document.getElementById('gameBtn').textContent = 'Ответить';
  showGamePlay(true);
  setGameInputMode('number');
  showQuestion();
}

function showQuestion() {
  const q = gameQuestions[gameIdx];
  document.getElementById('gameQ').textContent = `${q.a} × ${q.b} = ?`;
  setGameProg(gameIdx, 10);
  document.getElementById('gameA').value = '';
  document.getElementById('gameMsg').textContent = '';
  document.getElementById('gameA').focus();
}

async function startGuessGame() {
  currentGame = 'guess';
  resetGameSheet('Лесная угадайка');
  const r = await api('/api/game/guess/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  guessQuestions = r.questions; guessIdx = 0; guessCorrect = 0;
  // выбор из вариантов — поле ввода и клавиатура не нужны
  showGamePlay(false);
  document.getElementById('gameDone').classList.remove('on');
  showGuessQ();
}

function showGuessQ() {
  const q = guessQuestions[guessIdx];
  document.getElementById('gameQ').innerHTML =
    `<img src="${cardUrl(q.code, 1, 'md')}" alt="" style="filter:blur(5px) brightness(.92) saturate(.95)">`;
  document.getElementById('gameMsg').innerHTML =
    (q.hints || []).map((h) => `<div class="hint">🌿 ${esc(h)}</div>`).join('');
  setGameProg(guessIdx, 5);
  const box = document.getElementById('gameLevels');
  box.style.display = '';
  box.innerHTML = '';
  const opts = Array.isArray(q.options) && q.options.length
    ? q.options
    : [q.name];
  opts.forEach((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt;
    b.onclick = async () => {
      [...box.querySelectorAll('button')].forEach((x) => { x.disabled = true; });
      document.getElementById('gameA').value = opt;
      document.getElementById('gameBtn').click();
    };
    box.appendChild(b);
  });
}

async function startCountGame() {
  currentGame = 'count';
  resetGameSheet('Блиц-счёт');
  setGameInputMode('number');
  const r = await api('/api/game/count/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  countQuestions = r.questions; countIdx = 0; countScore = 0;
  countLeft = r.duration; countDuration = r.duration || 30;
  document.getElementById('gameBtn').textContent = 'Ответить';
  showGamePlay(true);
  setGameInputMode('number');
  document.getElementById('gameQ').textContent =
    `${countQuestions[0].a} ${countQuestions[0].op} ${countQuestions[0].b} = ?`;
  setGameProg(countDuration - countLeft, countDuration, `⏱ ${countLeft}с · ${countScore}`);
  document.getElementById('gameA').focus();
  clearInterval(countTimer);
  countTimer = setInterval(() => {
    countLeft--;
    setGameProg(countDuration - Math.max(countLeft, 0), countDuration, `⏱ ${countLeft}с · ${countScore}`);
    if (countLeft <= 0) endCountGame('time');
  }, 1000);
}

function endCountGame(reason) {
  clearInterval(countTimer);
  countTimer = null;
  setGameProg(countDuration - Math.max(countLeft, 0), countDuration, `⏱ ${Math.max(countLeft, 0)}с · ${countScore}`);
  const label = reason === 'wrong' ? 'Ошибка!' : reason === 'done' ? 'Готово!' : 'Время вышло!';
  const cup = reason === 'wrong' ? '💥' : countScore >= 10 ? '🔥' : '⏱️';
  showGameDone(`${label} Правильно: ${countScore}`, cup);
}

if (document.getElementById('gameBtn')) document.getElementById('gameBtn').onclick = async () => {
  if (currentGame === 'count') {
    const val = parseInt(document.getElementById('gameA').value, 10);
    if (isNaN(val)) return;
    const q = countQuestions[countIdx];
    if (val === q.answer) {
      countScore++;
      flashStage(true);
      document.getElementById('gameMsg').textContent = 'Верно!';
      document.getElementById('gameMsg').style.color = '#5f8e37';
      countIdx++;
      if (countIdx >= countQuestions.length || countLeft <= 0) {
        endCountGame(countLeft <= 0 ? 'time' : 'done');
        return;
      }
      document.getElementById('gameQ').textContent =
        `${countQuestions[countIdx].a} ${countQuestions[countIdx].op} ${countQuestions[countIdx].b} = ?`;
      document.getElementById('gameA').value = '';
      document.getElementById('gameA').focus();
    } else {
      flashStage(false);
      document.getElementById('gameMsg').textContent = `${q.a} ${q.op} ${q.b} = ${q.answer}`;
      document.getElementById('gameMsg').style.color = '#b3452e';
      endCountGame('wrong');
    }
    return;
  }

  if (currentGame === 'guess') {
    const val = document.getElementById('gameA').value.trim();
    if (!val) return;
    const q = guessQuestions[guessIdx];
    const box = document.getElementById('gameLevels');
    const r = await api('/api/game/guess/answer', { answer: val, name: q.name });
    document.getElementById('gameQ').innerHTML =
      `<img src="${cardUrl(q.code, 1, 'md')}" alt="">`;
    flashStage(!!r.correct);
    if (box) {
      [...box.querySelectorAll('button')].forEach((btn) => {
        if (btn.textContent === q.name) btn.style.outline = '3px solid #6fad45';
        else if (btn.textContent === val && !r.correct) btn.style.outline = '3px solid #c45c4a';
      });
    }
    if (r.correct) {
      guessCorrect++;
      document.getElementById('gameMsg').innerHTML =
        `<span style="color:#5f8e37">Верно! Это ${esc(q.name)}!</span>`;
    } else {
      document.getElementById('gameMsg').innerHTML =
        `<span style="color:#b3452e">Нет, это ${esc(q.name)}</span>`;
    }
    guessIdx++;
    if (guessIdx >= 5) {
      setGameProg(5, 5);
      if (box) { box.style.display = 'none'; box.innerHTML = ''; }
      showGameDone(`Угадано: ${guessCorrect} из 5`, guessCorrect >= 4 ? '🦉' : '🌿');
    } else {
      setTimeout(showGuessQ, 1100);
    }
    return;
  }

  if (currentGame === 'multiply') {
    const val = parseInt(document.getElementById('gameA').value, 10);
    if (isNaN(val)) return;
    const q = gameQuestions[gameIdx];
    const r = await api('/api/game/answer', { answer: val, expected: q.answer });
    flashStage(!!r.correct);
    if (r.correct) {
      gameCorrect++;
      document.getElementById('gameMsg').textContent = 'Верно!';
      document.getElementById('gameMsg').style.color = '#5f8e37';
    } else {
      document.getElementById('gameMsg').textContent = `Нет, ${q.a} × ${q.b} = ${q.answer}`;
      document.getElementById('gameMsg').style.color = '#b3452e';
    }
    gameIdx++;
    if (gameIdx >= 10) {
      setGameProg(10, 10);
      showGameDone(`Правильно: ${gameCorrect} из 10`, gameCorrect >= 8 ? '🏆' : '✨');
    } else {
      setTimeout(showQuestion, 700);
    }
  }
};

if (document.getElementById('gameA')) {
  document.getElementById('gameA').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('gameBtn').click();
  };
}

async function startMemoryGame() {
  currentGame = 'memory';
  resetGameSheet('Найди пару');
  showGamePlay(false);
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/memory/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  memoryMatched = 0; memoryMoves = 0; memoryOpen = []; memoryLock = false;
  memoryLeft = r.duration || 90;
  const tiles = shuffleArr(r.pairs.flatMap((p) => [
    { code: p.code, name: p.name, id: p.code + '_a' },
    { code: p.code, name: p.name, id: p.code + '_b' },
  ]));
  const q = document.getElementById('gameQ');
  q.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'mem-grid';
  tiles.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'mem-card';
    card.dataset.code = t.code;
    card.innerHTML = `<div class="back">🌰</div><div class="face"><img src="${cardUrl(t.code, 1, 'sm')}" alt=""></div>`;
    card.onclick = () => onMemoryFlip(card);
    grid.appendChild(card);
  });
  q.appendChild(grid);
  setGameProg(0, 6, `⏱ ${memoryLeft}с · 0/6`);
  document.getElementById('gameMsg').textContent = 'Открой две одинаковые карты';
  clearInterval(memoryTimer);
  memoryTimer = setInterval(() => {
    memoryLeft--;
    setGameProg(memoryMatched, 6, `⏱ ${Math.max(memoryLeft, 0)}с · ${memoryMatched}/6 · ходов ${memoryMoves}`);
    if (memoryLeft <= 0) {
      clearInterval(memoryTimer);
      memoryTimer = null;
      document.getElementById('gameMsg').textContent = 'Время вышло — можно доиграть, награда за все 6 пар';
      document.getElementById('gameMsg').style.color = '#8a6238';
    }
  }, 1000);
}

function onMemoryFlip(card) {
  if (memoryLock || card.classList.contains('open') || card.classList.contains('matched')) return;
  card.classList.add('open');
  memoryOpen.push(card);
  if (memoryOpen.length < 2) return;
  memoryMoves++;
  memoryLock = true;
  const [a, b] = memoryOpen;
  if (a.dataset.code === b.dataset.code) {
    a.classList.add('matched');
    b.classList.add('matched');
    memoryMatched++;
    flashStage(true);
    memoryOpen = [];
    memoryLock = false;
    setGameProg(memoryMatched, 6, `⏱ ${Math.max(memoryLeft, 0)}с · ${memoryMatched}/6 · ходов ${memoryMoves}`);
    if (memoryMatched >= 6) {
      clearInterval(memoryTimer);
      memoryTimer = null;
      showGameDone(`Все пары! Ходов: ${memoryMoves}`, '🧠');
    }
  } else {
    flashStage(false);
    setTimeout(() => {
      a.classList.remove('open');
      b.classList.remove('open');
      memoryOpen = [];
      memoryLock = false;
    }, 600);
  }
}

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startWordGame() {
  currentGame = 'word';
  resetGameSheet('Собери слово');
  showGamePlay(false);
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/word/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  wordQuestions = r.questions; wordIdx = 0; wordCorrect = 0;
  showWordQ();
}

function showWordQ() {
  const q = wordQuestions[wordIdx];
  wordBuilt = '';
  const used = [];
  const box = document.getElementById('gameQ');
  const cat = q.category === 'zver' ? 'зверь или птица'
    : q.category === 'rastenie' ? 'растение' : 'насекомое';
  box.innerHTML = `<img src="${cardUrl(q.code, 1, 'md')}" alt="" style="width:120px;height:160px;object-fit:cover;border-radius:14px;border:3px solid #fff;box-shadow:0 0 0 3px #c9a86a">
    <div class="word-built" id="wordBuilt"></div>
    <div class="word-letters" id="wordLetters"></div>
    <div class="word-actions">
      <button type="button" id="wordClear">Стереть</button>
      <button type="button" class="go" id="wordCheck">Проверить</button>
    </div>`;
  const lettersEl = document.getElementById('wordLetters');
  const builtEl = document.getElementById('wordBuilt');
  const paintBuilt = () => {
    builtEl.innerHTML = wordBuilt
      ? wordBuilt.split('').map((ch) => `<span>${esc(ch)}</span>`).join('')
      : '<span style="opacity:.35">?</span>';
  };
  paintBuilt();
  q.letters.forEach((ch, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ch;
    b.onclick = () => {
      if (used[i] || wordBuilt.length >= q.letters.length) return;
      used[i] = true;
      b.disabled = true;
      wordBuilt += ch;
      paintBuilt();
    };
    lettersEl.appendChild(b);
  });
  document.getElementById('wordClear').onclick = () => {
    wordBuilt = '';
    used.fill(false);
    [...lettersEl.children].forEach((b) => { b.disabled = false; });
    paintBuilt();
    document.getElementById('gameMsg').textContent = '';
  };
  document.getElementById('wordCheck').onclick = () => {
    const target = (q.name || '').replace(/[^А-Яа-яЁёA-Za-z]/g, '').toUpperCase();
    const got = wordBuilt.toUpperCase();
    if (!got) return;
    if (got === target) {
      wordCorrect++;
      flashStage(true);
      document.getElementById('gameMsg').textContent = `Верно! ${q.name}`;
      document.getElementById('gameMsg').style.color = '#5f8e37';
    } else {
      flashStage(false);
      document.getElementById('gameMsg').textContent = `Почти! Это «${q.name}». Начинается на «${q.name[0]}»`;
      document.getElementById('gameMsg').style.color = '#b3452e';
    }
    wordIdx++;
    setGameProg(wordIdx, 5);
    if (wordIdx >= 5) {
      setTimeout(() => showGameDone(`Собрано: ${wordCorrect} из 5`, wordCorrect >= 4 ? '📖' : '✏️'), 700);
    } else {
      setTimeout(showWordQ, 900);
    }
  };
  setGameProg(wordIdx, 5);
  document.getElementById('gameMsg').textContent = `Это ${cat}. Собери имя из букв`;
  document.getElementById('gameMsg').style.color = '#5a3a18';
}

async function startOddGame() {
  currentGame = 'odd';
  resetGameSheet('Что лишнее?');
  showGamePlay(false);
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/odd/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  oddRounds = r.rounds; oddIdx = 0; oddCorrect = 0;
  showOddQ();
}

function showOddQ() {
  const round = oddRounds[oddIdx];
  const box = document.getElementById('gameQ');
  box.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'odd-grid';
  let locked = false;
  const catRu = (c) => (c === 'zver' ? 'звери/птицы' : c === 'rastenie' ? 'растения' : 'насекомые');
  round.items.forEach((it) => {
    const card = document.createElement('div');
    card.className = 'odd-card';
    card.dataset.code = it.code;
    card.innerHTML = `<img src="${cardUrl(it.code, 1, 'sm')}" alt=""><div class="nm">${esc(it.name)}</div>`;
    card.onclick = () => {
      if (locked) return;
      locked = true;
      [...grid.querySelectorAll('.odd-card')].forEach((c) => c.classList.add('show-name'));
      const oddItem = round.items.find((x) => x.code === round.oddCode);
      const maj = round.items.find((x) => x.code !== round.oddCode);
      if (it.code === round.oddCode) {
        oddCorrect++;
        card.classList.add('pick-ok');
        flashStage(true);
        document.getElementById('gameMsg').textContent =
          `Верно! Лишний: ${oddItem.name} — ${catRu(oddItem.category)}, остальные — ${catRu(maj.category)}`;
        document.getElementById('gameMsg').style.color = '#5f8e37';
      } else {
        card.classList.add('pick-bad');
        [...grid.children].forEach((c) => {
          if (c.dataset.code === round.oddCode) c.classList.add('pick-ok');
        });
        flashStage(false);
        document.getElementById('gameMsg').textContent =
          `Лишний был ${oddItem.name} (${catRu(oddItem.category)})`;
        document.getElementById('gameMsg').style.color = '#b3452e';
      }
      oddIdx++;
      setGameProg(oddIdx, 6);
      if (oddIdx >= 6) {
        setTimeout(() => showGameDone(`Верно: ${oddCorrect} из 6`, oddCorrect >= 5 ? '🦊' : '🌿'), 1100);
      } else {
        setTimeout(showOddQ, 1200);
      }
    };
    grid.appendChild(card);
  });
  box.appendChild(grid);
  setGameProg(oddIdx, 6);
  document.getElementById('gameMsg').textContent = 'Кто лишний? Нажми на карту';
  document.getElementById('gameMsg').style.color = '#5a3a18';
}

async function startNumberGame() {
  currentGame = 'number';
  resetGameSheet('Диктант чисел');
  showGamePlay(false);
  document.getElementById('gameQ').textContent = 'Выбери уровень';
  setGameProg(0, 8, 'уровень');
  const lv = document.getElementById('gameLevels');
  lv.style.display = '';
  lv.innerHTML = '';
  [[1, 'Лёгкий', 'числа от 1 до 20'], [2, 'Сложнее', 'числа от 10 до 99']].forEach(([n, name, sub]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${name}<small>${sub}</small>`;
    b.onclick = () => beginNumber(n);
    lv.appendChild(b);
  });
}

async function beginNumber(level) {
  const lv = document.getElementById('gameLevels');
  if (lv) { lv.style.display = 'none'; lv.innerHTML = ''; }
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/number/start', { level });
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  numberQuestions = r.questions; numberIdx = 0; numberCorrect = 0;
  document.getElementById('gameTitle').textContent = `Диктант чисел · ур. ${r.level}`;
  document.getElementById('gameBtn').textContent = 'Ответить';
  showGamePlay(true);
  setGameInputMode('number');
  showNumberQ();
}

function showNumberQ() {
  const q = numberQuestions[numberIdx];
  document.getElementById('gameQ').textContent = q.text;
  document.getElementById('gameA').value = '';
  document.getElementById('gameMsg').textContent = 'Набери это число цифрами';
  document.getElementById('gameMsg').style.color = '#5a3a18';
  setGameProg(numberIdx, 8);
  document.getElementById('gameA').focus();
}

async function startCompareGame() {
  currentGame = 'compare';
  resetGameSheet('Тропинка сравнения');
  showGamePlay(false);
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/compare/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  compareRounds = r.rounds; compareIdx = 0; compareCorrect = 0;
  showCompareQ();
}

function showCompareQ() {
  const r = compareRounds[compareIdx];
  const box = document.getElementById('gameQ');
  document.getElementById('gameMsg').textContent = '';
  setGameProg(compareIdx, 8);
  if (r.type === 'cmp') {
    showGamePlay(false);
    box.innerHTML = `<div class="story-text">${esc(r.prompt)}</div>
      <div class="cmp-row">
        <button type="button" data-v="gt">${r.a} больше</button>
        <button type="button" data-v="lt">${r.b} больше</button>
        <button type="button" data-v="eq">Равны</button>
      </div>`;
    // если числа равны — подписи «a больше / b больше» путают; для eq ок
    if (r.a === r.b) {
      box.querySelector('[data-v="gt"]').textContent = `${r.a} > ${r.b}`;
      box.querySelector('[data-v="lt"]').textContent = `${r.a} < ${r.b}`;
    }
    box.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => answerCompare(btn.dataset.v);
    });
  } else {
    box.textContent = r.prompt;
    showGamePlay(true);
    setGameInputMode('number');
    document.getElementById('gameBtn').textContent = 'Ответить';
    document.getElementById('gameA').value = '';
    document.getElementById('gameA').placeholder = 'На сколько?';
    document.getElementById('gameA').focus();
    document.getElementById('gameMsg').textContent = 'Введи разницу';
    document.getElementById('gameMsg').style.color = '#5a3a18';
  }
}

function answerCompare(val) {
  const r = compareRounds[compareIdx];
  let ok = false;
  if (r.type === 'cmp') ok = val === r.answer;
  else ok = parseInt(val, 10) === r.answer;
  flashStage(ok);
  if (ok) {
    compareCorrect++;
    document.getElementById('gameMsg').textContent = 'Верно!';
    document.getElementById('gameMsg').style.color = '#5f8e37';
  } else {
    const right = r.type === 'cmp'
      ? (r.answer === 'eq' ? 'они равны' : r.answer === 'gt' ? `${r.a} больше` : `${r.b} больше`)
      : String(r.answer);
    document.getElementById('gameMsg').textContent = `Почти! Правильно: ${right}`;
    document.getElementById('gameMsg').style.color = '#b3452e';
  }
  compareIdx++;
  if (compareIdx >= 8) {
    showGamePlay(false);
    setTimeout(() => showGameDone(`Верно: ${compareCorrect} из 8`, compareCorrect >= 6 ? '⚖️' : '📏'), 700);
  } else {
    setTimeout(showCompareQ, 800);
  }
}

async function startStoryGame() {
  currentGame = 'story';
  resetGameSheet('Лесные задачи');
  showGamePlay(false);
  document.getElementById('gameQ').textContent = 'Загрузка…';
  const r = await api('/api/game/story/start', {});
  if (r.error) {
    document.getElementById('gameMsg').textContent = r.error;
    document.getElementById('gameMsg').style.color = '#b3452e';
    return;
  }
  storyQuestions = r.questions; storyIdx = 0; storyCorrect = 0;
  document.getElementById('gameBtn').textContent = 'Ответить';
  showGamePlay(true);
  setGameInputMode('number');
  showStoryQ();
}

function showStoryQ() {
  const q = storyQuestions[storyIdx];
  document.getElementById('gameQ').innerHTML = `<div class="story-text">${esc(q.text)}</div>`;
  document.getElementById('gameA').value = '';
  document.getElementById('gameA').placeholder = 'Ответ';
  document.getElementById('gameMsg').textContent = 'Реши и введи число';
  document.getElementById('gameMsg').style.color = '#5a3a18';
  setGameProg(storyIdx, 5);
  document.getElementById('gameA').focus();
}

if (document.getElementById('gameClaim')) {
  document.getElementById('gameClaim').onclick = async () => {
    const score = currentGame === 'count' ? countScore
      : currentGame === 'guess' ? guessCorrect
      : currentGame === 'memory' ? memoryMatched
      : currentGame === 'word' ? wordCorrect
      : currentGame === 'odd' ? oddCorrect
      : currentGame === 'number' ? numberCorrect
      : currentGame === 'compare' ? compareCorrect
      : currentGame === 'story' ? storyCorrect
      : gameCorrect;
    await claimGameReward(score);
  };
}
if (document.getElementById('gameClose')) document.getElementById('gameClose').onclick = closeGameOv;
if (document.getElementById('gameOv')) document.getElementById('gameOv').onclick = (e) => {
  if (e.target.id === 'gameOv') closeGameOv();
};

// общий обработчик Ответить — расширяем для number / compare-diff / story
if (document.getElementById('gameBtn')) {
  const baseHandler = document.getElementById('gameBtn').onclick;
  document.getElementById('gameBtn').onclick = async () => {
    if (currentGame === 'number') {
      const val = parseInt(document.getElementById('gameA').value, 10);
      if (isNaN(val)) return;
      const q = numberQuestions[numberIdx];
      const ok = val === q.answer;
      flashStage(ok);
      if (ok) {
        numberCorrect++;
        document.getElementById('gameMsg').textContent = 'Верно!';
        document.getElementById('gameMsg').style.color = '#5f8e37';
      } else {
        document.getElementById('gameMsg').textContent = `Почти! Это ${q.answer}`;
        document.getElementById('gameMsg').style.color = '#b3452e';
      }
      numberIdx++;
      if (numberIdx >= 8) {
        showGamePlay(false);
        setTimeout(() => showGameDone(`Верно: ${numberCorrect} из 8`, numberCorrect >= 6 ? '🔢' : '✏️'), 700);
      } else {
        setTimeout(showNumberQ, 700);
      }
      return;
    }
    if (currentGame === 'compare') {
      const r = compareRounds[compareIdx];
      if (r?.type !== 'diff') return;
      const val = parseInt(document.getElementById('gameA').value, 10);
      if (isNaN(val)) return;
      answerCompare(val);
      return;
    }
    if (currentGame === 'story') {
      const val = parseInt(document.getElementById('gameA').value, 10);
      if (isNaN(val)) return;
      const q = storyQuestions[storyIdx];
      const ok = val === q.answer;
      flashStage(ok);
      if (ok) {
        storyCorrect++;
        document.getElementById('gameMsg').textContent = 'Верно!';
        document.getElementById('gameMsg').style.color = '#5f8e37';
      } else {
        document.getElementById('gameMsg').textContent = `Почти! Ответ: ${q.answer}`;
        document.getElementById('gameMsg').style.color = '#b3452e';
      }
      storyIdx++;
      if (storyIdx >= 5) {
        showGamePlay(false);
        setTimeout(() => showGameDone(`Верно: ${storyCorrect} из 5`, storyCorrect >= 4 ? '📚' : '🌲'), 700);
      } else {
        setTimeout(showStoryQ, 800);
      }
      return;
    }
    if (typeof baseHandler === 'function') return baseHandler.call(document.getElementById('gameBtn'));
  };
}

window._startMultiply = startMultiplyGame;
window._startGuess = startGuessGame;
window._startCount = startCountGame;
window._startMemory = startMemoryGame;
window._startWord = startWordGame;
window._startOdd = startOddGame;
window._startNumber = startNumberGame;
window._startCompare = startCompareGame;
window._startStory = startStoryGame;

// привязка плиток на странице игр (SPA-навигация не выполняет inline-скрипты)
if ((location.pathname.split('/').pop() || '') === 'games.html') (function bind() {
  const m = document.getElementById('gmMultiply');
  const g = document.getElementById('gmGuess');
  const c = document.getElementById('gmCount');
  const mem = document.getElementById('gmMemory');
  const w = document.getElementById('gmWord');
  const o = document.getElementById('gmOdd');
  const num = document.getElementById('gmNumber');
  const cmp = document.getElementById('gmCompare');
  const st = document.getElementById('gmStory');
  if (!m || !g || !c || !mem || !w || !o || !num || !cmp || !st) return setTimeout(bind, 50);
  m.onclick = (e) => { e.preventDefault(); window._startMultiply(); };
  g.onclick = (e) => { e.preventDefault(); window._startGuess(); };
  c.onclick = (e) => { e.preventDefault(); window._startCount(); };
  mem.onclick = (e) => { e.preventDefault(); window._startMemory(); };
  w.onclick = (e) => { e.preventDefault(); window._startWord(); };
  o.onclick = (e) => { e.preventDefault(); window._startOdd(); };
  num.onclick = (e) => { e.preventDefault(); window._startNumber(); };
  cmp.onclick = (e) => { e.preventDefault(); window._startCompare(); };
  st.onclick = (e) => { e.preventDefault(); window._startStory(); };
})();

};
