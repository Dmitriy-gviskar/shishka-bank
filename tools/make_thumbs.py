"""Превью карт для сеток альбома и рынка (200 px).
Full — крупный просмотр / evo / jackpot. Средний размер: tools/make_md.py (480 px).
Запуск: python3 tools/make_thumbs.py [--force]"""
import sys, pathlib
from PIL import Image

SRC = pathlib.Path('client/assets/cards')
DST = SRC / 'thumb'
WIDTH = 200          # с запасом под ретину: в сетке карта не шире 76 CSS px
QUALITY = 72

def main():
    force = '--force' in sys.argv
    DST.mkdir(exist_ok=True)
    made = skipped = 0
    src_bytes = dst_bytes = 0
    for f in sorted(SRC.glob('*.webp')):
        out = DST / f.name
        src_bytes += f.stat().st_size
        if out.exists() and not force:
            dst_bytes += out.stat().st_size
            skipped += 1
            continue
        im = Image.open(f)
        h = round(im.height * WIDTH / im.width)
        im.resize((WIDTH, h), Image.LANCZOS).save(out, 'WEBP', quality=QUALITY, method=6)
        dst_bytes += out.stat().st_size
        made += 1
    print(f'превью: создано {made}, пропущено {skipped}')
    print(f'оригиналы {src_bytes/1024/1024:.1f} МБ → превью {dst_bytes/1024/1024:.1f} МБ '
          f'({dst_bytes/src_bytes*100:.0f}% веса)')

if __name__ == '__main__':
    main()
