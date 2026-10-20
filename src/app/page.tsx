import Onboarding from '@/components/Onboarding';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import UserMenu from '@/components/UserMenu';
import { lookFromRow } from '@/lib/profile';

async function createDepartment(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 80) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: dep, error: depError } = await supabase
    .from('departments')
    .insert({ name, created_by: user.id })
    .select('id')
    .single();
  if (depError || !dep) throw new Error(`Не удалось создать отдел: ${depError?.message}`);

  const { error: memError } = await supabase
    .from('department_members')
    .insert({ department_id: dep.id, user_id: user.id, role: 'owner' });
  if (memError) throw new Error(`Не удалось добавить владельца: ${memError.message}`);

  const { data: board, error: boardError } = await supabase
    .from('boards')
    .insert({ department_id: dep.id, name: 'Основная доска' })
    .select('id')
    .single();
  if (boardError || !board) throw new Error(`Не удалось создать доску: ${boardError?.message}`);

  // is_done указан у каждой колонки: при разных наборах полей в одном запросе
  // отсутствующие значения становятся NULL и ломают NOT NULL.
  const { error: colError } = await supabase.from('columns').insert([
    { board_id: board.id, name: 'Backlog', position: 0, is_done: false },
    { board_id: board.id, name: 'В работе', position: 1, is_done: false },
    { board_id: board.id, name: 'Ревью', position: 2, is_done: false },
    { board_id: board.id, name: 'Готово', position: 3, is_done: true },
  ]);
  if (colError) throw new Error(`Не удалось создать колонки: ${colError.message}`);

  revalidatePath('/');
}

export default async function Home() {
  const supabase = createClient();
  const { data: deps } = await supabase
    .from('departments')
    .select('id, name')
    .order('created_at');
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('profiles').select('full_name, avatar_icon, name_color').eq('id', user.id).maybeSingle()
    : { data: null };
  const look = lookFromRow(profile, user?.email?.split('@')[0] ?? 'Профиль');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {user && <Onboarding userId={user.id}/>}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ваши отделы</h1>
        <UserMenu look={look} email={user?.email} />
      </div>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {(deps ?? []).map((d) => (
          <li key={d.id}>
            <Link href={`/d/${d.id}/my-day`} className="card block hover:border-ink">
              {d.name}
            </Link>
          </li>
        ))}
        {(deps ?? []).length === 0 && (
          <li className="text-sm text-mute">Пока нет отделов — создайте первый.</li>
        )}
      </ul>
      <form action={createDepartment} className="mt-8 flex gap-2">
        <input name="name" className="input" placeholder="Название отдела" required minLength={2} maxLength={80} />
        <button className="btn-solid">Создать</button>
      </form>
    </main>
  );
}
