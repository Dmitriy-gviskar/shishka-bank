#!/usr/bin/env python3
"""Срезает фон-шахматку (серо-белую) или однотонный светлый фон с ассета.
Фон = светлые near-серые пиксели (R≈G≈B, яркие); объект — насыщенно-цветной
с тёмной обводкой. Оставляем только компоненту фона, связную с краями,
чтобы не пробить светлые детали внутри объекта. Только PIL.
Usage: python3 debg.py <in.png> [out.png]"""
import sys
from collections import deque
from PIL import Image

inp = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else inp.rsplit('.', 1)[0] + '_cut.png'

im = Image.open(inp).convert('RGBA')
w, h = im.size
px = im.load()

def is_bg(x, y):
    # фон-шахматка ахроматична (R≈G≈B) при любой яркости; объект — хроматичный
    # (коричневая обводка, зелень, золото). Яркость НЕ проверяем: клетки бывают
    # и тёмные, и светлые.
    r, g, b, a = px[x, y]
    return max(r, g, b) - min(r, g, b) <= 28

# BFS от всех краевых пикселей, помечаем фон связный с краями
seen = [[False] * w for _ in range(h)]
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if is_bg(x, y) and not seen[y][x]:
            seen[y][x] = True; q.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if is_bg(x, y) and not seen[y][x]:
            seen[y][x] = True; q.append((x, y))
cut = 0
while q:
    x, y = q.popleft()
    px[x, y] = (0, 0, 0, 0); cut += 1
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(nx, ny):
            seen[ny][nx] = True; q.append((nx, ny))

# второй проход: глобально убрать оставшиеся near-gray клетки (запертые внутри
# белой стикер-окантовки) и саму светлую окантовку — силуэт становится чистым
if len(sys.argv) > 3 and sys.argv[3] == 'global':
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and is_bg(x, y):
                px[x, y] = (0, 0, 0, 0); cut += 1

# третий проход (при 'global'): убрать светлую стикер-окантовку по краю силуэта —
# near-white пиксели, граничащие с уже прозрачными; 2 итерации
if len(sys.argv) > 3 and sys.argv[3] == 'global':
    for _ in range(2):
        rim = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a and (max(r, g, b) - min(r, g, b) <= 40) and ((r + g + b) / 3 >= 222):
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                            rim.append((x, y)); break
        for x, y in rim:
            px[x, y] = (0, 0, 0, 0); cut += 1

im.save(out)
print(f"{out}: {w}x{h}, вырезано фона={cut} ({100*cut//(w*h)}%)")
