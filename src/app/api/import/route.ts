import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const payloadSchema = z.object({
  board_name: z.string().min(1).max(60),
  columns: z.array(z.object({ name: z.string().min(1).max(60), is_done: z.boolean() })).min(1).max(50),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(8000),
        column: z.string().max(60),
        priority: z.enum(['low', 'medium', 'high']),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      }),
    )
    .max(2000),
});
const bodySchema = z.object({ dep: z.string().uuid(), payload: payloadSchema });

/** POST /api/import — создаёт доску из нормализованного payload (Trello/CSV) одной транзакцией. */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Войдите в аккаунт' }, { status: 401 });
  if (!(await checkRateLimit(`import:${user.id}`, 10, 60))) return tooManyRequests(60);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Некорректные данные импорта' }, { status: 400 });
  const { dep, payload } = parsed.data;

  const { data: membership } = await supabase
    .from('department_members')
    .select('role')
    .eq('department_id', dep)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || membership.role === 'viewer')
    return NextResponse.json({ error: 'Нет прав на импорт в этот отдел' }, { status: 403 });

  const { data, error } = await supabase.rpc('import_board_payload', { p_dep: dep, p_payload: payload });
  if (error) {
    const unavailable = /import_board_payload|function .* does not exist/i.test(error.message);
    return NextResponse.json(
      { error: unavailable ? 'Импорт ещё не включён в этой базе. Примените миграцию 0023 в Supabase SQL Editor.' : error.message },
      { status: 400 },
    );
  }
  return NextResponse.json({ boardId: data });
}