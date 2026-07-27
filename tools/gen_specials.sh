#!/bin/bash
# Спец-карты генерим ПОСЛЕДОВАТЕЛЬНО: параллельные сабмиты Meshy отбивает (SUBMIT FAILED).
cd ~/Desktop/shishka-bank
for c in "$@"; do
  if [ -s "cards/special_$c.png" ]; then echo "SKIP $c (уже есть)"; continue; fi
  echo "=== $c"
  bash gen.sh "cards/payload_special_$c.json" "cards/special_$c" 2>&1 | tail -3
  sleep 4
done
echo "ГОТОВО"
