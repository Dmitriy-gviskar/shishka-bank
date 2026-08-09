"""Средний размер карт для диалогов, игр и модалок (~480 px).
Full (896×1200) — только крупный просмотр / эволюция / jackpot.
Thumb (200 px) — сетки. Запуск: python3 tools/make_md.py [--force]"""
import sys
import pathlib
from PIL import Image

SRC = pathlib.Path('client/assets/cards')
DST = SRC / 'md'
WIDTH = 480
QUALITY = 78


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
        if made % 100 == 0:
            print(f'  …{made}')
    print(f'md: создано {made}, пропущено {skipped}')
    if src_bytes:
        print(f'оригиналы {src_bytes/1024/1024:.1f} МБ → md {dst_bytes/1024/1024:.1f} МБ '
              f'({dst_bytes/src_bytes*100:.0f}% веса)')


if __name__ == '__main__':
    main()
