// Optimistic merge preview only. Pack composition is generated exclusively on the server.
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

