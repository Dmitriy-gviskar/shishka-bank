"""Рациональный коллекционер: сливает только излишки, ячейку альбома не разоряет.
merge при qty>=4 (три уходят, одна остаётся в альбоме), топливо не трогает
(оно всегда забирает обе карты и опустошает ячейку), обмен — только на излишках."""
import sys
sys.path.insert(0, '/Users/dmitri/Desktop/shishka-bank/tools')
import sim_cards as S

class Collector(S.Child):
    def do_merges(self):
        moved = True
        while moved:
            moved = False
            for (being, grade), q in list(self.cards.items()):
                if grade >= 6 or q < 4:          # <- оставляем один экземпляр в альбоме
                    continue
                self.take(being, grade, 3)
                new_g = grade + 1
                if grade + 2 <= 5 and self.rnd.random() < 0.05:
                    new_g, self.bonuses = grade + 2, self.bonuses + 1
                self.add(being, new_g)
                self.merges += 1
                moved = True

    def do_fuel(self):
        return                                    # ячейку не разоряем

def run_collector(seed, max_packs=30000, targets=(1, 10, 30, 60, 90, 121)):
    rnd = S.random.Random(seed)
    c = Collector(rnd, v3=True)
    hits, cells = {}, {}
    for p in range(1, max_packs + 1):
        c.turn()
        full = sum(1 for b in S.BEINGS if all(c.qty(b, g) > 0 for g in S.GRADES))
        n_cells = len(c.cards)
        for m in targets:
            if m not in hits and full >= m:
                hits[m] = p
        for m in (500, 650, 700, 726):
            if m not in cells and n_cells >= m:
                cells[m] = p
        if full >= 121:
            break
    return hits, cells

runs = [run_collector(s) for s in (11, 22, 33)]
print('=== Рациональный коллекционер: паков до N собранных целиком существ ===')
print(f'{"существ":>8} {"паков":>10} {"шишек":>12} {"месяцев при 35🌰/день":>24}')
for m in (1, 10, 30, 60, 90, 121):
    vals = sorted(r[0][m] for r in runs if m in r[0])
    if not vals:
        print(f'{m:>8} {"не собрано за 30k паков":>10}')
        continue
    med = vals[len(vals) // 2]
    print(f'{m:>8} {med:>10,} {med*45:>12,} {med*45/35/30:>24,.1f}')
print('\n=== Заполнение ячеек (всего 726) ===')
for m in (500, 650, 700, 726):
    vals = sorted(r[1][m] for r in runs if m in r[1])
    print(f'{m:>4} ячеек: ' + (f'{vals[len(vals)//2]:,} паков' if vals else 'не достигнуто'))
