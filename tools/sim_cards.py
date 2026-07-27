"""Симуляция экономики Лесной коллекции: считаем нетто-эмиссию шишек на пак
до и после механик v3 (топливо, обменная полка, бонус двойной эволюции).

Правила берутся 1-в-1 из db/cards.sql:
  веса 50/27/13/6/3/1, пак 45 шишек = 7 карт, quicksell 1/2/5/15/40/100,
  merge 3 своих -> +1 (5% -> +2, не выше 5), топливо 2 своих + 4 любых -> +1,
  обмен 5 излишков -> 1 карта того же ранга, которой нет,
  награды: существо целиком +50, категория целиком +200, всё +1000.
"""
import random
from collections import defaultdict

WEIGHTS = [50, 27, 13, 6, 3, 1]            # грейды 1..6
QUICKSELL = {1: 1, 2: 2, 3: 3, 4: 8, 5: 20, 6: 50}   # пересчитано 22.07 (было 1/2/5/15/40/100)
NOMINAL = {1: 1, 2: 3, 3: 10, 4: 40, 5: 150, 6: 1000}
PACK_PRICE, PACK_CARDS = 45, 7
# 121 существо: 46 зверей, 40 растений, 35 насекомых
CATEGORIES = {'zver': 46, 'rastenie': 40, 'nasekomoe': 35}
BEINGS = [(cat, i) for cat, n in CATEGORIES.items() for i in range(n)]
GRADES = [1, 2, 3, 4, 5, 6]


def roll_grade(rnd):
    r = rnd.random() * sum(WEIGHTS)
    acc = 0
    for g, w in zip(GRADES, WEIGHTS):
        acc += w
        if r < acc:
            return g
    return 1


class Child:
    """Ребёнок, который собирает альбом: копит недостающее, лишнее пускает в дело."""

    def __init__(self, rnd, v3):
        self.rnd = rnd
        self.v3 = v3                      # доступны ли топливо/обмен/бонус
        self.cards = defaultdict(int)     # (being, grade) -> qty
        self.earned = 0                   # эмиссия: quicksell + награды
        self.spent = 0                    # сток: паки
        self.rewards_paid = set()
        self.merges = self.fuels = self.exchanges = self.bonuses = 0

    # ── вспомогательное ──
    def qty(self, being, grade):
        return self.cards[(being, grade)]

    def add(self, being, grade, n=1):
        self.cards[(being, grade)] += n

    def take(self, being, grade, n=1):
        self.cards[(being, grade)] -= n
        if self.cards[(being, grade)] <= 0:
            del self.cards[(being, grade)]

    def spare(self, grade):
        """излишки ранга (сверх одного экземпляра в ячейке) — то, что не жалко жечь"""
        return sum(max(0, q - 1) for (b, g), q in self.cards.items() if g == grade)

    # ── действия ──
    def open_pack(self):
        self.spent += PACK_PRICE
        for _ in range(PACK_CARDS):
            self.add(self.rnd.choice(BEINGS), roll_grade(self.rnd))

    def do_merges(self):
        """3 своих одного ранга -> ранг выше (5% бонус +2, не выше 5)"""
        moved = True
        while moved:
            moved = False
            for (being, grade), q in list(self.cards.items()):
                if grade >= 6 or q < 3:
                    continue
                self.take(being, grade, 3)
                new_g = grade + 1
                if grade + 2 <= 5 and self.rnd.random() < 0.05:
                    new_g, self.bonuses = grade + 2, self.bonuses + 1
                self.add(being, new_g)
                self.merges += 1
                moved = True

    def do_fuel(self):
        """2 своих + 4 излишка того же ранга -> ранг выше (жжём только дубли)"""
        if not self.v3:
            return
        moved = True
        while moved:
            moved = False
            for (being, grade), q in list(self.cards.items()):
                if grade >= 6 or q != 2:
                    continue
                fuel = sum(max(0, qq - 1) for (b, g), qq in self.cards.items()
                           if g == grade and b != being)
                if fuel < 4:
                    continue
                need = 4
                for (b, g), qq in sorted(self.cards.items(), key=lambda kv: -kv[1]):
                    if need <= 0:
                        break
                    if g != grade or b == being or qq < 2:
                        continue
                    take = min(qq - 1, need)
                    self.take(b, g, take)
                    need -= take
                self.take(being, grade, 2)
                self.add(being, grade + 1)
                self.fuels += 1
                moved = True

    def do_exchange(self):
        """5 излишков ранга -> карта того же ранга, которой ещё нет"""
        if not self.v3:
            return
        for grade in GRADES:
            while self.spare(grade) >= 5:
                missing = [b for b in BEINGS if self.qty(b, grade) == 0]
                if not missing:
                    break
                need = 5
                for (b, g), qq in sorted(self.cards.items(), key=lambda kv: -kv[1]):
                    if need <= 0:
                        break
                    if g != grade or qq < 2:
                        continue
                    take = min(qq - 1, need)
                    self.take(b, g, take)
                    need -= take
                self.add(self.rnd.choice(missing), grade)
                self.exchanges += 1

    def do_quicksell(self):
        """продаём банку то, что осталось лишним после слияний и обмена (эмиссия шишек)"""
        for (being, grade), q in list(self.cards.items()):
            extra = q - 1
            # оставляем запас на будущее слияние: пары не трогаем
            if extra <= 0 or q == 2:
                continue
            sell = extra - 1 if self.v3 else extra   # в v3 держим один дубль про запас
            if sell <= 0:
                continue
            self.take(being, grade, sell)
            self.earned += QUICKSELL[grade] * sell

    def do_rewards(self):
        full = [b for b in BEINGS if all(self.qty(b, g) > 0 for g in GRADES)]
        for b in full:
            key = ('being', b)
            if key not in self.rewards_paid:
                self.rewards_paid.add(key)
                self.earned += 50
        for cat, n in CATEGORIES.items():
            done = [b for b in full if b[0] == cat]
            if len(done) == n and ('cat', cat) not in self.rewards_paid:
                self.rewards_paid.add(('cat', cat))
                self.earned += 200
        if len(full) == len(BEINGS) and 'all' not in self.rewards_paid:
            self.rewards_paid.add('all')
            self.earned += 1000

    def turn(self):
        self.open_pack()
        self.do_merges()
        self.do_fuel()
        self.do_exchange()
        self.do_merges()
        self.do_quicksell()
        self.do_rewards()


