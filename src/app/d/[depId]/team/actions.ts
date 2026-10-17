'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { chunk, confirmationMatches } from '@/lib/departments';

export type DeleteResult = { ok: true } | { ok: false; error: string };

/**
 * Удаление отдела. Возвращает результат, а переход на страницу выбора отдела делает браузер
 * (см. DeleteDepartmentForm): так переход гарантированно происходит после удаления.
 */
export async function deleteDepartment(depId: string, confirm: string): Promise<DeleteResult> {
  if (!z.string().uuid().safeParse(depId).success) return { ok: false, error: 'Некорректный отдел.' };

  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: 'Сессия истекла — войдите заново.' };

  // Только владелец; название берём из базы, а не от клиента
  const { data: member } = await sb
    .from('department_members')
    .select('role')
    .eq('department_id', depId)
    .eq('user_id', user.id)
    .maybeSingle();
  const { data: dep } = await sb.from('departments').select('name').eq('id', depId).maybeSingle();
  if (member?.role !== 'owner' || !dep) return { ok: false, error: 'Удалять отдел может только владелец.' };
  if (!confirmationMatches(confirm, dep.name)) return { ok: false, error: 'Название не совпало — отдел не удалён.' };

  // Файлы задач лежат в Storage отдельно от таблиц — чистим их до удаления отдела
  const { data: boards } = await sb.from('boards').select('id').eq('department_id', depId);
  const boardIds = (boards ?? []).map((b) => b.id);
  if (boardIds.length > 0) {
    const { data: tasks } = await sb.from('tasks').select('id').in('board_id', boardIds);
    const taskIds = (tasks ?? []).map((t) => t.id);
    if (taskIds.length > 0) {
      const { data: files } = await sb.from('attachments').select('storage_path').in('task_id', taskIds);
      const paths = (files ?? []).map((f) => f.storage_path as string);
      for (const part of chunk(paths, 100)) {
        await sb.storage.from('attachments').remove(part);
      }
    }
  }

  // Остальное (доски, колонки, задачи, чат, метки, события, приглашения) удаляется каскадом
  const { data: deleted, error } = await sb.from('departments').delete().eq('id', depId).select('id');
  if (error || !deleted || deleted.length === 0) {
    return { ok: false, error: 'Не удалось удалить отдел. Попробуйте ещё раз.' };
  }

  revalidatePath('/');
  return { ok: true };
}
