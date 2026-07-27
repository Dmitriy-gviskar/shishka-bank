#!/bin/bash
# Бэкап БД Шишка Банк: локально (14 дней) + оффсайт на stukach-api + оффсайт в приватный GitHub-репо.
# Ставится cron'ом: 20 3 * * * /root/backup-shishka.sh
set -uo pipefail

# Безопасное чтение переменных из env-файла (без eval/export $(cat), который исполняет shell-инъекции)
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
  printf -v "$key" '%s' "$value"
done < /root/shishka-local-db.env
PROD_URL=$(echo "$LOCAL_URL" | sed "s|/shishka$|/shishka_prod|")
STAMP=$(date +%F)
LOG=/root/backup-shishka.log
TMP=/tmp/shishka-$STAMP.sql
REPO=/root/shishka-backups
OFFSITE_HOST="${BACKUP_OFFSITE_HOST:-217.114.8.162}"
OFFSITE="root@$OFFSITE_HOST:/root/shishka-offsite/"

log() { echo "$(date +'%F %T') $*" >> "$LOG"; }

# 1. Дамп (один раз, дальше расходится по трём местам)
if ! pg_dump "$PROD_URL" --no-owner > "$TMP" 2>>"$LOG"; then
  log "FAIL pg_dump — бэкапа за $STAMP НЕТ"
  rm -f "$TMP"
  exit 1
fi

# 2. Локальная сжатая копия, 14 дней
F=/root/backups/shishka-$STAMP.sql.gz
gzip -c "$TMP" > "$F"
ls -t /root/backups/*.gz | tail -n +15 | xargs -r rm --
log "OK локально $F ($(stat -c%s "$F") б)"

# 3. Оффсайт #1 — stukach-api (другой сервер, другой Beget-аккаунт).
#    Едут и база, и фото-отчёты детей по заданиям.
U=/root/backups/uploads-$STAMP.tar.gz
tar czf "$U" -C /opt/shishka uploads 2>>"$LOG" || log "WARN tar uploads"
ls -t /root/backups/uploads-*.tar.gz | tail -n +15 | xargs -r rm --
if scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 "$F" "$U" "$OFFSITE" 2>>"$LOG"; then
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 "$OFFSITE_HOST" \
    'ls -t /root/shishka-offsite/shishka-*.sql.gz | tail -n +15 | xargs -r rm --;
     ls -t /root/shishka-offsite/uploads-*.tar.gz | tail -n +15 | xargs -r rm --' 2>>"$LOG"
  log "OK stukach $STAMP (база + фото)"
else
  log "FAIL stukach $STAMP — копия НЕ уехала"
fi

# 4. Оффсайт #2 — приватный GitHub-репо. Дамп кладём несжатым: git хранит дельты,
#    история коммитов = машина времени по дням.
#    Фото-отчёты по заданиям едут туда же: они append-only, поэтому без --delete —
#    если на VPS папку почистят, из бэкапа снимки не пропадут.
#    ВАЖНО: репо обязан быть приватным — в дампе имена реальных детей.
#    Если задан BACKUP_GPG_KEY — дамп шифруется перед коммитом (gpg --encrypt).
DEST="$REPO/shishka.sql"
if [[ -n "${BACKUP_GPG_KEY:-}" ]]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_KEY" -o "$DEST.gpg" "$TMP" 2>>"$LOG" && DEST="$DEST.gpg" || log "WARN gpg encrypt — кладём открытым"
else
  cp "$TMP" "$DEST"
fi
mkdir -p "$REPO/uploads"
rsync -a /opt/shishka/uploads/ "$REPO/uploads/" 2>>"$LOG" || log "WARN uploads не скопировались"
cd "$REPO" || exit 1
git add -A
if git diff --cached --quiet; then
  log "OK github $STAMP (данные не менялись, коммит не нужен)"
elif git commit -q -m "backup $STAMP" && git push -q origin main 2>>"$LOG"; then
  log "OK github $STAMP"
else
  log "FAIL github $STAMP — копия НЕ уехала"
fi

rm -f "$TMP"
