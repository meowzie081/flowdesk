import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export type ApiContext = { admin: SupabaseClient; userId: string; tokenId: string };
export type MemberRole = 'owner' | 'member' | 'viewer';

export function apiJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function apiUnauthorized() {
  return apiJson({ error: 'Недействительный токен. Создайте персональный токен в профиле FlowDesk.' }, 401);
}

/** Токен ищется по sha256-хешу через service_role: браузерной сессии у API-клиента нет. */
export async function authenticateApi(request: Request): Promise<ApiContext | null> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (fd_[A-Za-z0-9_-]{20,128})$/.exec(header);
  if (!match) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const tokenHash = createHash('sha256').update(match[1]).digest('hex');
  const { data } = await admin.from('api_tokens').select('id,user_id,last_used_at').eq('token_hash', tokenHash).maybeSingle();
  if (!data) return null;
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 60_000) {
    await admin.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  }
  return { admin, userId: data.user_id, tokenId: data.id };
}

/** Эквивалент RLS-хелперов can_write/is_member: сервисная роль обходит RLS, поэтому права проверяем явно. */
export async function apiMembership(admin: SupabaseClient, userId: string, depId: string): Promise<MemberRole | null> {
  const { data } = await admin
    .from('department_members')
    .select('role,blocked_at')
    .eq('department_id', depId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data || data.blocked_at) return null;
  return data.role as MemberRole;
}

export function canWriteRole(role: MemberRole | null) {
  return role === 'owner' || role === 'member';
}

export async function apiBoardDep(admin: SupabaseClient, boardId: string): Promise<string | null> {
  const { data } = await admin.from('boards').select('department_id').eq('id', boardId).maybeSingle();
  return data?.department_id ?? null;
}

export async function apiColumnRef(admin: SupabaseClient, columnId: string): Promise<{ boardId: string; depId: string } | null> {
  const { data } = await admin.from('columns').select('board_id,boards(department_id)').eq('id', columnId).maybeSingle();
  const depId = (data?.boards as unknown as { department_id: string } | null)?.department_id;
  if (!data || !depId) return null;
  return { boardId: data.board_id, depId };
}

export async function apiTaskRef(admin: SupabaseClient, taskId: string): Promise<{ boardId: string; depId: string } | null> {
  const { data } = await admin.from('tasks').select('board_id,boards(department_id)').eq('id', taskId).maybeSingle();
  const depId = (data?.boards as unknown as { department_id: string } | null)?.department_id;
  if (!data || !depId) return null;
  return { boardId: data.board_id, depId };
}

/** Триггеры лимитов доверяют service_role, поэтому лимит тарифа проверяем до вставки доски. */
export async function boardLimitError(admin: SupabaseClient, depId: string): Promise<string | null> {
  const { data: dep } = await admin.from('departments').select('organization_id').eq('id', depId).maybeSingle();
  if (!dep?.organization_id) return null;
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan_id,plans(max_boards,name)')
    .eq('organization_id', dep.organization_id)
    .maybeSingle();
  const plan = sub?.plans as unknown as { max_boards: number; name: string } | null;
  const max = plan?.max_boards ?? 2;
  const { data: deps } = await admin.from('departments').select('id').eq('organization_id', dep.organization_id);
  const ids = (deps ?? []).map((d) => d.id);
  const { count } = await admin.from('boards').select('id', { count: 'exact', head: true }).in('department_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if ((count ?? 0) >= max) return `Тариф «${plan?.name ?? 'Free'}» позволяет не более ${max} досок. Удалите лишнюю или повысьте тариф.`;
  return null;
}