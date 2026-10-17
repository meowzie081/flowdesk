-- Демо-данные для отделов «Design» и «Development»: колонки, метки, задачи со сроками и исполнителями.
-- Запуск: Supabase → SQL Editor → вставить весь файл → Run.
-- Нужны миграции 0001–0006. Скрипт безопасен: если на доске отдела уже есть задачи, этот отдел пропускается.
-- Отдел ищется по началу названия (без учёта регистра). Если отдела «Development» ещё нет, создайте его в приложении и запустите скрипт снова.

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

select pg_temp.seed_dep('Design%', $json$[
  {"t":"Обновить фирменный стиль: палитра и шрифты","d":"Подобрать палитру и пару шрифтов, проверить контраст.","c":0,"p":"medium","cr":4,"mv":4,"l":["брендинг"]},
  {"t":"Собрать референсы и мудборд для лендинга","c":0,"p":"low","cr":3,"mv":3,"l":["лендинг"]},
  {"t":"Аудит интерфейса: кнопки и отступы","d":"Найти несогласованные компоненты и составить список правок.","c":0,"p":"medium","due":10,"a":0,"cr":5,"mv":5,"l":["дизайн-система"]},
  {"t":"Иконки для раздела «Тарифы»","c":0,"p":"low","cr":2,"mv":2,"l":["иллюстрации"]},
  {"t":"Дизайн email-рассылки к запуску","c":0,"p":"medium","due":12,"cr":5,"mv":5,"l":["маркетинг"]},

  {"t":"Макет главной страницы лендинга","d":"Десктопная и мобильная версии, состояния кнопок.","c":1,"p":"high","due":3,"a":0,"cr":9,"mv":1,"l":["лендинг"]},
  {"t":"Дизайн-система: кнопки, поля ввода, карточки","d":"Компоненты со всеми состояниями и правилами использования.","c":1,"p":"high","due":-1,"a":1,"cr":10,"mv":5,"l":["дизайн-система"]},
  {"t":"Баннеры для соцсетей к анонсу","d":"Три размера под основные площадки.","c":1,"p":"medium","due":4,"a":1,"cr":6,"mv":2,"l":["маркетинг","иллюстрации"]},
  {"t":"Онбординг в приложении: 4 экрана","c":1,"p":"medium","due":9,"a":0,"cr":8,"mv":4,"l":["UX"]},

  {"t":"Логотип: финальные варианты","d":"Версии для светлого и тёмного фона, минимальные размеры.","c":2,"p":"high","due":1,"a":0,"cr":12,"mv":1,"l":["брендинг"]},
  {"t":"Презентация для инвесторов, 12 слайдов","c":2,"p":"high","due":2,"a":1,"cr":9,"mv":2,"l":["маркетинг"]},
  {"t":"Тёмная тема для личного кабинета","c":2,"p":"medium","due":5,"a":1,"cr":8,"mv":3,"l":["UX","дизайн-система"]},

  {"t":"Исследование конкурентов","d":"Сводная таблица сильных и слабых сторон.","c":3,"p":"low","a":1,"cr":18,"mv":11,"l":["UX"]},
  {"t":"Фавиконка и иконки для PWA","c":3,"p":"low","a":0,"cr":12,"mv":7,"l":["брендинг"]},
  {"t":"Гайдлайн по отступам и сетке","c":3,"p":"medium","a":1,"cr":15,"mv":9,"l":["дизайн-система"]}
]$json$::jsonb) as design_result,

       pg_temp.seed_dep('Dev%', $json$[
  {"t":"Авторизация через Google и GitHub","d":"OAuth-вход, привязка к существующим аккаунтам.","c":0,"p":"high","due":14,"cr":3,"mv":3,"l":["бэкенд"]},
  {"t":"Экспорт данных в CSV и Excel","c":0,"p":"low","cr":4,"mv":4,"l":["фича"]},
  {"t":"Поиск по задачам с фильтрами","c":0,"p":"medium","due":16,"cr":3,"mv":3,"l":["фича","фронтенд"]},
  {"t":"Рефакторинг модуля уведомлений","c":0,"p":"low","cr":6,"mv":6,"l":["техдолг"]},
  {"t":"Покрыть тестами сервис оплаты","c":0,"p":"medium","due":11,"a":0,"cr":5,"mv":5,"l":["тесты"]},

  {"t":"API для мобильного приложения","d":"Эндпоинты задач и проектов, документация в OpenAPI.","c":1,"p":"high","due":4,"a":0,"cr":9,"mv":1,"l":["бэкенд"]},
  {"t":"Страница настроек профиля","c":1,"p":"medium","due":6,"a":1,"cr":7,"mv":2,"l":["фронтенд"]},
  {"t":"Оптимизировать запросы к базе на дашборде","d":"Главная страница грузится дольше 3 секунд на больших данных.","c":1,"p":"high","due":-2,"a":1,"cr":11,"mv":6,"l":["производительность","бэкенд"]},
  {"t":"Адаптивная вёрстка таблиц на мобильных","c":1,"p":"medium","due":8,"a":0,"cr":8,"mv":4,"l":["фронтенд"]},

  {"t":"Drag-and-drop для карточек","d":"Перенос между колонками и сортировка внутри колонки.","c":2,"p":"high","due":1,"a":0,"cr":10,"mv":1,"l":["фронтенд"]},
  {"t":"Валидация форм на клиенте и сервере","c":2,"p":"medium","due":5,"a":1,"cr":8,"mv":3,"l":["фронтенд","бэкенд"]},
  {"t":"Индексы для поиска по задачам","c":2,"p":"medium","due":7,"a":0,"cr":6,"mv":2,"l":["бэкенд","производительность"]},

  {"t":"Настроить линтер и форматирование","c":3,"p":"low","a":1,"cr":20,"mv":14,"l":["техдолг"]},
  {"t":"Подключить систему логирования","c":3,"p":"medium","a":0,"cr":16,"mv":10,"l":["бэкенд","devops"]},
  {"t":"Деплой на тестовый стенд","c":3,"p":"high","a":1,"cr":12,"mv":6,"l":["devops"]},
  {"t":"Исправить баг с часовыми поясами в датах","c":3,"p":"high","a":0,"cr":8,"mv":3,"l":["баг"]}
]$json$::jsonb) as development_result;
