// Локальные правила пака и слияния — те же числа, что open_pack / merge_cards.
// Нужны, чтобы без сети открыть пак и прокачать карту, а потом отдать серверу тот же результат.
export const PACK_PRICE = 20;
export const PACK_SIZE = 7;

export function recountAlbum(data) {
  const album = (data.cards || []).filter((c) => c.category !== 'special');
  const cells = album.reduce((n, c) => n + c.grades.filter((g) => g.qty > 0).length, 0);
  data.collected = cells;
  data.total = album.length * 6;
  data.beings_met = album.filter((c) => c.owned).length;
  data.beings_complete = album.filter((c) => c.grades.filter((g) => g.qty > 0).length === 6).length;
  data.beings_total = album.length;
  return data;
}

export function applyMerge(data, typeId, grade) {
  if (!data || !Array.isArray(data.cards)) return { error: 'альбом ещё не загружался — зайди в коллекцию по сети' };
  if (grade >= 6) return { error: 'выше некуда' };
  const card = data.cards.find((c) => c.id === typeId);
  if (!card) return { error: 'нет такой карты' };
  const slot = card.grades.find((g) => g.grade === grade);
  if (!slot || slot.qty < 3) return { error: 'нужно 3 одинаковых' };
  slot.qty -= 3;
  const nextG = grade + 1;
  let next = card.grades.find((g) => g.grade === nextG);
  if (!next) {
    next = { grade: nextG, qty: 0, merged: 0, unseen: true };
    card.grades.push(next);
  }
  next.qty += 1;
  next.merged = (next.merged || 0) + 1;
  next.unseen = true;
  card.best = card.grades.filter((g) => g.qty > 0).reduce((m, g) => Math.max(m, g.grade), 0);
  card.owned = card.best > 0;
  recountAlbum(data);
  return { ok: true, new_grade: nextG, bonus: false, rewards: [], offline: true };
}

export function rollGrade(rarities, rnd = Math.random) {
  const list = (rarities || []).slice().sort((a, b) => a.grade - b.grade);
  const total = list.reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
  let r = rnd() * total, acc = 0;
  for (const row of list) {
    acc += Number(row.weight) || 0;
    if (r < acc) return row.grade;
  }
  return 1;
}

function dropPool(data) {
  const season = (data.seasons || []).find((s) => s.status === 'active');
  return (data.cards || []).filter((c) => c.category !== 'special' && (!season || !c.season || c.season === season.code));
}

function missingCell(pool, minGrade = 1) {
  const holes = [];
  for (const c of pool) {
    for (const g of c.grades || []) {
      if (g.grade >= minGrade && g.grade <= 6 && (g.qty || 0) <= 0) holes.push({ card: c, grade: g.grade });
    }
  }
  return holes.length ? holes[Math.floor(Math.random() * holes.length)] : null;
}

export function rollPack(data, rnd = Math.random) {
  const pool = dropPool(data);
  if (pool.length < 1) return { error: 'нет карт для пака' };
  const opened = ((data.pity && data.pity.opened) || 0) + 1;
  const drawn = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const card = pool[Math.floor(rnd() * pool.length)];
    const grade = rollGrade(data.rarities, rnd);
    drawn.push({ type: card.id, code: card.code, name: card.name, category: card.category, grade });
  }
  const hasNew = drawn.some((d) => {
    const c = pool.find((x) => x.id === d.type);
    const g = c && c.grades.find((x) => x.grade === d.grade);
    return !g || g.qty <= 0;
  });
  let pity = null;
  if (opened % 50 === 0) pity = missingCell(pool, 4);
  else if (opened % 10 === 0 && !hasNew) pity = missingCell(pool, 1);
  if (pity) {
    drawn[PACK_SIZE - 1] = {
      type: pity.card.id, code: pity.card.code, name: pity.card.name,
      category: pity.card.category, grade: pity.grade,
    };
  }
  return { drawn, opened };
}

export function applyPackToAlbum(data, drawn) {
  const cards = [];
  for (const d of drawn) {
    const card = data.cards.find((c) => c.id === d.type);
    if (!card) continue;
    let slot = card.grades.find((g) => g.grade === d.grade);
    if (!slot) {
      slot = { grade: d.grade, qty: 0, merged: 0, unseen: true };
      card.grades.push(slot);
    }
    const isNew = (slot.qty || 0) <= 0;
    slot.qty = (slot.qty || 0) + 1;
    slot.unseen = true;
    card.best = card.grades.filter((g) => g.qty > 0).reduce((m, g) => Math.max(m, g.grade), 0);
    card.owned = card.best > 0;
    cards.push({
      code: card.code, name: card.name, category: card.category,
      grade: d.grade, is_new: isNew, type: card.id,
    });
  }
  if (!data.pity) data.pity = { opened: 0, to_new: 10, to_top: 50 };
  data.pity.opened = (data.pity.opened || 0) + 1;
  data.pity.to_new = 10 - (data.pity.opened % 10);
  data.pity.to_top = 50 - (data.pity.opened % 50);
  recountAlbum(data);
  return cards;
}
