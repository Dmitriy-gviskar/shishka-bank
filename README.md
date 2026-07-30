# Шишка Банк 🌲

Детское приложение финансовой грамотности. Цифровой слой над живой экономической игрой в лесу: кошелёк, переводы, задания, магазин, аукционы, лавки, гильдии.

**Продакшн:** https://elka-kvest-2026.ru

## Стек

| Слой | Технология |
|------|-----------|
| Клиент | Vanilla HTML/CSS/JS, PWA (service worker), SPA-навигация |
| Сервер | Node.js 18+, `server-pg.mjs` (прод), `server.mjs` (дев/SQLite) |
| База данных | PostgreSQL 16 (прод), SQLite `:memory:` (дев) |
| Хостинг | VPS Ubuntu, nginx + Let's Encrypt, systemd |
| APK | Android WebView wrapper, GitHub Actions сборка |

## Быстрый старт (локально)

```bash
cd client

# Дев-сервер (SQLite в памяти, без БД):
node --experimental-sqlite server.mjs
# → http://localhost:3777

# Прод-сервер (PostgreSQL):
DATABASE_URL="postgres://user:pass@host:5432/db" node server-pg.mjs
# → http://localhost:3777

# Тесты:
npm test
```

## Переменные окружения

| Переменная | Назначение | По умолчанию |
|-----------|-----------|-------------|
| `DATABASE_URL` | Строка подключения PostgreSQL | обязательно |
| `PARENT_PIN` | PIN родительского кабинета | опционально (если не задан — вход без пароля) |
| `PORT` | Порт сервера | 3777 |
| `TELEGRAM_BOT_TOKEN` | Токен бота для алертов | — |
| `TELEGRAM_CHAT_ID` | ID чата для алертов | — |

## Структура проекта

```
shishka-bank/
├── client/               # Веб-приложение (PWA)
│   ├── *.html            # Экраны (21 страница)
│   ├── app.js            # Основная логика клиента + API
│   ├── nav.js            # SPA-навигация + нижний навбар
│   ├── sw.js             # Service Worker (офлайн-кэш)
│   ├── style.css         # Стили
│   ├── cards.js          # Логика коллекционных карточек
│   ├── server-pg.mjs     # Прод-сервер (PostgreSQL)
│   ├── server.mjs        # Дев-сервер (SQLite)
│   ├── lib/
│   │   ├── auth.mjs      # Авторизация (коды, токены, сессии)
│   │   └── http.mjs      # HTTP-слой (статика, заголовки, JSON)
│   └── assets/           # Иконки, ассеты, скины
├── db/                   # База данных
│   ├── schema.sql        # Схема (источник правды)
│   ├── functions.sql     # RPC-функции
│   ├── rls.sql           # Row Level Security (для Supabase)
│   ├── cards.sql         # Карточки-шишки (гача)
│   ├── seed.sql          # Тестовые данные
│   ├── migration_*.sql   # Миграции
│   └── gen_*.mjs         # Генераторы контента
├── tests/                # Тесты (node:test)
│   ├── core.test.mjs     # Баланс, переводы, задания, покупки
│   ├── cards.test.mjs    # Карточки: паки, слияния, рынок
│   ├── security.test.mjs # Безопасность: XSS, rate-limit, auth
│   ├── context.test.mjs  # Контекст авторизации
│   └── helpers/          # DB fixture + server starter
├── ops/                  # Эксплуатация
│   ├── backup-shishka.sh # Бэкап: локально + оффсайт + GitHub
│   ├── health-alert.sh   # Health-check → Telegram алерты
│   ├── apply_migrations.sh # Применение миграций на прод
│   └── README.md         # Инструкция по восстановлению
├── android/              # Android APK (WebView)
├── cards/                # Ассеты карточек (изображения)
├── content/              # Каталоги: задания, подарки, достижения
├── tools/                # Утилиты (симуляции, скоринг)
└── mockups/              # Дизайн-макеты
```

## Деплой

### Ручной
```bash
rsync -az client/ root@VPS:/opt/shishka/ --exclude 'node_modules/' --exclude 'uploads/'
ssh root@VPS 'systemctl restart shishka'
```

### Автоматический (GitHub Actions)
Push в `main` → `.github/workflows/deploy.yml` → rsync на VPS → restart.
Требует секретов: `VPS_SSH_KEY`, `VPS_HOST`.

## Применение миграций

```bash
# На VPS:
cd /opt/shishka
source /root/shishka-local-db.env
PROD_URL=$(echo "$LOCAL_URL" | sed 's|/shishka$|/shishka_prod|')
psql "$PROD_URL" -f db/migration_xxx.sql
```

Или одним скриптом: `bash ops/apply_migrations.sh`

## Мониторинг

- `GET /api/ping` → `{"ok":true,"db":"ok","uptime":3600}`
- Health-check алерты: `ops/health-alert.sh` (каждую минуту через cron)
- Логи: `journalctl -u shishka -f`

## Лицензия

Приватный проект. Все права защищены.
