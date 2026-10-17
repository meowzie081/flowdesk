import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UserName from '@/components/UserName';
import { lookFromRow } from '@/lib/profile';
import Link from 'next/link';
import MemberAccess from '@/components/MemberAccess';
import CreateUserForm from '@/components/CreateUserForm';
import DeleteDepartmentForm from '@/components/DeleteDepartmentForm';

const ROLES = ['owner', 'member', 'viewer'] as const;

const INVITE_NOTICE: Record<string, { text: string; error?: boolean }> = {
  added: { text: 'Пользователь уже зарегистрирован — добавлен в отдел.' },
  pending: {
    text: 'Приглашение сохранено. Когда человек зарегистрируется с этим email и подтвердит почту, он попадёт в отдел автоматически.',
  },
  invalid: { text: 'Проверьте email и роль.', error: true },
  error: { text: 'Не удалось отправить приглашение. Приглашать могут только владельцы.', error: true },
};

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: { depId: string };
  searchParams: { invite?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: members } = await supabase
    .from('department_members')
    .select('user_id, role, blocked_at, profiles(full_name, avatar_icon, name_color)')
    .eq('department_id', params.depId);

  const {data:managed} = members?.length ? await supabase.from('managed_accounts').select('user_id, login, created_by').in('user_id',members.map(m=>m.user_id)) : {data:[]};
  const logins=new Map((managed??[]).map(m=>[m.user_id,m.login]));

  const myRole = members?.find((m) => m.user_id === user!.id)?.role;
  const isOwner = myRole === 'owner';

  const { data: invites } = isOwner
    ? await supabase
        .from('invites')
        .select('id, email, role')
        .eq('department_id', params.depId)
        .order('created_at')
    : { data: [] as { id: string; email: string; role: string }[] };

  async function setRole(formData: FormData) {
    'use server';
    const role = String(formData.get('role'));
    const userId = String(formData.get('user_id'));
    if (!(ROLES as readonly string[]).includes(role)) return;
    const sb = createClient();
    await sb
      .from('department_members')
      .update({ role })
      .eq('department_id', params.depId)
      .eq('user_id', userId);
    revalidatePath(`/d/${params.depId}/team`);
  }

  async function removeMember(formData: FormData) {
    'use server';
    const userId = String(formData.get('user_id'));
    const sb = createClient();
    await sb
      .from('department_members')
      .delete()
      .eq('department_id', params.depId)
      .eq('user_id', userId);
    revalidatePath(`/d/${params.depId}/team`);
  }

  async function invite(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const role = String(formData.get('role') ?? 'member');
    if (!/^\S+@\S+\.\S+$/.test(email) || !(ROLES as readonly string[]).includes(role)) {
      redirect(`/d/${params.depId}/team?invite=invalid`);
    }
    const sb = createClient();
    const { data, error } = await sb.rpc('invite_member', {
      dep: params.depId,
      member_email: email,
      new_role: role,
    });
    if (error) redirect(`/d/${params.depId}/team?invite=error`);
    redirect(`/d/${params.depId}/team?invite=${data === 'added' ? 'added' : 'pending'}`);
  }

  async function cancelInvite(formData: FormData) {
    'use server';
    const id = String(formData.get('id'));
    const sb = createClient();
    await sb.from('invites').delete().eq('id', id).eq('department_id', params.depId);
    revalidatePath(`/d/${params.depId}/team`);
  }

  const notice = searchParams.invite ? INVITE_NOTICE[searchParams.invite] : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold tracking-tight">Команда</h1>{isOwner&&<Link className="btn" href={`/d/${params.depId}/audit`}>Журнал администратора</Link>}</div>

      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
        {(members ?? []).map((m) => {
          return (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div><UserName look={lookFromRow(m.profiles, m.user_id.slice(0, 8))} />{m.blocked_at&&<p className="text-xs text-red-600">Доступ приостановлен</p>}{logins.get(m.user_id)&&<p className="text-xs text-mute">Логин: {logins.get(m.user_id)}</p>}</div>
              {isOwner && m.user_id !== user!.id ? (
                <div className="flex gap-2">
                  <form action={setRole} className="flex gap-2">
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <select name="role" defaultValue={m.role} className="rounded border border-line px-2 py-1">
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button className="btn py-1">Сохранить</button>
                  </form>
                  <form action={removeMember}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <button className="btn py-1" aria-label="Убрать из отдела">
                      Убрать
                    </button>
                  </form>
                </div>
              ) : (
                <span className="text-mute">{m.role}</span>
              )}
              {isOwner&&m.user_id!==user!.id&&<MemberAccess depId={params.depId} userId={m.user_id} blocked={!!m.blocked_at} canReset={(managed??[]).some(a=>a.user_id===m.user_id&&a.created_by===user!.id)}/>}
            </li>
          );
        })}
      </ul>

      {isOwner && <CreateUserForm depId={params.depId}/>}
      {isOwner && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Пригласить по email</h2>
          <form action={invite} className="mt-2 flex flex-wrap gap-2">
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              placeholder="colleague@company.com"
              className="input max-w-xs"
            />
            <select name="role" defaultValue="member" className="input w-auto">
              <option value="member">member — может редактировать</option>
              <option value="viewer">viewer — только просмотр</option>
              <option value="owner">owner — полный доступ</option>
            </select>
            <button className="btn-solid">Пригласить</button>
          </form>
          {notice && (
            <p className={`mt-2 text-sm ${notice.error ? 'text-red-600' : 'text-mute'}`}>{notice.text}</p>
          )}

          {(invites ?? []).length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs text-mute">Ожидают регистрации</h3>
              <ul className="mt-1 divide-y divide-line rounded-lg border border-line bg-white">
                {invites!.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <span>
                      {i.email} <span className="text-mute">· {i.role}</span>
                    </span>
                    <form action={cancelInvite}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="btn py-1">Отменить</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {isOwner && (
        <section className="mt-10 rounded-lg border border-red-600/40 p-4">
          <h2 className="text-sm font-medium text-red-600">Удаление отдела</h2>
          <p className="mt-1 text-sm text-mute">
            Будут безвозвратно удалены доски, задачи, комментарии, файлы, чат и приглашения этого отдела.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm underline">Удалить отдел…</summary>
            <DeleteDepartmentForm depId={params.depId} />
          </details>
        </section>
      )}
    </div>
  );
}
