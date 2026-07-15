# Эксплуатация прода

## Бэкапы

`backup-shishka.sh` лежит на прод-VPS как `/root/backup-shishka.sh` (chmod 700),
запускается cron'ом: `20 3 * * * /root/backup-shishka.sh`.

Один `pg_dump` расходится в три места, каждое пишет результат в `/root/backup-shishka.log`:

| Куда | Что | Глубина |
|---|---|---|
| сам VPS | `/root/backups/shishka-*.sql.gz` + `uploads-*.tar.gz` | 14 дней |
| stukach-api (217.114.8.162) | `/root/shishka-offsite/` — то же | 14 дней |
| приватный репо `Dmitriy-gviskar/shishka-backups` | `shishka.sql` + `uploads/` | вся история |

В git дамп кладётся **несжатым** намеренно: git хранит дельты, поэтому день стоит
копейки, а история коммитов = машина времени по дням.

Репо `shishka-backups` **обязан оставаться приватным** — в дампе имена реальных детей.

### Проверить, что бэкапы живы

```bash
ssh root@62.113.99.125 'tail -5 /root/backup-shishka.log'
```

Строки `FAIL` = копия не уехала. Скрипт намеренно не глушит ошибки (`|| true` в
прежней версии три дня молча скрывал, что ключа нет и оффсайта не существует).

## Если VPS умер — поднять с нуля

1. Новый сервер: Ubuntu, `apt install nodejs postgresql nginx rsync`
2. База: `createdb shishka_prod`, затем схема из бэкапа:
   ```bash
   git clone git@github.com:Dmitriy-gviskar/shishka-backups.git
   psql "<DATABASE_URL>" -f shishka-backups/shishka.sql
   ```
   Дамп тянет `auth.uid()` (наследие Supabase) — если база чистая, сначала:
   `create schema auth;` + заглушка `auth.uid() returns null::uuid`.
3. Фото: `cp -a shishka-backups/uploads/ /opt/shishka/uploads/`
4. Приложение: `client/` + `server-pg.mjs` + `npm i pg` в `/opt/shishka`
5. systemd-юнит с `Environment` = `DATABASE_URL` и `PARENT_PIN` (chmod 600),
   nginx → `127.0.0.1:3777`, certbot на домен
6. Вернуть бэкапы: этот скрипт в `/root/`, ssh-ключи (stukach + deploy key репо
   бэкапов), строку в cron

## Ключи на VPS

- `/root/.ssh/id_ed25519` — для scp на stukach-api
- `/root/.ssh/github_shishka_backups` — deploy key репо бэкапов (с правом записи),
  подключён через `Host github-shishka` в `/root/.ssh/config`
- `/root/shishka-local-db.env` (chmod 600) — `LOCAL_URL` с паролем базы
