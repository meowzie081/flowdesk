import { authenticateApi, apiJson, apiUnauthorized } from '@/lib/api/auth';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

export async function GET(req: Request) {
  const ctx = await authenticateApi(req);
  if (!ctx) return apiUnauthorized();
  if (!(await checkRateLimit(`api:${ctx.tokenId}`, 120, 60))) return tooManyRequests(60);
  const { data, error } = await ctx.admin
    .from('department_members')
    .select('role,departments(id,name,created_at)')
    .eq('user_id', ctx.userId)
    .is('blocked_at', null);
  if (error) return apiJson({ error: 'Не удалось получить список отделов' }, 500);
  const departments = (data ?? [])
    .map((m) => {
      const dep = m.departments as unknown as { id: string; name: string; created_at: string } | null;
      return dep ? { ...dep, role: m.role } : null;
    })
    .filter(Boolean);
  return apiJson({ data: departments });
}