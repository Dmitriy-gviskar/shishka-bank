#!/usr/bin/env python3
"""Генератор волны карточек Шишка-Банка: beings.json -> payload -> gen.sh -> png.
Usage: python3 gen_wave.py beings_waveN.json [concurrency]

═══ РАБОЧИЙ МЕТОД (не переизобретать — полный разбор в docs/cards_art_method.md) ═══
Разнообразие держится на ДВУХ осях ОДНОВРЕМЕННО. Провалить любую = однотипность:

  1. ВНУТРИ существа — ПРОГРЕССИЯ по грейдам (GRADE_ENERGY ниже). Шесть карт растут
     от скромного приглушённого common к ослепительному золоту. НЕ одна палитра на все
     шесть (это даёт «одинаковые по цвету» — ошибка волны pro1).
  2. МЕЖДУ существами — разный МИР (b['world']) + разный ОБЩИЙ ТОН (b['tone']).
     Не все тёмно-неоновые: одно светлое-дневное, другое ночное, третье закатное.
     Мир = профессия/вселенная, грейды = рост В НЕЙ, а не единый RPG-класс на всех.

Держать всегда: узнаваемость существа сквозь 6 карт, свой золотой финал (не крылатый
ангел по шаблону), no-text, формат 3:4, анти-коллаж. Цвет ранга — ТОЛЬКО на рамке.

Формат существа: code, name, cat, ident, world, tone, scenes[6].
"""
import json, os, subprocess, sys, threading, queue

ROOT = os.path.expanduser("~/Desktop/shishka-bank")
GRADES = ["1_common", "2_uncommon", "3_rare", "4_epic", "5_legendary", "6_gold"]

# ОСЬ 1 — прогрессия ВНУТРИ существа. ТРИ слоя, все обязательны:
#  (a) GRADE_STAGE — РАЗВИТИЕ ПЕРСОНАЖА: новичок→подмастерье→умелец→мастер→легенда→божество.
#      Растут снаряжение, поза, статус, аура, масштаб — видно, что герой ПРОКАЧИВАЕТСЯ.
#      Ступени универсальны, но НАПОЛНЯЮТСЯ миром существа через scenes (у водолаза: юнга→
#      ныряльщик→водолаз→капитан→первооткрыватель→левиафан). Это НЕ единый RPG-класс «маг→
#      рыцарь→бог» — суть ступени (рост статуса) одна, воплощение у каждого своё.
#  (b) GRADE_COLOR — ДОМИНИРУЮЩИЙ ЦВЕТ грейда меняется (радуга рангов из эталона burunduk_v2).
#      Даёт разноцветность шести карт. НЕ фиксировать один тон на существо (ошибка pro1/probe).
#  Разнообразие МЕЖДУ героями держим разными world/scenes (мир/профессия/сюжет).
# ⚠️ БЕЗ числовых меток «STAGE N/6» и слов-ярлыков капсом внутри рамки — nano-banana
# впаивает их как надпись на карту (как «MYTHIC»/«TIER» в прошлых волнах). Только описание.
GRADE_STAGE = [
    "a young rookie just starting out: small and humble, simple or no gear, a shy-curious pose, modest scale",
    "an apprentice finding their feet: first basic starter gear, a little more confident, a bigger moment",
    "a skilled practitioner: proper working gear and a clear skill on display, a dynamic confident pose",
    "a seasoned master: rich detailed gear and insignia, a commanding heroic pose, a bold cinematic scene",
    "a living legend: ornate elite gear, a triumphant dramatic pose, epic climactic scale, a blazing aura",
    "an ascended god of this craft: the ultimate divine form, radiant regalia and a crown, godlike and awe-inspiring",
]
GRADE_COLOR = [
    "Dominant colour: the hero's own natural colours in a luminous neon-lit setting, muted and humble, low glow.",
    "Dominant colour: bright CYAN-and-LIME neon glow.",
    "Dominant colour: electric BLUE-and-TEAL neon energy with holographic shimmer.",
    "Dominant colour: intense PURPLE-MAGENTA arcane neon.",
    "Dominant colour: blazing ACID-GREEN and molten ORANGE neon fire, explosive light rays.",
    "Dominant colour: dazzling GOLD and iridescent RAINBOW neon, blinding radiance.",
]
# Рамка держит цвет-код ранга (тонкий кант) — палитру АРТА не навязывает.
FRAME = [
    "Thin simple carved-wood card border (grey-slate rank accent only on the border itself).",
    "Thin leafy-green card border (green rank accent only on the border itself).",
    "Thin polished azure-crystal card border (blue rank accent only on the border itself).",
    "Thin ornate violet-rune card border (purple rank accent only on the border itself).",
    "Thin blazing-orange filigree card border (orange rank accent only on the border itself).",
    "Lavish jeweled rainbow holographic-foil card border (gold rank accent on the border).",
]
STYLE = ("Art style: high-end mobile gacha / TCG splash art, vibrant SATURATED acid-bright neon colours, "
         "glossy premium render, crisp cel-shading, punchy rim light, dramatic cinematic lighting, hyper-stylish, high detail. "
         "NOT watercolor, NOT childish. Vertical trading-card 3:4. Varied dynamic camera, avoid a flat centered front pose. "
         "ONE single full-bleed illustration filling the whole card, NO card-inside-card, NO card in a glass case, "
         "NO multiple cards, NO grid or collage, NO panels. "
         "ABSOLUTELY NO text, no letters, no words, no numbers, no title, no banner, no text plate.")


