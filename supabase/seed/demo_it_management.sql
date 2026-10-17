-- Демо-данные для отделов «IT-отдел» и «Managment»: колонки, метки, задачи со сроками и исполнителями.
-- Запуск: Supabase → SQL Editor → вставить весь файл → Run.
-- Нужны миграции 0001–0006. Скрипт безопасен: если на доске отдела уже есть задачи, этот отдел пропускается.
-- Отдел ищется по началу названия (без учёта регистра), поэтому опечатки в хвосте названия не мешают.

create or replace function pg_temp.seed_dep(p_pattern text, p_tasks jsonb)
returns text language plpgsql as $$
declare
  dep uuid;
  bid uuid;
  owner_id uuid;
  member_ids uuid[];
  col_ids uuid[];
  col_names text[] := array['Backlog', 'В работе', 'Ревью', 'Готово'];
  pos int[] := array[0, 0, 0, 0, 0, 0, 0, 0];
  rec jsonb;
  lbl text;
  lid uuid;
  tid uuid;
  seeded uuid[] := '{}';
  ci int;
  ai int;
  n_cols int;
  n_members int;
  i int;
begin
  select id into dep from departments where name ilike p_pattern order by created_at limit 1;
  if dep is null then
    return format('Отдел «%s» не найден — пропущено', p_pattern);
  end if;

  select user_id into owner_id from department_members
    where department_id = dep and role = 'owner' order by joined_at limit 1;
  select array_agg(user_id order by joined_at) into member_ids
    from department_members where department_id = dep;
  if owner_id is null then owner_id := member_ids[1]; end if;
  if owner_id is null then
    return format('В отделе «%s» нет участников — пропущено', p_pattern);
  end if;
  n_members := array_length(member_ids, 1);

  select id into bid from boards where department_id = dep order by created_at limit 1;
  if bid is null then
    insert into boards (department_id, name) values (dep, 'Основная доска') returning id into bid;
  end if;

  if exists (select 1 from tasks where board_id = bid) then
    return format('На доске отдела «%s» уже есть задачи — пропущено', p_pattern);
  end if;

  -- колонки: создаём стандартные, если их ещё нет
  if not exists (select 1 from columns where board_id = bid) then
    for i in 1..4 loop
      insert into columns (board_id, name, position, is_done)
      values (bid, col_names[i], i - 1, i = 4);
    end loop;
  end if;
  select array_agg(id order by position) into col_ids from columns where board_id = bid;
  n_cols := array_length(col_ids, 1);

  for rec in select * from jsonb_array_elements(p_tasks) loop
    ci := least(coalesce((rec->>'c')::int, 0), n_cols - 1) + 1;   -- индекс в массиве (с 1)
    ai := case when rec->>'a' is null then null else ((rec->>'a')::int % n_members) + 1 end;

    insert into tasks (
      board_id, column_id, title, description, priority, due_date, position,
      assignee_id, created_by, created_at, moved_at
    ) values (
      bid,
      col_ids[ci],
      rec->>'t',
      coalesce(rec->>'d', ''),
      coalesce(rec->>'p', 'medium')::task_priority,
      current_date + (rec->>'due')::int,
      pos[ci],
      case when ai is null then null else member_ids[ai] end,
      owner_id,
      now() - make_interval(days => coalesce((rec->>'cr')::int, 0)),
      now() - make_interval(days => coalesce((rec->>'mv')::int, 0))
    ) returning id into tid;
    pos[ci] := pos[ci] + 1;
    seeded := seeded || tid;

    for lbl in select jsonb_array_elements_text(coalesce(rec->'l', '[]'::jsonb)) loop
      insert into labels (department_id, name) values (dep, lbl)
        on conflict (department_id, lower(name)) do nothing;
      select id into lid from labels where department_id = dep and lower(name) = lower(lbl);
      insert into task_labels (task_id, label_id) values (tid, lid) on conflict do nothing;
    end loop;
  end loop;

  -- триггер назначения создал бы уведомления на каждую демо-задачу — убираем
  delete from notifications where task_id = any(seeded);

  return format('Отдел «%s»: создано задач — %s', p_pattern, array_length(seeded, 1));
end $$;

-- Поля: t — название, d — описание, c — колонка (0 Backlog, 1 В работе, 2 Ревью, 3 Готово),
-- p — приоритет, due — срок в днях от сегодня (минус = просрочено), a — номер исполнителя (нет = без исполнителя),
-- mv — сколько дней карточка без движения, cr — сколько дней назад создана, l — метки.

