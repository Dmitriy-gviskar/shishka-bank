#!/bin/bash
# Health-check Шишка Банк: пингует /api/ping, при 3 отказах подряд шлёт алерт в Telegram.
# Запуск: каждую минуту через cron или systemd timer.
# Требует: TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в /root/shishka-telegram.env
set -uo pipefail

STATE_FILE=/tmp/shishka-health.state
LOG=/var/log/shishka-health.log
PING_URL="${HEALTH_URL:-http://127.0.0.1:3777/api/ping}"
ALERT_EVERY=1800  # повторять алерт не чаще раза в 30 минут

source /root/shishka-telegram.env 2>/dev/null || true
BOT="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_CHAT_ID:-}"

send_alert() {
  local msg="$1"
  [ -z "$BOT" ] || [ -z "$CHAT" ] && return
  curl -s -X POST "https://api.telegram.org/bot$BOT/sendMessage" \
    -d "chat_id=$CHAT" -d "text=$msg" -d "parse_mode=HTML" > /dev/null
}

now=$(date +%s)
fails=0 last_ok=0 last_alert=0
[ -f "$STATE_FILE" ] && source "$STATE_FILE"

# Пинг
if curl -sf --max-time 5 "$PING_URL" > /dev/null 2>&1; then
  if [ "$fails" -ge 1 ]; then
    echo "$(date -Iseconds) RECOVERY после $fails отказов" >> "$LOG"
  fi
  fails=0
  last_ok=$now
else
  fails=$((fails + 1))
  echo "$(date -Iseconds) FAIL #$fails" >> "$LOG"
  if [ "$fails" -ge 3 ] && [ $((now - last_alert)) -ge $ALERT_EVERY ]; then
    msg="🚨 <b>Шишка Банк упал!</b>%0A%0A${fails} отказов подряд.%0AВремя: $(date '+%H:%M:%S')%0AСервер: $(hostname)"
    send_alert "$msg"
    last_alert=$now
    echo "$(date -Iseconds) ALERT SENT" >> "$LOG"
  fi
fi

# Сохраняем состояние
cat > "$STATE_FILE" <<EOF
fails=$fails
last_ok=$last_ok
last_alert=$last_alert
EOF
