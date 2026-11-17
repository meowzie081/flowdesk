import { z } from 'zod';
import {
  authenticateApi, apiJson, apiUnauthorized, apiMembership, canWriteRole, boardLimitError,
} from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

const DEFAULT_COLUMNS = [
  { name: 'Backlog', is_done: false },
  { name: 'В работе', is_done: false },
  { name: 'Ревью', is_done: false },
  { name: 'Готово', is_done: true },
];

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  columns: z.array(z.object({ name: z.string().trim().min(1).max(60), is_done: z.boolean().default(false) })).min(1).max(50).optional(),
});

export async function GET(req: Request, { params }: { params: { depId: string } }) {
  const ctx = await authenticateApi(req);
  if (!ctx) return apiUnauthorized();
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return tooManyRequests(60);
  const role = await apiMembership(ctx.admin, ctx.userId, params.depId);
  if (!role) return apiJson({ error: 'Нет доступа к этому отделу' }, 403);
  const { data, error } = await ctx.admin.from('boards').select('id,name,created_at').eq('department_id', params.depId).order('created_at');
  if (error) return apiJson({ error: 'Не удалось получить доски' }, 500);
  return apiJson({ data });
}

export async function POST(req: Request, { params }: { params: { depId: string } }) {
  const ctx = await authenticateApi(req);
  if (!ctx) return apiUnauthorized();
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return tooManyRequests(60);
  const role = await apiMembership(ctx.admin, ctx.userId, params.depId);
  if (!canWriteRole(role)) return apiJson({ error: 'Нет прав на создание досок в этом отделе' }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return apiJson({ error: 'Некорректный запрос' }, 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiJson({ error: 'Проверьте название доски и колонки' }, 400);

  const limitError = await boardLimitError(ctx.admin, params.depId);
  if (limitError) return apiJson({ error: limitError }, 403);

  const { data: board, error } = await ctx.admin
    .from('boards')
    .insert({ department_id: params.depId, name: parsed.data.name })
    .select('id,name,created_at')
    .single();
  if (error || !board) return apiJson({ error: error?.message ?? 'Не удалось создать доску' }, 400);

  const columns = (parsed.data.columns ?? DEFAULT_COLUMNS).map((c, i) => ({ board_id: board.id, name: c.name, position: i, is_done: c.is_done }));
  const { data: cols, error: colError } = await ctx.admin.from('columns').insert(columns).select('id,name,position,is_done');
  if (colError) {
    await ctx.admin.from('boards').delete().eq('id', board.id);
    return apiJson({ error: colError.message }, 400);
  }
  return apiJson({ board, columns: cols }, 201);
}