select pg_temp.seed_dep('IT%', $json$[
  {"t":"Настроить автоматические бэкапы базы данных","d":"Ежедневные копии с хранением 30 дней и проверкой восстановления.","c":0,"p":"medium","due":14,"cr":3,"mv":3,"l":["инфраструктура"]},
  {"t":"Политика паролей и двухфакторная аутентификация","d":"Подготовить требования, провести инструктаж для сотрудников.","c":0,"p":"high","due":7,"a":0,"cr":4,"mv":4,"l":["безопасность"]},
  {"t":"Инвентаризация ноутбуков и лицензий ПО","d":"Сверить список техники и подписок, найти неиспользуемые лицензии.","c":0,"p":"low","cr":6,"mv":6,"l":["поддержка"]},
  {"t":"Обновить Node.js на всех серверах","d":"Перейти на актуальную LTS-версию, проверить совместимость сервисов.","c":0,"p":"low","cr":2,"mv":2,"l":["инфраструктура"]},

  {"t":"Настроить CI/CD для основного репозитория","d":"Сборка, тесты и деплой на стенд при каждом merge в main.","c":1,"p":"high","due":3,"a":0,"cr":9,"mv":1,"l":["разработка","инфраструктура"]},
  {"t":"Исправить падение отчёта при пустом периоде","d":"Отчёт возвращает 500, если за выбранные даты нет данных.","c":1,"p":"high","due":-1,"a":1,"cr":8,"mv":5,"l":["баг"]},
  {"t":"Перенести почту на корпоративный домен","d":"Настроить MX, SPF, DKIM, перенести ящики сотрудников.","c":1,"p":"medium","due":5,"a":1,"cr":7,"mv":2,"l":["инфраструктура"]},
  {"t":"Развернуть мониторинг и алерты","d":"Метрики серверов и уведомления дежурному при сбоях.","c":1,"p":"medium","due":9,"a":0,"cr":10,"mv":4,"l":["инфраструктура"]},

  {"t":"Обновить SSL-сертификаты на продакшене","d":"Сертификаты истекают на этой неделе.","c":2,"p":"high","due":1,"a":0,"cr":6,"mv":1,"l":["безопасность"]},
  {"t":"Документация по развёртыванию тестового стенда","d":"Пошаговая инструкция для новых разработчиков.","c":2,"p":"low","due":6,"a":1,"cr":8,"mv":3,"l":["разработка"]},

  {"t":"Настроить VPN для удалённых сотрудников","c":3,"p":"medium","a":0,"cr":20,"mv":12,"l":["безопасность","инфраструктура"]},
  {"t":"Обновить антивирус на рабочих станциях","c":3,"p":"low","a":1,"cr":15,"mv":9,"l":["поддержка"]},
  {"t":"Закрыть уязвимость в зависимостях","d":"Обновлены пакеты с критическими CVE.","c":3,"p":"high","a":0,"cr":10,"mv":6,"l":["безопасность"]},
  {"t":"Подключить Sentry для отслеживания ошибок","c":3,"p":"medium","a":1,"cr":9,"mv":4,"l":["разработка"]}
]$json$::jsonb) as it_result,

       pg_temp.seed_dep('Man%', $json$[
  {"t":"Подготовить OKR на следующий квартал","d":"Собрать цели от отделов, согласовать ключевые результаты.","c":0,"p":"high","due":10,"a":0,"cr":4,"mv":4,"l":["планирование"]},
  {"t":"Пересмотреть грейды и вилки зарплат","d":"Сверка с рынком, подготовка предложений для руководства.","c":0,"p":"medium","cr":5,"mv":5,"l":["финансы","найм"]},
  {"t":"Организовать командную ретроспективу","c":0,"p":"low","due":20,"cr":2,"mv":2,"l":["процессы"]},
  {"t":"Составить план обучения сотрудников","c":0,"p":"low","cr":3,"mv":3,"l":["планирование"]},

  {"t":"Собрать бюджет отделов на следующий квартал","d":"Запросить плановые расходы у руководителей отделов.","c":1,"p":"high","due":2,"a":0,"cr":8,"mv":1,"l":["финансы","планирование"]},
  {"t":"Провести собеседования на позицию аналитика","d":"Назначить три раунда, собрать обратную связь.","c":1,"p":"high","due":-3,"a":1,"cr":12,"mv":6,"l":["найм"]},
  {"t":"Согласовать договор с подрядчиком","c":1,"p":"medium","due":4,"a":0,"cr":7,"mv":2,"l":["финансы"]},
  {"t":"Описать процесс согласования отпусков","c":1,"p":"low","due":12,"a":1,"cr":9,"mv":7,"l":["процессы"]},

  {"t":"Квартальный отчёт для руководства","d":"Итоги, метрики, риски и план на следующий квартал.","c":2,"p":"high","due":1,"a":0,"cr":10,"mv":2,"l":["отчётность"]},
  {"t":"Регламент работы с обращениями клиентов","c":2,"p":"medium","due":5,"a":1,"cr":8,"mv":3,"l":["процессы"]},

  {"t":"Подписать аренду нового офиса","c":3,"p":"high","a":0,"cr":25,"mv":14,"l":["финансы"]},
  {"t":"Обновить организационную структуру","c":3,"p":"medium","a":1,"cr":18,"mv":10,"l":["процессы"]},
  {"t":"Запустить процесс адаптации новичков","c":3,"p":"medium","a":0,"cr":12,"mv":5,"l":["найм","процессы"]},
  {"t":"Еженедельная планёрка: зафиксировать решения","c":3,"p":"low","a":1,"cr":9,"mv":3,"l":["планирование"]}
]$json$::jsonb) as management_result;
