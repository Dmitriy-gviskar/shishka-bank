#!/bin/bash
# Генерит ассет и сразу срезает фон. Usage: gen_asset.sh <payload.json> <name>
DIR=~/Desktop/shishka-bank
bash "$DIR/gen.sh" "$1" "$2"
F="$DIR/$2.png"
if [ -s "$F" ]; then
  python3 "$DIR/assets/debg.py" "$F" "${F%.png}_cut.png"
else
  echo "no image to cut for $2"
fi
