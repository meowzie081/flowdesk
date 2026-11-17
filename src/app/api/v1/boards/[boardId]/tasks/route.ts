import { z } from 'zod';
import {
  authenticateApi, apiJson, apiUnauthorized, apiMembership, canWriteRole, apiBoardDep,
} from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const TASK_FIELDS = 'id,board_id,column_id,title,description,priority,assignee_id,due_date,position,created_by,created_at,moved_at';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).default(''),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  column_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function GET(req: Request, { params }: { params: { boardId: string } }) {
  const ctx = await authenticateApi(req);
  if (!ctx) return apiUnauthorized();
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return tooManyRequests(60);
  const depId = await apiBoardDep(ctx.admin, params.boardId);
  if (!depId) return apiJson({ error: 'Доска не найдена' }, 404);
  const role = await apiMembership(ctx.admin, ctx.userId, depId);
  if (!role) return apiJson({ error: 'Нет доступа к этой доске' }, 403);

  const url = new URL(req.url);
  const columnId = url.searchParams.get('column_id');
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  let query = ctx.admin.from('tasks').select(TASK_FIELDS).eq('board_id', params.boardId);
  if (columnId) query = query.eq('column_id', columnId);
  const { data, error } = await query.order('position').order('created_at').range(offset, offset + limit - 1);
  if (error) return apiJson({ error: 'Не удалось получить задачи' }, 500);
  return apiJson({ data });
}

export async function POST(req: Request, { params }: { params: { boardId: string } }) {
  const ctx = await authenticateApi(req);
  if (!ctx) return apiUnauthorized();
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return tooManyRequests(60);
  const depId = await apiBoardDep(ctx.admin, params.boardId);
  if (!depId) return apiJson({ error: 'Доска не найдена' }, 404);
  const role = await apiMembership(ctx.admin, ctx.userId, depId);
  if (!canWriteRole(role)) return apiJson({ error: 'Нет прав на создание задач в этом отделе' }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return apiJson({ error: 'Некорректный запрос' }, 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiJson({ error: 'Проверьте поля задачи: title обязателен (1–200 символов)' }, 400);
  const input = parsed.data;

  let columnId = input.column_id;
  if (columnId) {
    const { data: col } = await ctx.admin.from('columns').select('board_id').eq('id', columnId).maybeSingle();
    if (!col || col.board_id !== params.boardId) return apiJson({ error: 'Колонка не принадлежит этой доске' }, 400);
  } else {
    const { data: col } = await ctx.admin.from('columns').select('id').eq('board_id', params.boardId).order('position').limit(1).maybeSingle();
    if (!col) return apiJson({ error: 'На доске нет колонок. Сначала создайте колонку.' }, 400);
    columnId = col.id;
  }

  if (input.assignee_id && !(await apiMembership(ctx.admin, input.assignee_id, depId))) {
    return apiJson({ error: 'Исполнитель должен быть участником отдела' }, 400);
  }

  const { data: last } = await ctx.admin.from('tasks').select('position').eq('column_id', columnId).order('position', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await ctx.admin
    .from('tasks')
    .insert({
      board_id: params.boardId,
      column_id: columnId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assignee_id: input.assignee_id ?? null,
      due_date: input.due_date ?? null,
      position: (last?.position ?? -1) + 1,
      created_by: ctx.userId,
    })
    .select(TASK_FIELDS)
    .single();
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ task: data }, 201);
}