def run(packs, v3, seed):
    rnd = random.Random(seed)
    c = Child(rnd, v3)
    for _ in range(packs):
        c.turn()
    return c


def report(packs, runs=200):
    print(f'\n=== {packs} паков на ребёнка, {runs} прогонов ===')
    for label, v3 in (('до v3 (merge+quicksell)', False), ('v3 (+топливо/обмен/бонус)', True)):
        agg = defaultdict(float)
        for s in range(runs):
            c = run(packs, v3, seed=1000 + s)
            agg['earned'] += c.earned
            agg['spent'] += c.spent
            agg['full'] += len([b for b in BEINGS if all(c.qty(b, g) > 0 for g in GRADES)])
            agg['cells'] += len(c.cards)
            agg['merges'] += c.merges
            agg['fuels'] += c.fuels
            agg['exch'] += c.exchanges
        e, sp = agg['earned'] / runs, agg['spent'] / runs
        print(f'{label}:')
        print(f'  эмиссия (quicksell+награды) {e:8.1f} · сток (паки) {sp:8.1f} '
              f'· НЕТТО {e - sp:+8.1f} шишек ({(e - sp) / packs:+.2f} на пак)')
        print(f'  возврат с пака {e / packs:5.2f} шишек (цена 45) · собрано существ целиком '
              f'{agg["full"] / runs:.2f} · заполнено ячеек {agg["cells"] / runs:.0f}/726')
        print(f'  слияний {agg["merges"] / runs:.1f} · с топливом {agg["fuels"] / runs:.1f} '
              f'· обменов {agg["exch"] / runs:.1f}')


if __name__ == '__main__':
    for packs in (50, 200, 600):
        report(packs, runs=120 if packs <= 200 else 40)


# ─────────── Худший случай: игрок, который не собирает альбом, а выжимает шишки ───────────
def farmer(packs, seed, use_merge=True):
    """Открывает паки и превращает карты в шишки максимально выгодно.
    Из всех преобразований выручку повышает только merge на грейде 3
    (3x5=15 против 0.95*15 + 0.05*40 = 16.25 с учётом 5% бонуса на +2 ранга).
    Топливо (6 карт -> 1) и обмен (5 карт -> 1) выручку только уменьшают."""
    rnd = random.Random(seed)
    pool = defaultdict(int)          # (being, grade) -> qty
    spent = packs * PACK_PRICE
    for _ in range(packs):
        for _ in range(PACK_CARDS):
            pool[(rnd.choice(BEINGS), roll_grade(rnd))] += 1
    earned = 0
    if use_merge:
        moved = True
        while moved:
            moved = False
            for (being, grade), q in list(pool.items()):
                if grade != 3 or q < 3:
                    continue
                pool[(being, grade)] -= 3
                new_g = 5 if rnd.random() < 0.05 else 4
                pool[(being, new_g)] += 1
                moved = True
    for (being, grade), q in pool.items():
        earned += QUICKSELL[grade] * q
    return earned, spent


def report_farmer(packs=2000, runs=40):
    print(f'\n=== ХУДШИЙ СЛУЧАЙ: фарм ради шишек, {packs} паков, {runs} прогонов ===')
    for label, use_merge in (('чистый quicksell', False), ('quicksell + выгодные merge', True)):
        e = s = 0
        for i in range(runs):
            a, b = farmer(packs, seed=7000 + i, use_merge=use_merge)
            e += a; s += b
        e, s = e / runs, s / runs
        print(f'{label}: возврат {e / packs:5.2f} шишек с пака (цена {PACK_PRICE}) '
              f'· нетто {(e - s) / packs:+5.2f} на пак · окупаемость {e / s * 100:.1f}%')


def report_fee(monthly_turnover=400, deals=10):
    print(f'\n=== Комиссия рынка как сток ===')
    fee = monthly_turnover // 10
    print(f'При обороте {monthly_turnover} шишек в месяц ({deals} сделок) банк изымает ~{fee} шишек/мес.')
    print(f'Это {fee / (30 * 35) * 100:.1f}% месячного дохода ребёнка (при типичных 35 шишках в день).')


if __name__ == '__main__':
    report_farmer()
    report_fee()
