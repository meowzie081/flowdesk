'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { pickOwnedOrgId } from '@/lib/organizations';

export type CreateResult = { ok: true } | { ok: false; error: string };

export async function createDepartment(formData: FormData): Promise<CreateResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Название должно быть от 2 до 80 символов.' };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Войдите в аккаунт.' };

  // Организации появились в миграциях 0020/0021: если их ещё нет в БД,
  // запрос упадёт и мы создаём отдел по старой схеме.
  const { data: orgRows, error: orgError } = await supabase
    .from('org_members')
    .select('organization_id, role')
    .eq('user_id', user.id);
  const orgLayerReady = !orgError;
  const ownedOrgId = orgLayerReady ? pickOwnedOrgId(orgRows ?? []) : null;

  if (orgLayerReady && !ownedOrgId) {
    const { error } = await supabase.rpc('create_organization_with_workspace', { p_org_name: name });
    if (error) return { ok: false, error: error.message };
    revalidatePath('/');
    return { ok: true };
  }

  const { data: dep, error: depError } = await supabase
    .from('departments')
    .insert(ownedOrgId ? { name, created_by: user.id, organization_id: ownedOrgId } : { name, created_by: user.id })
    .select('id')
    .single();
  if (depError || !dep) return { ok: false, error: depError?.message ?? 'Не удалось создать отдел.' };

  const { error: memError } = await supabase
    .from('department_members')
    .insert({ department_id: dep.id, user_id: user.id, role: 'owner' });
  if (memError) return { ok: false, error: memError.message };

  const { data: board, error: boardError } = await supabase
    .from('boards')
    .insert({ department_id: dep.id, name: 'Основная доска' })
    .select('id')
    .single();
  if (boardError || !board) return { ok: false, error: boardError?.message ?? 'Не удалось создать доску.' };

  // is_done указан у каждой колонки: при разных наборах полей в одном запросе
  // отсутствующие значения становятся NULL и ломают NOT NULL.
  const { error: colError } = await supabase.from('columns').insert([
    { board_id: board.id, name: 'Backlog', position: 0, is_done: false },
    { board_id: board.id, name: 'В работе', position: 1, is_done: false },
    { board_id: board.id, name: 'Ревью', position: 2, is_done: false },
    { board_id: board.id, name: 'Готово', position: 3, is_done: true },
  ]);
  if (colError) return { ok: false, error: colError.message };

  revalidatePath('/');
  return { ok: true };
}