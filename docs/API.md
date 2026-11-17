# Публичный API FlowDesk (v1) и вебхуки

API позволяет скриптам и интеграциям работать с досками и задачами ваших отделов, а вебхуки — получать события отдела на ваш HTTPS-адрес.

## Что нужно для включения

1. Миграция `0024_api_webhooks.sql` в Supabase SQL Editor (после 0001–0023).
2. `SUPABASE_SERVICE_ROLE_KEY` в серверных переменных (Vercel → Environment Variables). Без него API отвечает 401, а очередь вебхуков не доставляется.
3. Для доставки вебхуков — тот же планировщик, что и для уведомлений: `NOTIFICATION_CRON_SECRET` и cron из [NOTIFICATIONS.md](NOTIFICATIONS.md). Воркер вебхуков вызывается шагом «Webhook delivery» в `.github/workflows/cron.yml` (раз в 5 минут). Без планировщика события копятся в очереди и доставятся после его включения.

## Токены

Профиль → «API-токены» → «Создать токен». Токен показывается **один раз**; в базе хранится только его sha256-хеш. До 5 токенов на пользователя. «Отозвать» мгновенно отключает токен.

Токен персональный: запросы выполняются с правами вашей роли в каждом отделе (owner/member — чтение и запись, viewer — только чтение). Отделы, где вы не состоите или доступ приостановлен, недоступны. Лимиты тарифа на число досок действуют и для API.

Заголовок авторизации:

```
Authorization: Bearer fd_ВАШ_ТОКЕН
```

Лимит запросов: 120 в минуту на токен; при превышении — `429` с `Retry-After`. Ответы не кешируются (`Cache-Control: no-store`).

## Формат ответов

Успех: объект (`{"task": …}`) или список (`{"data": […]}`). Ошибка: `{"error": "текст"}` с кодом 400/401/403/404/429/500. Базовый адрес: `https://flowdesk-alpha-teal.vercel.app` (или ваш домен).

## Маршруты

| Метод и путь | Действие |
| --- | --- |
| `GET /api/v1/departments` | Отделы, где вы состоите (id, name, role) |
| `GET /api/v1/departments/{depId}/boards` | Доски отдела |
| `POST /api/v1/departments/{depId}/boards` | Создать доску: `{name, columns?}`; без columns — Backlog/В работе/Ревью/Готово |
| `GET /api/v1/boards/{boardId}` | Доска и её колонки |
| `PATCH /api/v1/boards/{boardId}` | Переименовать: `{name}` |
| `DELETE /api/v1/boards/{boardId}` | Удалить доску с колонками и задачами |
| `POST /api/v1/boards/{boardId}/columns` | Колонка: `{name, is_done?}` |
| `PATCH /api/v1/columns/{columnId}` | `{name?, position?, is_done?}` |
| `DELETE /api/v1/columns/{columnId}` | Удалить колонку с задачами |
| `GET /api/v1/boards/{boardId}/tasks` | Задачи доски; параметры `column_id`, `limit` (≤500, по умолчанию 200), `offset` |
| `POST /api/v1/boards/{boardId}/tasks` | Задача: `{title, description?, priority?, column_id?, assignee_id?, due_date?}` |
| `GET /api/v1/tasks/{taskId}` | Задача |
| `PATCH /api/v1/tasks/{taskId}` | Поля задачи, включая `column_id` (перемещение внутри доски) и `assignee_id: null` (снять исполнителя) |
| `DELETE /api/v1/tasks/{taskId}` | Удалить задачу |

Поля задачи: `title` 1–200 символов, `description` ≤8000, `priority` — `low|medium|high`, `due_date` — `YYYY-MM-DD` или `null`, `assignee_id` — uuid участника отдела или `null`. Без `column_id` задача попадает в первую колонку доски.

Пример:

```bash
curl -s https://flowdesk-alpha-teal.vercel.app/api/v1/departments \
  -H "Authorization: Bearer fd_ВАШ_ТОКЕН"

curl -s -X POST https://flowdesk-alpha-teal.vercel.app/api/v1/boards/BOARD_ID/tasks \
  -H "Authorization: Bearer fd_ВАШ_ТОКЕН" -H "Content-Type: application/json" \
  -d '{"title":"Подготовить релиз","priority":"high","due_date":"2026-12-01"}'
```

## Вебхуки

Отдел → «Вебхуки» (только владелец). До 5 вебхуков на отдел. Укажите HTTPS-адрес и события:

- `task.created` — создана задача;
- `task.moved` — перемещена в другую колонку;
- `task.done` — перемещена в финальную колонку (`is_done`);
- `task.assigned` — назначен исполнитель;
- `task.commented` — новый комментарий.

События берутся из журнала отдела, поэтому вебхук срабатывает и при изменениях через UI, и через API. Секрет (`whsec_…`) генерируется автоматически и показан на странице вебхука.

### Формат доставки

`POST` на ваш адрес, `Content-Type: application/json`, таймаут 10 секунд, редиректы не следуются. Заголовки:

- `X-FlowDesk-Event` — имя события;
- `X-FlowDesk-Delivery` — uuid доставки (идемпотентность: повторные попытки несут тот же uuid);
- `X-FlowDesk-Signature` — `t=<unix-секунды>,v1=<HMAC-SHA256>`.

Тело:

```json
{
  "id": "uuid события",
  "event": "task.created",
  "department_id": "uuid отдела",
  "occurred_at": "2026-11-17T12:00:00Z",
  "data": { "task_id": "uuid задачи", "title": "Название" }
}
```

Подпись — HMAC-SHA256 от строки `${t}.${тело запроса}` на секрете вебхука. Проверка на Node.js:

```js
const crypto = require('node:crypto');
function verify(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const got = parts.v1 ?? '';
  return expected.length === got.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}
```

Сравнивайте подпись до разбора JSON и отвечайте `2xx` быстро; тяжёлую обработку делайте асинхронно.

### Повторы и ограничения

Успех — любой `2xx`. `429` и `5xx`, сетевые сбои и ошибки DNS повторяются с экспоненциальной задержкой (до часа), всего до 5 попыток. Остальные `4xx` и редиректы — окончательный отказ. Адрес проверяется при каждой доставке: приватные и служебные диапазоны IP (включая localhost) блокируются, разрешён только HTTPS. Отключённый вебхук и удалённые события пропускаются.

## Безопасность

- Токен даёт доступ ко всем вашим отделам — храните его как пароль, не коммитьте в репозиторий.
- Утечёкший токен отзовите в профиле; скомпрометированный секрет вебхука — удалите вебхук и создайте новый.
- API не раскрывает чужие отделы: проверка членства выполняется для каждого запроса.