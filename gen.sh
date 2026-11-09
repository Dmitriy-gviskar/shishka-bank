#!/bin/bash
# Usage: gen.sh <payload.json> <output-path-without-ext>  (path relative to project root)
DIR=~/Desktop/shishka-bank
KEY=$(cat ~/.config/shishka/meshy.key)
PAYLOAD="$1"
NAME="$2"
OUT="$DIR/$NAME"
mkdir -p "$(dirname "$OUT")"

RESP=$(curl -s -X POST https://api.meshy.ai/openapi/v1/text-to-image \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d @"$PAYLOAD")
TID=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("result",""))' 2>/dev/null)
if [ -z "$TID" ]; then echo "SUBMIT FAILED: $RESP"; exit 1; fi
echo "task=$TID name=$NAME"

for i in $(seq 1 100); do
  R=$(curl -s https://api.meshy.ai/openapi/v1/text-to-image/$TID -H "Authorization: Bearer $KEY")
  ST=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null)
  echo "poll $i: $ST"
  if [ "$ST" = "SUCCEEDED" ]; then
    URL=$(echo "$R" | python3 -c 'import sys,json;u=json.load(sys.stdin).get("image_urls",[]);print(u[0] if u else "")')
    CR=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("consumed_credits",""))')
    echo "$URL" > "$OUT.url"
    for t in 1 2 3; do
      curl -s -o "$OUT.png" "$URL"
      [ -s "$OUT.png" ] && break
    done
    if [ -s "$OUT.png" ]; then echo "SAVED $OUT.png (credits=$CR)"; else echo "DOWNLOAD FAILED, url in $OUT.url"; fi
    break
  fi
  if [ "$ST" = "FAILED" ] || [ "$ST" = "CANCELED" ]; then echo "GEN $ST: $R"; break; fi
  sleep 5
done
