# Публикация FlowDesk

## Состояние поставки

Базовая версия опубликована: https://flowdesk-alpha-teal.vercel.app, исходники: https://github.com/meowzie081/flowdesk. Обновление email/Web Push и обучения подготовлено в исходниках. Если 0001–0013 уже применены, выполните только `0014_delivery_onboarding.sql`, затем опубликуйте код. Настройка внешней доставки и отдельного Cron: [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Текущая схема Vercel + Supabase

Веб-приложение работает на Vercel, данные, Auth, Storage и Realtime — в Supabase. Supabase Cron вызывает `public.run_due_recurring()` каждую минуту. Для этой схемы не нужен постоянный Docker scheduler. Build Command в Vercel: `npm run typecheck && npm test && npm run test:db && npm run build`.

Инструкции ниже для VPS остаются альтернативным вариантом размещения.

При размещении на VPS Docker Compose запускает `web` и постоянный `scheduler`. Этот вариант использует Linux VPS и внешний Supabase. База и Storage не хранятся в контейнерах приложения.

## 1. Публичный GitHub

В корне распакованного `flowdesk`:

```bash
git init -b main
git add .
git commit -m "Prepare FlowDesk application, analytics and deployment"
```

На GitHub создайте пустой публичный репозиторий. Затем используйте его реальный адрес:

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/flowdesk.git
git push -u origin main
```

`YOUR_ACCOUNT` — заменяемый пример, не адрес существующего проекта. Не добавляйте `.env`, приватные ключи, выгрузки БД и рабочие файлы пользователей. `.gitignore` исключает окружение, сборку и зависимости. Не публикуйте `.git` чужого проекта. Историю предыдущих изменений из ZIP восстановить нельзя; новые изменения оформляйте отдельными осмысленными коммитами.

## 2. Supabase

Создайте или используйте рабочий проект, выполните миграции `0001`–`0014` по порядку. Уже применённые миграции повторно не запускайте. В Auth укажите HTTPS Site URL приложения и redirect URL `https://ВАШ_ДОМЕН/auth/callback`. Для Google OAuth включите провайдера и настройте redirect URL Supabase в Google Cloud.

## 3. Сервер и HTTPS

Требуются Linux VPS, Docker Engine, Compose v2 с `up --wait`, Caddy и домен с DNS A/AAAA на сервер. SSH-пользователь должен иметь доступ к Docker и каталогу `/opt/flowdesk`. Docker-доступ даёт широкие права на сервер: используйте отдельного пользователя деплоя.

На сервере один раз создайте `/opt/flowdesk/shared` и `/opt/flowdesk/releases`, предоставив пользователю деплоя доступ к ним. Сохраните заполненный `.env` в `/opt/flowdesk/shared/.env`, установите права `600`.

Обязательные значения: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Для выбранного AI-провайдера добавьте ключ; для GA4 — `NEXT_PUBLIC_GA_ID`. Укажите `FLOWDESK_BIND_ADDRESS=127.0.0.1`, чтобы приложение слушало за Caddy, а не на публичном порту 3000.

Файл `Caddyfile` проксирует HTTPS на `127.0.0.1:3000`. Установите `FLOWDESK_DOMAIN` для сервиса Caddy или замените переменную в конфигурации на свой домен. Откройте 80/443 и SSH, проверьте DNS. Запускайте Caddy как отдельный системный сервис. Секреты приложения в Caddyfile не нужны.

## 4. GitHub Actions

Создайте GitHub Environment `production`.

Repository variables (Settings → Secrets and variables → Actions → Variables). `DEPLOY_ENABLED` задайте именно на уровне репозитория, чтобы условие job вычислялось до подключения Environment:

| Имя | Значение |
|---|---|
| `DEPLOY_ENABLED` | `true`, когда сервер подготовлен |
| `SITE_URL` | Реальный HTTPS origin приложения без завершающего пути |

Environment secrets:

| Имя | Значение |
|---|---|
| `DEPLOY_HOST` | DNS-имя или IPv4 сервера без протокола |
| `DEPLOY_USER` | SSH-пользователь деплоя |
| `DEPLOY_SSH_KEY` | Приватный ключ отдельного пользователя деплоя |
| `DEPLOY_KNOWN_HOSTS` | Строка host key сервера, сверенная с доверенным fingerprint |

Публичную часть SSH-ключа добавьте в `authorized_keys` сервера. Не отправляйте приватные ключи в чат и не коммитьте их. Порт SSH в подготовленном workflow — 22. IPv6-литерал требует адаптации SSH-адресации.

Workflow `.github/workflows/ci.yml`:

1. Для PR и `main`: установка, TypeScript, unit-тесты, SQL/RLS-тесты, production-сборка.
2. Деплой только из `main`, после успешного `check`, при `DEPLOY_ENABLED=true`.
3. Код из текущего commit передаётся архивом по SSH со строгой проверкой host key.
4. `scripts/deploy-vps.sh` собирает web и scheduler с серверным `.env`, ждёт healthcheck. Если обновление не запустилось, пытается восстановить предыдущую версию.
5. После запуска проверяется публичный `/api/health`.

`.env` остаётся вне release-каталогов. Релизы не удаляются автоматически. Сборка может требовать заметной памяти; состояние сервера контролирует владелец. Автоматические изменения схемы БД не выполняются. Откат контейнеров не откатывает миграции и не восстанавливает данные. Сбой публичного healthcheck делает workflow красным, но сам по себе не откатывает успешно запущенный контейнер.

## 5. Ссылки в README

После реальной публикации:

```bash
SITE_URL=https://YOUR_DOMAIN REPOSITORY_URL=https://github.com/YOUR_ACCOUNT/flowdesk node scripts/project-links.mjs
git add README.md
git commit -m "Document production and repository URLs"
git push
```

Скрипт проверяет формат адресов и заменяет блок ссылок. Он не проверяет доступность сервиса. Не подставляйте выдуманный адрес в отчёт или презентацию.

## 6. Приёмка

Проверьте `/api/health`, HTTPS, регистрацию/вход, Google OAuth, две сессии чата, приватность файлов другого отдела, создание пользователя владельцем, выполнение повторения scheduler и GA4 Realtime. `/api/health` подтверждает работу web-процесса, а не всей цепочки Supabase/Storage/AI.

## Vercel и планировщик

В текущей Vercel-установке постоянный Docker `scheduler` заменён Supabase Cron. Не запускайте второй планировщик без необходимости. Для автоматической публикации используйте подключённый GitHub-репозиторий и Build Command с проверками, указанный выше. VPS workflow нужен только при выборе VPS.

Источники: https://docs.github.com/en/actions ; https://docs.docker.com/reference/cli/docker/compose/up/ ; https://caddyserver.com/docs/quick-starts/reverse-proxy
