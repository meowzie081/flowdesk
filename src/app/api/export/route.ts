import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/lib/csv';

const querySchema = z.object({ dep: z.string().uuid() });

const PRIORITY = { low: 'Низкий', medium: 'Средний', high: 'Высокий' } as const;

function nameOf(profile: unknown): string {
  const p = Array.isArray(profile) ? profile[0] : profile;
  const name = (p as { full_name?: string } | null | undefined)?.full_name;
  return name?.trim() ?? '';
}

/** GET /api/export?dep=<id отдела> — все задачи отдела в CSV (доступно любому участнику, права проверяет RLS). */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const depId = parsed.data.dep;

  const { data: membership } = await supabase
    .from('department_members')
    .select('role')
    .eq('department_id', depId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data: boards } = await supabase.from('boards').select('id').eq('department_id', depId);
  const boardIds = (boards ?? []).map((b) => b.id);

  const [{ data: columns }, { data: tasks }, { data: members }, { data: labels }] = await Promise.all([
    supabase.from('columns').select('id, name').in('board_id', boardIds),
    supabase
      .from('tasks')
      .select(
        'title, description, priority, due_date, column_id, assignee_id, created_at, moved_at, task_labels(label_id)',
      ).is('archived_at',null)
      .in('board_id', boardIds)
      .order('created_at')
      .limit(5000),
    supabase.from('department_members').select('user_id, profiles(full_name)').eq('department_id', depId),
    supabase.from('labels').select('id, name').eq('department_id', depId),
  ]);

  const columnName = new Map<string, string>();
  for (const c of columns ?? []) columnName.set(c.id as string, c.name as string);
  const memberName = new Map<string, string>();
  for (const m of members ?? []) memberName.set(m.user_id as string, nameOf(m.profiles));
  const labelName = new Map<string, string>();
  for (const l of labels ?? []) labelName.set(l.id as string, l.name as string);

  const rows = (tasks ?? []).map((t) => {
    const labelIds = ((t.task_labels ?? []) as { label_id: string }[]).map((x) => x.label_id);
    return [
      t.title,
      columnName.get(t.column_id) ?? '',
      PRIORITY[t.priority as keyof typeof PRIORITY] ?? t.priority,
      t.assignee_id ? memberName.get(t.assignee_id) ?? '' : '',
      t.due_date ?? '',
      labelIds.map((id) => labelName.get(id) ?? '').filter(Boolean).join('; '),
      new Date(t.created_at).toISOString().slice(0, 10),
      new Date(t.moved_at).toISOString().slice(0, 10),
      t.description ?? '',
    ];
  });

  const csv = toCsv(
    ['Задача', 'Колонка', 'Приоритет', 'Исполнитель', 'Срок', 'Метки', 'Создана', 'Последнее движение', 'Описание'],
    rows,
  );

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="flowdesk-tasks.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
