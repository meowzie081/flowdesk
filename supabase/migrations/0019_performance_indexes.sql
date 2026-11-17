-- Индексы под фактические запросы приложения: доска, чат, файлы, объявления, «мои задачи».
create index if not exists columns_board_idx on public.columns(board_id, position);
create index if not exists boards_department_idx on public.boards(department_id);
create index if not exists messages_root_idx on public.messages(department_id, created_at desc, id desc) where parent_id is null;
create index if not exists tasks_assignee_idx on public.tasks(assignee_id, due_date) where archived_at is null and assignee_id is not null;
create index if not exists email_campaigns_department_idx on public.email_campaigns(department_id, created_at desc);
create index if not exists attachments_task_idx on public.attachments(task_id);