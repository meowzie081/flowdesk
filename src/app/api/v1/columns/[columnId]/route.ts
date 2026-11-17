import { z } from 'zod';
import {
  authenticateApi, apiJson, apiUnauthorized, apiMembership, canWriteRole, apiColumnRef,
} from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  position: z.number().int().min(0).max(10000).optional(),
  is_done: z.boolean().optional(),
});

async function guard(req: Request, columnId: string) {
  const ctx = await authenticateApi(req);
  if (!ctx) return { error: apiUnauthorized() } as const;
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return { error: tooManyRequests(60) } as const;
  const ref = await apiColumnRef(ctx.admin, columnId);
  if (!ref) return { error: apiJson({ error: 'Колонка не найдена' }, 404) } as const;
  const role = await apiMembership(ctx.admin, ctx.userId, ref.depId);
  if (!role) return { error: apiJson({ error: 'Нет доступа к этой колонке' }, 403) } as const;
  return { ctx, role } as const;
}

export async function PATCH(req: Request, { params }: { params: { columnId: string } }) {
  const g = await guard(req, params.columnId);
  if ('error' in g) return g.error;
  if (!canWriteRole(g.role)) return apiJson({ error: 'Нет прав на изменение колонки' }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return apiJson({ error: 'Некорректный запрос' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return apiJson({ error: 'Передайте name, position или is_done' }, 400);
  const { data, error } = await g.ctx.admin.from('columns').update(parsed.data).eq('id', params.columnId).select('id,name,position,is_done').single();
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ column: data });
}

export async function DELETE(req: Request, { params }: { params: { columnId: string } }) {
  const g = await guard(req, params.columnId);
  if ('error' in g) return g.error;
  if (!canWriteRole(g.role)) return apiJson({ error: 'Нет прав на удаление колонки' }, 403);
  const { error } = await g.ctx.admin.from('columns').delete().eq('id', params.columnId);
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ ok: true });
}