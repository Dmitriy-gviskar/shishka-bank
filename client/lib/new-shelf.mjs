// Новинки альбома: не вываливать всё сразу, а пачками по 10 (T17).
export const NEW_BATCH = 10;

export function pageUnseen(items, shown) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.min(list.length, Math.max(0, shown == null ? NEW_BATCH : shown));
  return { visible: list.slice(0, n), rest: list.length - n, total: list.length };
}
