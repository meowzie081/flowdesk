import { z } from 'zod';
import {
  authenticateApi, apiJson, apiUnauthorized, apiMembership, canWriteRole, apiBoardDep,
} from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const patchSchema = z.object({ name: z.string().trim().min(1).max(80) });

async function guard(req: Request, boardId: string) {
  const ctx = await authenticateApi(req);
  if (!ctx) return { error: apiUnauthorized() } as const;
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return { error: tooManyRequests(60) } as const;
  const depId = await apiBoardDep(ctx.admin, boardId);
  if (!depId) return { error: apiJson({ error: 'Доска не найдена' }, 404) } as const;
  const role = await apiMembership(ctx.admin, ctx.userId, depId);
  if (!role) return { error: apiJson({ error: 'Нет доступа к этой доске' }, 403) } as const;
  return { ctx, role } as const;
}

export async function GET(req: Request, { params }: { params: { boardId: string } }) {
  const g = await guard(req, params.boardId);
  if ('error' in g) return g.error;
  const [{ data: board }, { data: columns }] = await Promise.all([
    g.ctx.admin.from('boards').select('id,department_id,name,created_at').eq('id', params.boardId).single(),
    g.ctx.admin.from('columns').select('id,name,position,is_done').eq('board_id', params.boardId).order('position'),
  ]);
  return apiJson({ board, columns: columns ?? [] });
}

export async function PATCH(req: Request, { params }: { params: { boardId: string } }) {
  const g = await guard(req, params.boardId);
  if ('error' in g) return g.error;
  if (!canWriteRole(g.role)) return apiJson({ error: 'Нет прав на изменение доски' }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return apiJson({ error: 'Некорректный запрос' }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return apiJson({ error: 'Название должно быть от 1 до 80 символов' }, 400);
  const { data, error } = await g.ctx.admin.from('boards').update({ name: parsed.data.name }).eq('id', params.boardId).select('id,name').single();
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ board: data });
}

export async function DELETE(req: Request, { params }: { params: { boardId: string } }) {
  const g = await guard(req, params.boardId);
  if ('error' in g) return g.error;
  if (!canWriteRole(g.role)) return apiJson({ error: 'Нет прав на удаление доски' }, 403);
  const { error } = await g.ctx.admin.from('boards').delete().eq('id', params.boardId);
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ ok: true });
}