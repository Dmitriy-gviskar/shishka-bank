#!/usr/bin/env python3
"""Нарезает горизонтальный ряд ассетов (после debg, фон уже прозрачен) на
отдельные PNG по вертикальным пустым (полностью прозрачным) колонкам-разделителям.
Usage: python3 slice_row.py <cut.png> <out_prefix> [expected_count]"""
import sys
from PIL import Image

inp = sys.argv[1]
prefix = sys.argv[2]
expected = int(sys.argv[3]) if len(sys.argv) > 3 else 0

im = Image.open(inp).convert('RGBA')
w, h = im.size
alpha = im.getchannel('A')
apx = alpha.load()
# сумма альфы по столбцам
colsum = [sum(apx[x, y] for y in range(h)) for x in range(w)]
thr = max(colsum) * 0.01  # шум-порог
# найти сегменты непустых колонок
segs = []
x = 0
while x < w:
    if colsum[x] > thr:
        s = x
        while x < w and colsum[x] > thr:
            x += 1
        segs.append((s, x))
    else:
        x += 1
# отфильтровать слишком узкие (артефакты)
segs = [s for s in segs if s[1] - s[0] > w * 0.03]
segs.sort(key=lambda s: s[1] - s[0], reverse=True)
if expected:
    segs = segs[:expected]
segs.sort()
print(f"найдено сегментов: {len(segs)}")
for i, (s, e) in enumerate(segs):
    crop = im.crop((s, 0, e, h))
    bb = crop.getbbox()  # обрезать по вертикали тоже
    if bb:
        crop = crop.crop(bb)
    out = f"{prefix}_{i+1}.png"
    crop.save(out)
    print(f"  {out}: {crop.size}")
