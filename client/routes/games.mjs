// Мини-игры: константы + маршруты /api/game/*
export function routesGames({ q, one, rpc }) {
// Знакомый детям пул карт для развивающих игр (угадайка / память / слово / лишнее)
const GAME_EASY = [
  'lisa', 'volk', 'medved', 'zayac', 'belka', 'ezh', 'sova', 'enot', 'olen', 'kaban',
  'bobr', 'krot', 'mysh', 'barsuk', 'los', 'filin', 'burunduk', 'lyagushka', 'yashcherica',
  'dyatel', 'sinica', 'soroka', 'snegir', 'voron', 'solovey',
  'babochka', 'korovka', 'pchela', 'muravey', 'komar', 'strekoza', 'kuznechik', 'ulitka',
  'pauk', 'shmel', 'osa', 'gusenica', 'svetlyachok',
  'romashka', 'oduvanchik', 'podsolnuh', 'muhomor', 'dub', 'bereza', 'el', 'sosna',
  'malina', 'chernika', 'zemlyanika', 'klever', 'mak', 'ryabina', 'landysh', 'kolokolchik',
];
const GAME_CLUES = {
  lisa: 'Рыжая, с пушистым хвостом', volk: 'Серый, воет по ночам', medved: 'Большой, любит мёд',
  zayac: 'Длинные уши, прыгает', belka: 'Прыгает по деревьям, грызёт орехи', ezh: 'Колючий шарик',
  sova: 'Ночная птица, говорит «ух»', enot: 'Полосатый хвостик и чёрная маска на мордочке',
  olen: 'Ветвистые рога', kaban: 'Клыкастый лесной кабанчик', bobr: 'Строит плотины из веток',
  krot: 'Роет норы под землёй', mysh: 'Маленькая, пищит', barsuk: 'Полосатая мордочка',
  los: 'Очень большие рога и длинные ноги', filin: 'Крупная сова с кисточками на ушах',
  burunduk: 'Полосатый спиной, как маленький бурундучок', lyagushka: 'Зелёная, квакает',
  yashcherica: 'Быстрая, хвостик может отбросить', dyatel: 'Стучит клювом по дереву',
  sinica: 'Маленькая жёлтогрудая птичка', soroka: 'Чёрно-белая, любит блестящее',
  snegir: 'Зимой красная грудка', voron: 'Большая чёрная птица', solovey: 'Красиво поёт по ночам',
  babochka: 'Красивые крылья, порхает', korovka: 'Красная в чёрный горошек',
  pchela: 'Собирает мёд, жужжит', muravey: 'Маленький, живёт в муравейнике',
  komar: 'Пищит и кусается летом', strekoza: 'Длинные крылья, летает у воды',
  kuznechik: 'Зелёный, прыгает и стрекочет', ulitka: 'Ползает с домиком на спине',
  pauk: 'Плетёт паутину', shmel: 'Мохнатый и громко жужжит', osa: 'Полосатая, может ужалить',
  gusenica: 'Ползёт и потом станет бабочкой', svetlyachok: 'Светится в темноте',
  romashka: 'Белые лепестки, жёлтая серединка', oduvanchik: 'Жёлтый, потом белый пух',
  podsolnuh: 'Большой жёлтый цветок к солнцу', muhomor: 'Красная шляпка в белый горошек',
  dub: 'Большое дерево с желудями', bereza: 'Белый ствол с чёрными пятнами',
  el: 'Зелёная колючая, как на Новый год', sosna: 'Хвоя длинными иголками, шишки',
  malina: 'Красные ягоды на кусте', chernika: 'Синие лесные ягоды',
  zemlyanika: 'Маленькая красная ягодка', klever: 'Листочки по три', mak: 'Ярко-красный цветок',
  ryabina: 'Гроздья красных ягод на дереве', landysh: 'Белые колокольчики и сильный запах',
  kolokolchik: 'Цветок похож на колокольчик',
};
const shuffleArr = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const lettersOf = (name) => String(name || '').replace(/[^А-Яа-яЁёA-Za-z]/g, '');
const catLabelRu = (c) => (c === 'zver' ? 'зверь или птица' : c === 'rastenie' ? 'растение или гриб'
  : c === 'nasekomoe' ? 'насекомое' : 'лесной житель');
const GAME_LABELS = {
  multiply: 'Мини-игра: таблица умножения',
  guess: 'Мини-игра: лесная угадайка',
  count: 'Мини-игра: блиц-счёт',
  memory: 'Мини-игра: найди пару',
  word: 'Мини-игра: собери слово',
  odd: 'Мини-игра: что лишнее',
  number: 'Мини-игра: диктант чисел',
  compare: 'Мини-игра: тропинка сравнения',
  story: 'Мини-игра: лесные задачи',
  quiz: 'Мини-игра: викторина 10–14',
  logic: 'Мини-игра: задачи 10–14',
};
const GAME_MAX = {
  multiply: 10, guess: 5, count: 30, memory: 6, word: 5, odd: 6,
  number: 8, compare: 8, story: 5, quiz: 8, logic: 5,
};
const RU_ONES = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
function numToRu(n) {
  n = Math.max(0, Math.min(100, Math.floor(Number(n) || 0)));
  if (n === 100) return 'сто';
  if (n < 10) return RU_ONES[n];
  if (n < 20) return RU_TEENS[n - 10];
  const t = Math.floor(n / 10), o = n % 10;
  return o === 0 ? RU_TENS[t] : `${RU_TENS[t]} ${RU_ONES[o]}`;
}
const STORY_TEMPLATES = [
  { t: 'У {name} было {a} шишек, нашлось ещё {b}. Сколько стало?', op: '+' },
  { t: '{name} спрятала {a} орехов, а потом ещё {b}. Сколько всего?', op: '+' },
  { t: 'В корзине лежало {a} ягод, положили ещё {b}. Сколько ягод?', op: '+' },
  { t: 'У {name} было {a} шишек, отдала {b}. Сколько осталось?', op: '-' },
  { t: '{name} нашла {a} грибов, {b} оказались червивыми. Сколько хороших?', op: '-' },
  { t: 'На ветке сидело {a} птиц, улетело {b}. Сколько осталось?', op: '-' },
  { t: 'Белка спрятала {a} орехов и потеряла {b}. Сколько осталось?', op: '-' },
  { t: 'В дупле было {a} шишек, принесли ещё {b}. Сколько теперь?', op: '+' },
];
// Викторина 10–14: факты школьной программы, не выдумки. Пул большой — за забег 8 случайных.
const QUIZ_BANK = [
  { q: 'Чем дышат рыбы?', options: ['жабрами', 'лёгкими', 'кожей', 'носом'], answer: 'жабрами' },
  { q: 'Сколько ног у насекомого?', options: ['6', '8', '4', '10'], answer: '6' },
  { q: 'Как называется процесс, которым растение делает пищу из света?', options: ['фотосинтез', 'дыхание', 'брожение', 'испарение'], answer: 'фотосинтез' },
  { q: 'Какое дерево с белым стволом и чёрными чёрточками?', options: ['берёза', 'дуб', 'ель', 'сосна'], answer: 'берёза' },
  { q: 'Самое глубокое озеро на Земле?', options: ['Байкал', 'Виктория', 'Ладога', 'Каспийское море'], answer: 'Байкал' },
  { q: 'Столица России?', options: ['Москва', 'Санкт-Петербург', 'Казань', 'Новосибирск'], answer: 'Москва' },
  { q: 'Куда впадает Волга?', options: ['в Каспийское море', 'в Чёрное море', 'в Балтийское море', 'в Байкал'], answer: 'в Каспийское море' },
  { q: 'Какой материк самый большой?', options: ['Евразия', 'Африка', 'Северная Америка', 'Австралия'], answer: 'Евразия' },
  { q: 'Сколько будет 25% от 80?', options: ['20', '25', '40', '15'], answer: '20' },
  { q: 'Чему равны 3/4 от 20?', options: ['15', '12', '16', '10'], answer: '15' },
  { q: 'Сколько градусов в прямом угле?', options: ['90', '45', '180', '60'], answer: '90' },
  { q: 'Сколько планет в Солнечной системе?', options: ['8', '9', '7', '10'], answer: '8' },
  { q: 'При какой температуре кипит вода на уровне моря?', options: ['100 °C', '90 °C', '80 °C', '0 °C'], answer: '100 °C' },
  { q: 'Вокруг чего Земля делает оборот за год?', options: ['вокруг Солнца', 'вокруг Луны', 'вокруг Юпитера', 'вокруг своей оси'], answer: 'вокруг Солнца' },
  { q: 'Кто чаще всего опыляет цветы?', options: ['пчёлы', 'кроты', 'рыбы', 'совы'], answer: 'пчёлы' },
  { q: 'Какое из этих деревьев хвойное?', options: ['ель', 'берёза', 'дуб', 'клён'], answer: 'ель' },
  { q: 'Сколько суток в невисокосном году?', options: ['365', '366', '360', '364'], answer: '365' },
  { q: 'Сколько примерно весит литр воды?', options: ['1 кг', '100 г', '10 кг', '1 г'], answer: '1 кг' },
  { q: 'Если сегодня среда, какой день будет послезавтра?', options: ['пятница', 'четверг', 'суббота', 'вторник'], answer: 'пятница' },
  { q: '7 × 8 + 6 = ?', options: ['62', '56', '68', '54'], answer: '62' },
  { q: 'Полярный день бывает', options: ['за полярным кругом', 'на экваторе', 'в любой пустыне', 'только зимой везде'], answer: 'за полярным кругом' },
  { q: 'У паука ног', options: ['8', '6', '4', '10'], answer: '8' },
  { q: 'Грибы — это', options: ['отдельное царство', 'растения', 'животные', 'камни'], answer: 'отдельное царство' },
  { q: '0,5 + 0,5 = ?', options: ['1', '0', '2', '0,25'], answer: '1' },
];
const LOGIC_TEMPLATES = [
  { kind: 'mul', t: 'В паке {a} шишек. Купили {b} паков. Сколько шишек всего?' },
  { kind: 'div', t: 'У {name} {a} шишек. Разделила поровну на {b} друзей. По сколько каждому?' },
  { kind: 'pct', t: 'Число {a}. Чему равны {p}% от него?' },
  { kind: 'stock', t: '{name} собрала {a} орехов — это {p}% запаса. Каков весь запас?' },
  { kind: 'left', t: 'Купили {a} пачек по {b} шишек и потратили {c}. Сколько осталось?' },
  { kind: 'speed', t: 'Шли {b} часов со скоростью {a} км/ч. Какой путь в километрах?' },
  { kind: 'pack', t: 'В корзине {a} ягод, в банку кладут по {b}. Сколько полных банок?' },
];

  const routes = {
// ── Мини-игры ──
// Generators remain private: wrappers below persist challenges and redact answer keys.
// Answers and final rewards are committed by the durable SQL attempt protocol.
'POST /api/game/start': async (b, ctx) => {
  const level = Math.min(Math.max(parseInt(b.level) || 1, 1), 3);
  const tables = level === 1 ? [2, 3, 5] : level === 2 ? [4, 6, 7, 8] : [2, 3, 4, 5, 6, 7, 8, 9];
  const reward = level === 1 ? 3 : level === 2 ? 5 : 8;
  const questions = [];
  for (let i = 0; i < 10; i++) {
    const a = tables[Math.floor(Math.random() * tables.length)];
    const n = Math.floor(Math.random() * 9) + 1;
    questions.push({ a, b: n, answer: a * n });
  }
  return { questions, reward, level };
},
'POST /api/game/count/start': async (b, ctx) => {
  const questions = [];
  for (let i = 0; i < 50; i++) {
    const op = Math.random() < 0.5 ? '+' : '-';
    let a = Math.floor(Math.random() * 20) + 1;
    let n = Math.floor(Math.random() * 20) + 1;
    if (op === '-' && n > a) [a, n] = [n, a];
    questions.push({ a, op, b: n, answer: op === '+' ? a + n : a - n });
  }
  return { questions, duration: 30 };
},
'POST /api/game/guess/start': async (b, ctx) => {
  const beings = await q(
    `select t.code, t.name, t.category
       from card_types t
      where t.code = any($1::text[])
      order by random() limit 5`, [GAME_EASY]);
  const pool = await q(
    `select code, name, category from card_types where code = any($1::text[])`, [GAME_EASY]);
  const questions = beings.map((row) => {
    const same = shuffleArr(pool.filter((p) => p.code !== row.code && p.category === row.category));
    const any = shuffleArr(pool.filter((p) => p.code !== row.code));
    const wrong = [];
    for (const p of same) { if (wrong.length >= 3) break; wrong.push(p); }
    for (const p of any) {
      if (wrong.length >= 3) break;
      if (!wrong.some((w) => w.code === p.code)) wrong.push(p);
    }
    const options = shuffleArr([row.name, ...wrong.map((w) => w.name)]).slice(0, 4);
    const letters = lettersOf(row.name);
    const hints = [
      `Это ${catLabelRu(row.category)}.`,
      GAME_CLUES[row.code] || 'Посмотри на картинку — она чуть размыта.',
      `Имя начинается на «${row.name[0]}», всего ${letters.length} букв.`,
    ];
    return { code: row.code, name: row.name, hints, options };
  });
  return { questions, reward: 5 };
},
'POST /api/game/memory/start': async (b, ctx) => {
  const pairs = await q(
    `select t.code, t.name from card_types t
      where t.code = any($1::text[]) order by random() limit 6`, [GAME_EASY]);
  if (pairs.length < 6) throw { code: 400, msg: 'мало карт для игры' };
  return { pairs, duration: 90, reward: 4 };
},
'POST /api/game/word/start': async (b, ctx) => {
  const rows = await q(
    `select t.code, t.name, t.category from card_types t
      where t.code = any($1::text[]) order by random()`, [GAME_EASY]);
  const ok = rows.filter((r) => {
    const L = lettersOf(r.name);
    return L.length >= 3 && L.length <= 6 && !/[\s-]/.test(r.name);
  }).slice(0, 5);
  if (ok.length < 5) throw { code: 400, msg: 'мало слов для игры' };
  const questions = ok.map((r) => {
    const letters = shuffleArr(lettersOf(r.name).toUpperCase().split(''));
    return { code: r.code, name: r.name, category: r.category, letters };
  });
  return { questions, reward: 4 };
},
'POST /api/game/odd/start': async (b, ctx) => {
  const pool = await q(
    `select code, name, category from card_types where code = any($1::text[])`, [GAME_EASY]);
  const byCat = { zver: [], rastenie: [], nasekomoe: [] };
  for (const p of pool) if (byCat[p.category]) byCat[p.category].push(p);
  const cats = Object.keys(byCat).filter((c) => byCat[c].length >= 3);
  const rounds = [];
  for (let i = 0; i < 6; i++) {
    const major = cats[Math.floor(Math.random() * cats.length)];
    const others = cats.filter((c) => c !== major);
    const minor = others[Math.floor(Math.random() * others.length)];
    const maj = shuffleArr(byCat[major]).slice(0, 3);
    const odd = shuffleArr(byCat[minor])[0];
    if (!odd || maj.length < 3) continue;
    const items = shuffleArr([...maj, odd]).map((x) => ({
      code: x.code, name: x.name, category: x.category,
    }));
    rounds.push({ items, oddCode: odd.code });
  }
  if (rounds.length < 6) throw { code: 400, msg: 'не удалось собрать раунды' };
  return { rounds, reward: 4 };
},
'POST /api/game/number/start': async (b, ctx) => {
  const level = Math.min(Math.max(parseInt(b.level, 10) || 1, 1), 2);
  const questions = [];
  const used = new Set();
  while (questions.length < 8) {
    const n = level === 1
      ? Math.floor(Math.random() * 20) + 1
      : Math.floor(Math.random() * 90) + 10;
    if (used.has(n)) continue;
    used.add(n);
    questions.push({ n, text: numToRu(n), answer: n });
  }
  return { questions, level, reward: 3 };
},
'POST /api/game/compare/start': async (b, ctx) => {
  const rounds = [];
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) {
      let a = Math.floor(Math.random() * 30) + 1;
      let c = Math.floor(Math.random() * 30) + 1;
      if (Math.random() < 0.15) c = a;
      const rel = a > c ? 'gt' : a < c ? 'lt' : 'eq';
      rounds.push({ type: 'cmp', a, b: c, answer: rel,
        prompt: `Что больше: ${a} или ${c}?` });
    } else {
      let a = Math.floor(Math.random() * 30) + 1;
      let c = Math.floor(Math.random() * 30) + 1;
      if (a === c) c = a === 30 ? 29 : a + 1;
      const hi = Math.max(a, c), lo = Math.min(a, c);
      rounds.push({ type: 'diff', a: hi, b: lo, answer: hi - lo,
        prompt: `На сколько ${hi} больше ${lo}?` });
    }
  }
  return { rounds, reward: 3 };
},
'POST /api/game/story/start': async (b, ctx) => {
  const names = await q(
    `select name from card_types where code = any($1::text[]) order by random() limit 8`, [GAME_EASY]);
  const namePool = names.map((r) => r.name).filter((n) => !/[\s-]/.test(n));
  const tpls = shuffleArr(STORY_TEMPLATES).slice(0, 5);
  const questions = tpls.map((tpl, i) => {
    let a = Math.floor(Math.random() * 10) + 2;
    let n = Math.floor(Math.random() * 8) + 1;
    if (tpl.op === '-' && n >= a) n = Math.max(1, a - 1);
    const name = namePool[i % namePool.length] || 'Белка';
    const text = tpl.t.replace('{name}', name).replace('{a}', String(a)).replace('{b}', String(n));
    const answer = tpl.op === '+' ? a + n : a - n;
    return { text, answer };
  });
  return { questions, reward: 5 };
},
'POST /api/game/quiz/start': async (b, ctx) => {
  const picked = shuffleArr(QUIZ_BANK).slice(0, 8);
  const questions = picked.map((row) => ({
    q: row.q,
    options: shuffleArr(row.options.slice()),
    answer: row.answer,
  }));
  return { questions, reward: 6 };
},
'POST /api/game/logic/start': async (b, ctx) => {
  const names = await q(
    `select name from card_types where code = any($1::text[]) order by random() limit 8`, [GAME_EASY]);
  const namePool = names.map((r) => r.name).filter((n) => !/[\s-]/.test(n));
  const tpls = shuffleArr(LOGIC_TEMPLATES).slice(0, 5);
  const questions = tpls.map((tpl, i) => {
    const name = namePool[i % (namePool.length || 1)] || 'Белка';
    let a, n, p, c, answer, text;
    if (tpl.kind === 'mul' || tpl.kind === 'speed') {
      a = Math.floor(Math.random() * 8) + 3;
      n = Math.floor(Math.random() * 6) + 2;
      answer = a * n;
      text = tpl.t.replace('{name}', name).replace('{a}', String(a)).replace('{b}', String(n));
    } else if (tpl.kind === 'div' || tpl.kind === 'pack') {
      n = Math.floor(Math.random() * 5) + 2;
      answer = Math.floor(Math.random() * 8) + 3;
      a = n * answer + (tpl.kind === 'pack' ? Math.floor(Math.random() * (n - 1)) : 0);
      if (tpl.kind === 'div') a = n * answer;
      text = tpl.t.replace('{name}', name).replace('{a}', String(a)).replace('{b}', String(n));
    } else if (tpl.kind === 'pct') {
      p = [10, 20, 25, 50][Math.floor(Math.random() * 4)];
      answer = Math.floor(Math.random() * 9) + 2;
      a = answer * (100 / p);
      text = tpl.t.replace('{a}', String(a)).replace('{p}', String(p));
    } else if (tpl.kind === 'stock') {
      p = [10, 20, 25, 50][Math.floor(Math.random() * 4)];
      a = (Math.floor(Math.random() * 8) + 2) * (p === 10 ? 1 : p === 20 ? 2 : p === 25 ? 1 : 5);
      answer = (a * 100) / p;
      text = tpl.t.replace('{name}', name).replace('{a}', String(a)).replace('{p}', String(p));
    } else {
      a = Math.floor(Math.random() * 5) + 2;
      n = Math.floor(Math.random() * 8) + 3;
      c = Math.floor(Math.random() * 10) + 1;
      const total = a * n;
      if (c >= total) c = total - 1;
      answer = total - c;
      text = tpl.t.replace('{a}', String(a)).replace('{b}', String(n)).replace('{c}', String(c));
    }
    return { text, answer };
  });
  return { questions, reward: 6 };
},
  };
  const epoch = process.env.CARD_OPERATION_EPOCH;
  function ready() {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(epoch || ''))
      throw {code:503,msg:'Игры временно закрыты: поколение восстановления не настроено'};
  }
  async function call(fn, args) {
    ready();
    try { return (await one(`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args)).v; }
    catch(e) {
      const code = e.code === 'P0503' ? 503 : e.code === 'P0409' ? 409 : e.code === '22023' || e.code === '22P02' ? 400 : null;
      if(code) throw {code,msg:code===503?'После восстановления начните новую игру':code===409?'Попытка уже завершена, ответ изменён или время вышло':'Неверная игровая попытка'};
      throw e;
    }
  }
  const starts = {multiply:'/api/game/start',...Object.fromEntries(Object.keys(GAME_LABELS).filter(g=>g!=='multiply').map(g=>[g,`/api/game/${g}/start`]))};
  for(const [game,path] of Object.entries(starts)) {
    const generate=routes['POST '+path];
    routes['POST '+path]=async(b,ctx)=>{
      ready();
      const data=await generate(b,ctx);
      const questions=data.questions || data.rounds || [];
      const answers=questions.map(q=>game==='guess'||game==='word'?q.name:game==='odd'?q.oddCode:q.answer);
      const deck=game==='memory'?shuffleArr(data.pairs.flatMap(p=>[p.code,p.code])):[];
      const challenge={questions,answers,deck};
      const promised=game==='count'?30:data.reward??0;
      const attempt=await one(`insert into game_attempts(child_id,game,epoch,level,promised,max_score,label,challenge,answer_until)
        values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now()+($9::int * interval '1 second')) returning id`,
        [ctx.child,game,epoch,data.level||1,promised,GAME_MAX[game],GAME_LABELS[game],JSON.stringify(challenge),game==='count'?30:1800]);
      const clean=q=>{const copy={...q};delete copy.answer;delete copy.oddCode;if(game==='guess'||game==='word')delete copy.name;if(game==='number')delete copy.n;return copy;};
      const result={...data,attemptId:attempt.id};
      if(data.questions)result.questions=questions.map(clean);
      if(data.rounds)result.rounds=questions.map(clean);
      if(game==='memory'){delete result.pairs;result.tiles=deck.map((_,i)=>i);}
      return result;
    };
  }
  const answer=async(b,ctx)=>{
    if(typeof b.attemptId!=='string'||!Number.isInteger(b.index)||!['string','number'].includes(typeof b.answer))throw {code:400,msg:'Нужна игровая попытка и ответ'};
    return call('answer_game_attempt',[ctx.child,b.attemptId,epoch,b.index,String(b.answer)]);
  };
  for(const path of ['/api/game/answer','/api/game/quiz/answer','/api/game/guess/answer'])routes['POST '+path]=answer;
  routes['POST /api/game/memory/flip']=async(b,ctx)=>{
    if(typeof b.attemptId!=='string'||!Number.isInteger(b.tile)||!Number.isInteger(b.move))throw {code:400,msg:'Нужна попытка и номер хода'};
    return call('flip_game_tile',[ctx.child,b.attemptId,epoch,b.move,b.tile]);
  };
  routes['POST /api/game/finish']=async(b,ctx)=>{
    if(b.game && !Object.hasOwn(GAME_LABELS,b.game))throw {code:400,msg:'Неизвестная игра'};
    if(typeof b.attemptId!=='string')throw {code:503,msg:'Обновите игру и начните новую попытку'};
    return call('finish_game_attempt',[ctx.child,b.attemptId,epoch]);
  };
  return routes;
}