def prompt(b, i):
    # Разнообразие ВНУТРИ героя = GRADE_ENERGY (масштаб) + GRADE_COLOR (цвет грейда, радуга рангов).
    # Разнообразие МЕЖДУ героями = b['world'] (свой мир/профессия) + b['scenes'] (свой сюжет).
    return (f"{b['ident']} Recognizable same character across all six cards, but clearly LEVELLED-UP each grade. "
            f"World (its own universe/profession): {b['world']}. "
            f"{GRADE_STAGE[i]}. Scene: {b['scenes'][i]} "
            f"{GRADE_COLOR[i]} "
            f"{FRAME[i]} {STYLE}")


def main():
    beings = json.load(open(sys.argv[1]))
    conc = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    jobs = []
    for b in beings:
        for i, g in enumerate(GRADES):
            name = f"cards/{b['code']}_{g}"
            if os.path.exists(f"{ROOT}/{name}.png"):
                continue
            p = f"{ROOT}/cards/payload_{b['code']}_{g}.json"
            json.dump({"ai_model": "nano-banana-pro", "aspect_ratio": "3:4", "prompt": prompt(b, i)},
                      open(p, "w"), ensure_ascii=False, indent=2)
            jobs.append((p, name))
    print(f"задач: {len(jobs)} (кредитов ~{len(jobs)*9})", flush=True)

    q = queue.Queue()
    for j in jobs:
        q.put(j)
    lock = threading.Lock()
    done = [0]

    def worker():
        while True:
            try:
                p, name = q.get_nowait()
            except queue.Empty:
                return
            for attempt in (1, 2):
                r = subprocess.run(["bash", f"{ROOT}/gen.sh", p, name],
                                   capture_output=True, text=True, timeout=900)
                ok = os.path.exists(f"{ROOT}/{name}.png") and os.path.getsize(f"{ROOT}/{name}.png") > 1000
                if ok:
                    break
                tail = r.stdout.strip().splitlines()[-1:] or [r.stderr.strip()[-200:]]
                with lock:
                    print(f"RETRY {name} #{attempt}: {tail}", flush=True)
            with lock:
                done[0] += 1
                print(f"[{done[0]}/{len(jobs)}] {'OK' if ok else 'FAIL'} {name}", flush=True)

    ts = [threading.Thread(target=worker) for _ in range(conc)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    print("ВОЛНА ГОТОВА", flush=True)


main()
