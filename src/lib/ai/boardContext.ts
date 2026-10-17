import type { createClient } from '@/lib/supabase/server';
import { computeDeadlineRisks, computeWorkload, type ACol, type ATask } from '@/lib/analytics';

// Тот же тип клиента, что возвращает createClient() на сервере (исключает расхождения типов)
type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Сборка контекста для ИИ ПО ДАННЫМ ИЗ БАЗЫ (на сервере, с правами пользователя, то есть через RLS).
 * Клиент не передаёт эти данные сам, поэтому подделать их нельзя.
 * Результат затем проходит маскирование в route.ts.
 */

const MAX_CHARS = 8000;
const DAY_MS = 86_400_000;

type Row = Record<string, any>;

function nameOf(profile: unknown): string {
  const p = Array.isArray(profile) ? profile[0] : profile;
  const name = (p as { full_name?: string } | null | undefined)?.full_name;
  return name && name.trim() ? name.trim() : 'без имени';
}

async function memberNames(supabase: SupabaseClient, departmentId: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('department_members')
    .select('user_id, profiles(full_name)')
    .eq('department_id', departmentId);
  const map = new Map<string, string>();
  for (const m of (data ?? []) as Row[]) map.set(m.user_id, nameOf(m.profiles));
  return map;
}

/** Доска отдела: колонки, задачи, исполнители, сроки, застрявшие задачи. */
export async function buildBoardContext(
  supabase: SupabaseClient,
  departmentId: string,
): Promise<string> {
  const { data: boards } = await supabase.from('boards').select('id').eq('department_id', departmentId);
  const boardIds = ((boards ?? []) as Row[]).map((b) => b.id as string);
  if (boardIds.length === 0) return '';

  const [{ data: columns }, { data: tasks }, names] = await Promise.all([
    supabase.from('columns').select('id, name, position, is_done').in('board_id', boardIds).order('position'),
    supabase
      .from('tasks')
      .select('id, column_id, title, priority, due_date, assignee_id, moved_at').is('archived_at',null)
      .in('board_id', boardIds)
      .limit(300),
    memberNames(supabase, departmentId),
  ]);

  const now = Date.now();
  const lines: string[] = [`Доска отдела (на ${new Date(now).toLocaleDateString('ru-RU')}):`];
  for (const col of (columns ?? []) as Row[]) {
    const inCol = ((tasks ?? []) as Row[]).filter((t) => t.column_id === col.id);
    lines.push(`\n[${col.name}${col.is_done ? ' — завершено' : ''}] задач: ${inCol.length}`);
    for (const t of inCol) {
      const days = Math.floor((now - new Date(t.moved_at).getTime()) / DAY_MS);
      const parts = [`- ${t.title}`, `приоритет: ${t.priority}`];
      if (t.assignee_id) parts.push(`исполнитель: ${names.get(t.assignee_id) ?? 'неизвестен'}`);
      if (t.due_date) parts.push(`срок: ${t.due_date}`);
      if (!col.is_done && days >= 3) parts.push(`без движения ${days} дн.`);
      lines.push(parts.join(', '));
    }
  }
  return lines.join('\n').slice(0, MAX_CHARS);
}

const EVENT_LABEL: Record<string, string> = {
  created: 'создана задача',
  moved: 'задача перемещена',
  assigned: 'назначен исполнитель',
  commented: 'новый комментарий',
  done: 'задача завершена',
};

/** События по задачам и сообщения чата с момента `sinceIso`. */
export async function buildDigestContext(
  supabase: SupabaseClient,
  departmentId: string,
  sinceIso: string,
): Promise<string> {
  const [{ data: events }, { data: messages }, names] = await Promise.all([
    supabase
      .from('task_events')
      .select('kind, payload, created_at, actor_id')
      .eq('department_id', departmentId)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(60),
    supabase
      .from('messages')
      .select('body, created_at, author_id')
      .eq('department_id', departmentId)
      .eq('is_ai', false)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(40),
    memberNames(supabase, departmentId),
  ]);

  const lines: string[] = [];
  const ev = (events ?? []) as Row[];
  const ms = (messages ?? []) as Row[];

  if (ev.length) {
    lines.push('События по задачам:');
    for (const e of ev) {
      const who = e.actor_id ? names.get(e.actor_id) ?? 'кто-то' : 'система';
      const title = e.payload?.title ? `«${e.payload.title}»` : '';
      lines.push(`- ${who}: ${EVENT_LABEL[e.kind] ?? e.kind} ${title}`.trim());
    }
  }
  if (ms.length) {
    lines.push('\nСообщения чата:');
    for (const m of ms) {
      lines.push(`- ${names.get(m.author_id) ?? 'кто-то'}: ${m.body}`);
    }
  }
  return lines.join('\n').slice(0, MAX_CHARS);
}

