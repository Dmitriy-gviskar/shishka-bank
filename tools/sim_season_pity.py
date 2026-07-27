"""Сезон (пул ~24 существа) + гарант по недостающим картам.
Гарант новинки: каждый 10-й пак — карта, которой у ребёнка нет.
Гарант топ-новинки: каждый 50-й — недостающая карта Эпическая+ (закрывает верхний хвост)."""
import sys
sys.path.insert(0, '/Users/dmitri/Desktop/shishka-bank/tools')
import sim_cards as S

class Seasoned(S.Child):
    def __init__(self, rnd, pool, pity_new=10, pity_top=50):
        super().__init__(rnd, v3=True)
        self.pool, self.pity_new, self.pity_top, self.packs = pool, pity_new, pity_top, 0

    def missing(self, min_grade=1):
        return [(b, g) for b in self.pool for g in S.GRADES
                if g >= min_grade and self.qty(b, g) == 0]

    def open_pack(self):
        self.spent += S.PACK_PRICE
        self.packs += 1
        cards = [(self.rnd.choice(self.pool), S.roll_grade(self.rnd)) for _ in range(S.PACK_CARDS)]
        if self.pity_top and self.packs % self.pity_top == 0:
            m = self.missing(4)
            if m:
                cards[-1] = self.rnd.choice(m)
        elif self.pity_new and self.packs % self.pity_new == 0:
            m = self.missing(1)
            if m and not any(self.qty(b, g) == 0 for b, g in cards):
                cards[-1] = self.rnd.choice(m)
        for b, g in cards:
            self.add(b, g)

    def do_merges(self):
        moved = True
        while moved:
            moved = False
            for (being, grade), q in list(self.cards.items()):
                if grade >= 6 or q < 4:
                    continue
                self.take(being, grade, 3)
                new_g = grade + 1
                if grade + 2 <= 5 and self.rnd.random() < 0.05:
                    new_g = grade + 2
                self.add(being, new_g)
                moved = True

    def do_fuel(self):
        return

    def do_rewards(self):
        full = [b for b in self.pool if all(self.qty(b, g) > 0 for g in S.GRADES)]
        for b in full:
            if ('being', b) not in self.rewards_paid:
                self.rewards_paid.add(('being', b)); self.earned += 50
        if len(full) == len(self.pool) and 'season' not in self.rewards_paid:
            self.rewards_paid.add('season'); self.earned += 300


def run(pool_size, seed, pity_new, pity_top, max_packs=20000):
    rnd = S.random.Random(seed)
    pool = [('zver', i) for i in range(pool_size)]
    c = Seasoned(rnd, pool, pity_new, pity_top)
    marks = {}
    for p in range(1, max_packs + 1):
        c.turn()
        full = sum(1 for b in pool if all(c.qty(b, g) > 0 for g in S.GRADES))
        cells = sum(1 for b in pool for g in S.GRADES if c.qty(b, g) > 0)
        if 'half' not in marks and full >= pool_size // 2:
            marks['half'] = p
        if 'cells' not in marks and cells >= pool_size * 6:
            marks['cells'] = p
        if full >= pool_size:
            marks['full'] = p
            break
    return marks, c


print(f'{"конфигурация":38} {"все ячейки сезона":>19} {"половина 6/6":>14} {"весь сезон 6/6":>16} {"мес при 35🌰/д":>16}')
for label, pn, pt in (('сезон 24, без гаранта', 0, 0),
                      ('сезон 24, гарант новинки /10', 10, 0),
                      ('сезон 24, новинка /10 + топ /50', 10, 50),
                      ('сезон 24, новинка /8 + топ /30', 8, 30)):
    res = [run(24, s, pn, pt) for s in (11, 22, 33)]
    def med(key):
        v = sorted(m[key] for m, _ in res if key in m)
        return v[len(v) // 2] if v else None
    f, h, cl = med('full'), med('half'), med('cells')
    fs = f'{f:,} паков' if f else 'не собран'
    print(f'{label:38} {str(cl)+" паков":>19} {str(h)+" паков":>14} {fs:>16} {(f*45/35/30 if f else 0):>16.1f}')

print('\nЭкономика с гарантом (фарм-возврат при полной распродаже):')
for label, pn, pt in (('без гаранта', 0, 0), ('новинка /10 + топ /50', 10, 50)):
    e = s = 0
    for seed in (5, 6, 7):
        _, c = run(24, seed, pn, pt, max_packs=3000)
        cards = sum(c.cards.values())
        e += sum(S.QUICKSELL[g] * q for (b, g), q in c.cards.items()) + c.earned
        s += c.spent
    print(f'  {label:24} эмиссия/сток = {e/s*100:.1f}% (порог фарма — 100%)')
