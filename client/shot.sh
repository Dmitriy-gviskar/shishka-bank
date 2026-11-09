#!/bin/bash
# Скриншот экрана: shot.sh <file.html> <out.png>. Chrome headless (свой профиль) + crop телефона.
DIR=~/Desktop/shishka-bank/client
HTML="$1"; OUT="$2"
PROF="/private/tmp/chrome-sb-$$"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --force-device-scale-factor=2 --window-size=780,1688 \
  --user-data-dir="$PROF" --screenshot="$DIR/_raw.png" "file://$DIR/$HTML" >/dev/null 2>&1 &
CPID=$!
for i in $(seq 1 15); do [ -s "$DIR/_raw.png" ] && break; sleep 1; done
sleep 1
for p in $(pgrep -f "chrome-sb-$$"); do kill "$p" 2>/dev/null; done
python3 -c "
from PIL import Image
im=Image.open('$DIR/_raw.png')
im.crop((390,0,1170,1688)).save('$DIR/$OUT')
print('$OUT', Image.open('$DIR/$OUT').size)
"
rm -rf "$PROF" "$DIR/_raw.png"
