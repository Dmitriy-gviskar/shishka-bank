// Presentation only: never grants cards, changes their grade, or creates an operation.
(function (root) {
  const names = ['Обычная','Необычная','Редкая','Эпическая','Легендарная','Золотая'];
  function rarity(grade, rarities = []) {
    const value = Number(grade), known = Number.isInteger(value) && value >= 1 && value <= 6;
    const data = rarities.find(r => Number(r.grade) === value) || {};
    return {name: data.name || (known ? names[value - 1] : 'Неизвестная редкость'),
      color: /^#[0-9a-f]{3,8}$/i.test(data.color || '') ? data.color : '#8c9870',
      rank: known ? `${value} / 6` : '—'};
  }
  function pack(cards, rarities) {
    return (Array.isArray(cards) ? cards : []).map((card, index) => ({...card, rarity:rarity(card.grade, rarities), index}))
      .sort((a,b) => Number(b.grade) - Number(a.grade) || a.index - b.index);
  }
  root.ShishkaCardPresentation = {rarity, pack};
})(typeof window === 'undefined' ? globalThis : window);
