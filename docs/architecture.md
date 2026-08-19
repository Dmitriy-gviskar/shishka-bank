# Архитектура Шишка Банк

## Обзор

Монолитное Node.js-приложение: веб-клиент (PWA) + сервер-прокси → PostgreSQL.
Дети взаимодействуют через PWA на телефоне, родители — через веб-кабинет или Telegram.
Ведущий (вожатый) — через дашборд `admin.html`.

## Поток запроса

```
Ребёнок (PWA)                  Сервер (Node.js)               PostgreSQL
    │                               │                             │
    ├─ fetch('/api/state') ────────►│                             │
    │  x-child-code: ABC123         │                             │
    │                               ├─ auth.resolve(req) ────────►│
    │                               │  SELECT child_id FROM       │
    │                               │  child_logins WHERE code=$1 │
    │                               │◄────── {child, circle} ─────┤
    │                               │                             │
    │                               ├─ rate-limit check           │
    │                               ├─ security headers (CSP,...) │
    │                               ├─ q('SELECT ...') ──────────►│
    │                               │◄──────── rows ──────────────┤
    │◄────── JSON ──────────────────┤                             │
```

## Слои

### Клиент (`client/`)
- **21 HTML-экран**: SPA-навигация через `nav.js` → fetch + DOM replace
- **`app.js`**: единая точка входа, API-клиент со stale-while-revalidate кэшем
- **Service Worker** (`sw.js`): офлайн-кэш (v17), push-уведомления
- **PWA**: `manifest.json`, иконки, установка на домашний экран

### Сервер (`client/server-pg.mjs`)
- **HTTP**: Node.js `http.createServer`, один порт (3777)
- **Кластеризация**: `server-cluster.mjs` → master + N workers
- **Роутинг**: `method + pathname` → handler в объекте `api`
- **Auth**: `lib/auth.mjs` — коды входа (6-симв.), токены устройств, сессии взрослых
- **Rate-limit**: два уровня — жёсткий для PIN/входа (10 попыток → лок 10 мин), мягкий для детей (100 запр/10с)
- **Static**: `lib/http.mjs` — CSP, nosniff, frame guard, CORS, path traversal guard
- **Push**: `sendPush()` через Web Push API (web-push + VAPID)

### База данных (`db/`)
- **PostgreSQL 16** на VPS (localhost)
- **~30 таблиц**: users, wallets, transactions, tasks, shops, auctions, guilds, cards...
- **RPC-функции** (`functions.sql`): transfer_cones, open_safe, create_auction, approve_task...
- **Миграции**: schema.sql (источник правды) + migration_*.sql

## Модель безопасности

| Уровень | Механизм |
|---------|----------|
| Транспорт | TLS (nginx → Let's Encrypt), HSTS |
| HTTP-заголовки | CSP, X-Content-Type-Options, X-Frame-Options, CORS |
| Auth детей | 6-симв. криптослучайный код (алфавит без 0/O/1/I/L) |
| Auth ведущего | PIN из env (пустой PIN = кабинет закрыт) + rate-limit |
| Auth устройств | Токен устройства (SHA-256 хэш в БД, сырой у клиента) |
| Доступ к БД | Node-прокси (нет прямого доступа клиентов) |
| Изоляция семей | `circle_id` во всех запросах |
| Rate-limit | Per-IP: 10 попыток PIN → лок, 100 запр/10с → мягкий лок |
| Path traversal | Блок `../`, фильтр `.mjs/.env/.sql` |
| XSS | `esc()` на клиенте + обрезка тегов на сервере + CSP |

## Потоки данных

### Ребёнок выполняет задание
1. Открывает `quests.html` → `GET /api/tasks`
2. Нажимает «Готово» → `POST /api/task/done` → статус `pending_review`
3. Родитель в кабинете → `POST /api/parent/approve` → RPC `approve_task` → начисление шишек
4. Ребёнок получает push «✅ Задание одобрено»

### Перевод шишек
1. Выбирает друга → `POST /api/transfer` → RPC `transfer_cones`
2. Атомарно: списание + зачисление + запись в transactions
3. Получатель получает push «🎁 Подарок!»

## Переменные окружения

| Переменная | Назначение |
|-----------|-----------|
| `DATABASE_URL` | PostgreSQL (systemd unit) |
| `PARENT_PIN` | PIN родительского кабинета |
| `PORT` | Порт (default: 3777) |
| `VAPID_PRIVATE_KEY` | Приватный ключ для Web Push |
| `CLUSTER_WORKERS` | Число воркеров (default: все ядра) |

## Деплой

- **Ручной**: `rsync client/ → VPS` + `systemctl restart shishka`
- **CI/CD**: GitHub Actions (push main → test → deploy)
- **APK**: GitHub Actions (ветка `apk` → сборка Android WebView)
