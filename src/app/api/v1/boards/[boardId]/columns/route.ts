import { z } from 'zod';
import {
  authenticateApi, apiJson, apiUnauthorized, apiMembership, canWriteRole, apiBoardDep,
} from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  is_done: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: { boardId: string } }) {
  const ctx = await authenticateApi(req);
  if (!ctx) return apiUnauthorized();
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return tooManyRequests(60);
  const depId = await apiBoardDep(ctx.admin, params.boardId);
  if (!depId) return apiJson({ error: 'Доска не найдена' }, 404);
  const role = await apiMembership(ctx.admin, ctx.userId, depId);
  if (!canWriteRole(role)) return apiJson({ error: 'Нет прав на изменение этой доски' }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return apiJson({ error: 'Некорректный запрос' }, 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiJson({ error: 'Название колонки должно быть от 1 до 60 символов' }, 400);

  const { data: last } = await ctx.admin.from('columns').select('position').eq('board_id', params.boardId).order('position', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await ctx.admin
    .from('columns')
    .insert({ board_id: params.boardId, name: parsed.data.name, is_done: parsed.data.is_done, position: (last?.position ?? -1) + 1 })
    .select('id,name,position,is_done')
    .single();
  if (error) return apiJson({ error: error.message }, 400);
  return apiJson({ column: data }, 201);
}