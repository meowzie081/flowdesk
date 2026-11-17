import { z } from 'zod';
import {
  authenticateApi, apiJson, apiUnauthorized, apiMembership, canWriteRole, apiTaskRef,
} from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const TASK_FIELDS = 'id,board_id,column_id,title,description,priority,assignee_id,due_date,position,created_by,created_at,moved_at';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  column_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  position: z.number().int().min(0).max(100000).optional(),
});

async function guard(req: Request, taskId: string) {
  const ctx = await authenticateApi(req);
  if (!ctx) return { error: apiUnauthorized() } as const;
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return { error: tooManyRequests(60) } as const;
  const ref = await apiTaskRef(ctx.admin, taskId);
  if (!ref) return { error: apiJson({ error: 'Задача не найдена' }, 404) } as const;
  const role = await apiMembership(ctx.admin, ctx.userId, ref.depId);
  if (!role) return { error: apiJson({ error: 'Нет доступа к этой задаче' }, 403) } as const;
  return { ctx, role, ref } as const;
}

export async function GET(req: Request, { params }: { params: { taskId: string } }) {
  const g = await guard(req, params.taskId);
  if ('error' in g) return g.error;
  const { data } = await g.ctx.admin.from('tasks').select(TASK_FIELDS).eq('id', params.taskId).single();
  return apiJson({ task: data });
}

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const g = await guard(req, params.taskId);
  if ('error' in g) return g.error;
  if (!canWriteRole(g.role)) return apiJson({ error: 'Нет прав на изменение задачи' }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return apiJson({ error: 'Некорректный запрос' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return apiJson({ error: 'Передайте хотя бы одно поле задачи' }, 400);
  const update = parsed.data;

  if (update.column_id) {
    const { data: col } = await g.ctx.admin.from('columns').select('board_id').eq('id', update.column_id).maybeSingle();
    if (!col || col.board_id !== g.ref.boardId) return apiJson({ error: 'Перемещение доступно только внутри доски задачи' }, 400);
  }
  if (update.assignee_id && !(await apiMembership(g.ctx.admin, update.assignee_id, g.ref.depId))) {
    return apiJson({ error: 'Исполнитель должен быть участником отдела' }, 400);
  }

  const { data, error } = await g.ctx.admin.from('tasks').update(update).eq('id', params.taskId).select(TASK_FIELDS).single();
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ task: data });
}

export async function DELETE(req: Request, { params }: { params: { taskId: string } }) {
  const g = await guard(req, params.taskId);
  if ('error' in g) return g.error;
  if (!canWriteRole(g.role)) return apiJson({ error: 'Нет прав на удаление задачи' }, 403);
  const { error } = await g.ctx.admin.from('tasks').delete().eq('id', params.taskId);
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ ok: true });
}