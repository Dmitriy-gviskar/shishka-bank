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
};
const GAME_MAX = {
  multiply: 10, guess: 5, count: 30, memory: 6, word: 5, odd: 6,
  number: 8, compare: 8, story: 5,
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

  return {
// ── Мини-игры ──
// Счёт в БД пишем только на finish (один раз). Награда считается на сервере; с клиента берём только score с потолком.
// За каждую игру — не больше одной награды в день (по message транзакции).
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
  await q(`insert into mini_games(child_id, game, level, last_played) values ($1,'multiply',$2,current_date)
    on conflict (child_id, game) do update set level=$2, last_played=current_date`, [ctx.child, level]);
  return { questions, reward, level };
},
'POST /api/game/answer': async (b, ctx) => {
  // только проверка для UI — прогресс в БД не трогаем (иначе double-count с finish)
  const expected = parseInt(b.expected, 10);
  const correct = parseInt(b.answer, 10) === expected;
  return { correct, expected };
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
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'count',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
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
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'guess',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
  return { questions, reward: 5 };
},
'POST /api/game/guess/answer': async (b, ctx) => {
  const name = String(b.name || '');
  const correct = String(b.answer || '').trim().toLowerCase() === name.trim().toLowerCase();
  return { correct, name };
},
'POST /api/game/memory/start': async (b, ctx) => {
  const pairs = await q(
    `select t.code, t.name from card_types t
      where t.code = any($1::text[]) order by random() limit 6`, [GAME_EASY]);
  if (pairs.length < 6) throw { code: 400, msg: 'мало карт для игры' };
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'memory',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
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
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'word',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
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
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'odd',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
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
  await q(`insert into mini_games(child_id, game, level, last_played) values ($1,'number',$2,current_date)
    on conflict (child_id, game) do update set level=$2, last_played=current_date`, [ctx.child, level]);
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
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'compare',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
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
  await q(`insert into mini_games(child_id, game, last_played) values ($1,'story',current_date)
    on conflict (child_id, game) do update set last_played=current_date`, [ctx.child]);
  return { questions, reward: 5 };
},
'POST /api/game/finish': async (b, ctx) => {
  const game = String(b.game || 'multiply');
  if (!GAME_LABELS[game]) throw { code: 400, msg: 'неизвестная игра' };
  const maxScore = GAME_MAX[game] || 10;
  const score = Math.min(Math.max(parseInt(b.score, 10) || 0, 0), maxScore);
  const label = GAME_LABELS[game];

  const w0 = await one('select balance from wallets where user_id=$1', [ctx.child]);
  if (score <= 0) return { ok: true, reward: 0, balance: w0?.balance ?? 0 };

  const already = await one(
    `select 1 as x from transactions
      where to_user=$1 and type='reward' and message=$2
        and (created_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date
      limit 1`, [ctx.child, label]);
  if (already) {
    return { ok: true, reward: 0, balance: w0.balance, already: true };
  }

  let reward = 0;
  if (game === 'multiply') {
    const row = await one(`select level from mini_games where child_id=$1 and game='multiply'`, [ctx.child]);
    const level = row?.level || 1;
    reward = level === 1 ? 3 : level === 2 ? 5 : 8;
  } else if (game === 'guess') {
    reward = 5;
  } else if (game === 'count') {
    reward = score;
  } else if (game === 'memory') {
    reward = score >= 6 ? 4 : 0; // награда только за полный забег
  } else if (game === 'word' || game === 'odd') {
    reward = score > 0 ? 4 : 0;
  } else if (game === 'number' || game === 'compare') {
    reward = score > 0 ? 3 : 0;
  } else if (game === 'story') {
    reward = score > 0 ? 5 : 0;
  }

  if (reward <= 0 && game === 'memory') {
    await q(`insert into mini_games(child_id, game, score, last_played) values ($1,$2,$3,current_date)
      on conflict (child_id, game) do update set score=mini_games.score+$3, last_played=current_date`,
      [ctx.child, game, score]);
    return { ok: true, reward: 0, balance: w0.balance };
  }

  await q(`insert into mini_games(child_id, game, score, last_played) values ($1,$2,$3,current_date)
    on conflict (child_id, game) do update set score=mini_games.score+$3, last_played=current_date`,
    [ctx.child, game, score]);
  if (reward > 0) {
    await q('update wallets set balance=balance+$2, total_earned=total_earned+$2 where user_id=$1', [ctx.child, reward]);
    await q("insert into transactions(circle_id, to_user, amount, type, message) select circle_id, $1, $2, 'reward', $3 from users where id=$1", [ctx.child, reward, label]);
  }
  await rpc('check_achievements', [ctx.child]).catch(() => {});
  const w = await one('select balance from wallets where user_id=$1', [ctx.child]);
  return { ok: true, reward, balance: w.balance };
},
  };
}
