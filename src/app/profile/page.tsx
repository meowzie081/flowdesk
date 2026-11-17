import NotificationSettings from '@/components/NotificationSettings';
import ApiTokens from '@/components/ApiTokens';
import Onboarding from '@/components/Onboarding';
import Link from 'next/link';
import { accountLabel } from '@/lib/accounts';
import { redirect } from 'next/navigation';
import PasswordForm from '@/components/PasswordForm';
import ProfileForm from '@/components/ProfileForm';
import { createClient } from '@/lib/supabase/server';
import { lookFromRow } from '@/lib/profile';

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const look = lookFromRow(profile, user.email?.split('@')[0] ?? '');

  const { data: apiTokens, error: tokensError } = await supabase
    .from('api_tokens')
    .select('id,name,token_prefix,created_at,last_used_at')
    .eq('user_id', user.id)
    .order('created_at');

  if (profile?.must_change_password) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Смените временный пароль</h1>
        <p className="mt-2 text-sm text-mute">
          Владелец отдела выдал вам временный пароль. Задайте свой пароль, чтобы продолжить работу.
        </p>
        <PasswordForm/>
        <form action="/auth/signout" method="post" className="mt-10 border-t border-line pt-6">
          <button className="btn">Выйти из аккаунта</button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm text-mute hover:text-ink">
        ← К отделам
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Профиль</h1>
      <p className="mt-1 text-sm text-mute">{accountLabel(user.email)}</p>
      <div className="mt-6">
        <ProfileForm userId={user.id} initial={{ name: look.name, icon: look.icon ?? null, color: look.color ?? null }} />
      </div>
      <PasswordForm/>
      <NotificationSettings/>
      <ApiTokens tokens={tokensError ? null : (apiTokens ?? [])}/>
      <Onboarding userId={user.id} auto={false}/>
      <form action="/auth/signout" method="post" className="mt-10 border-t border-line pt-6">
        <button className="btn">Выйти из аккаунта</button>
      </form>
    </main>
  );
}