/** Одна задача (для подсказки по блокеру). Возвращает '' если задача не найдена. */
export async function buildTaskContext(
  supabase: SupabaseClient,
  departmentId: string,
  taskId: string,
): Promise<string> {
  const { data: task } = await supabase
    .from('tasks')
    .select('title, description, priority, due_date, assignee_id, moved_at, column_id, board_id').is('archived_at',null)
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return '';

  const t = task as Row;
  const [{ data: board }, { data: column }, names] = await Promise.all([
    supabase.from('boards').select('department_id').eq('id', t.board_id).maybeSingle(),
    supabase.from('columns').select('name').eq('id', t.column_id).maybeSingle(),
    memberNames(supabase, departmentId),
  ]);
  if ((board as Row | null)?.department_id !== departmentId) return '';

  const days = Math.floor((Date.now() - new Date(t.moved_at).getTime()) / DAY_MS);
  const lines = [
    `Задача: ${t.title}`,
    `Колонка: ${(column as Row | null)?.name ?? '?'}`,
    `Без движения: ${days} дн.`,
    `Приоритет: ${t.priority}`,
  ];
  if (t.assignee_id) lines.push(`Исполнитель: ${names.get(t.assignee_id) ?? 'неизвестен'}`);
  if (t.due_date) lines.push(`Срок: ${t.due_date}`);
  if (t.description) lines.push(`Описание: ${t.description}`);
  return lines.join('\n').slice(0, MAX_CHARS);
}

/** Данные для недельного отчёта: что сделано за период, что в работе, риски и нагрузка. */
export async function buildReportContext(
  supabase: SupabaseClient,
  departmentId: string,
  sinceIso: string,
): Promise<string> {
  const { data: boards } = await supabase.from('boards').select('id').eq('department_id', departmentId);
  const boardIds = ((boards ?? []) as Row[]).map((b) => b.id as string);
  if (boardIds.length === 0) return '';

  const [{ data: columns }, { data: tasks }, { data: events }, names] = await Promise.all([
    supabase.from('columns').select('id, name, position, is_done').in('board_id', boardIds).order('position'),
    supabase
      .from('tasks')
      .select('id, title, column_id, priority, due_date, assignee_id, created_at, moved_at').is('archived_at',null)
      .in('board_id', boardIds)
      .limit(500),
    supabase
      .from('task_events')
      .select('kind, payload')
      .eq('department_id', departmentId)
      .gt('created_at', sinceIso)
      .limit(500),
    memberNames(supabase, departmentId),
  ]);

  const cols = (columns ?? []) as Row[];
  const colName = new Map<string, string>();
  for (const c of cols) colName.set(c.id as string, c.name as string);
  const acols: ACol[] = cols.map((c) => ({ id: c.id, position: c.position, isDone: !!c.is_done }));
  const doneIds = new Set(acols.filter((c) => c.isDone).map((c) => c.id));

  const atasks: ATask[] = ((tasks ?? []) as Row[]).map((t) => ({
    id: t.id,
    title: t.title,
    columnId: t.column_id,
    assigneeId: t.assignee_id ?? null,
    priority: t.priority,
    dueDate: t.due_date ?? null,
    createdAt: t.created_at,
    movedAt: t.moved_at,
  }));

  const now = new Date();
  const ev = (events ?? []) as Row[];
  const count = (kind: string) => ev.filter((e) => e.kind === kind).length;
  const doneTitles = ev
    .filter((e) => e.kind === 'done')
    .map((e) => String(e.payload?.title ?? ''))
    .filter(Boolean)
    .slice(0, 25);

  const lines: string[] = [
    `Период: с ${new Date(sinceIso).toLocaleDateString('ru-RU')} по ${now.toLocaleDateString('ru-RU')}`,
    `За период: создано задач ${count('created')}, завершено ${count('done')}, перемещений ${count('moved')}, комментариев ${count('commented')}`,
  ];
  if (doneTitles.length) lines.push('Завершено:\n' + doneTitles.map((t) => `- ${t}`).join('\n'));

  const open = atasks.filter((t) => !doneIds.has(t.columnId));
  lines.push(`\nОткрытых задач сейчас: ${open.length}`);
  const inWork = open.filter((t) => {
    const idx = acols.findIndex((c) => c.id === t.columnId);
    return idx > 0;
  });
  if (inWork.length) {
    lines.push('В работе:');
    for (const t of inWork.slice(0, 25)) {
      const who = t.assigneeId ? `, исполнитель: ${names.get(t.assigneeId) ?? 'неизвестен'}` : '';
      lines.push(`- ${t.title} [${colName.get(t.columnId) ?? '?'}]${who}`);
    }
  }

  const risks = computeDeadlineRisks(atasks, acols, now).slice(0, 10);
  if (risks.length) {
    lines.push('\nРиски по срокам:');
    for (const r of risks) lines.push(`- ${r.title}: ${r.reason}`);
  }

  const { rows, unassigned } = computeWorkload(atasks, acols, [...names.keys()], now);
  lines.push('\nНагрузка (открытых задач / из них просрочено):');
  for (const r of rows) {
    lines.push(`- ${names.get(r.userId ?? '') ?? 'без имени'}: ${r.open} / ${r.overdue}`);
  }
  if (unassigned) lines.push(`- без исполнителя: ${unassigned}`);

  return lines.join('\n').slice(0, MAX_CHARS);
}
