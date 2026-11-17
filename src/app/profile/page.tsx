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
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { getLang } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/dictionary';

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
  const lang = getLang();
  const t = (key: string) => translate(lang, key);

  const { data: apiTokens, error: tokensError } = await supabase
    .from('api_tokens')
    .select('id,name,token_prefix,created_at,last_used_at')
    .eq('user_id', user.id)
    .order('created_at');

  if (profile?.must_change_password) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('profile.tempPassword.title')}</h1>
        <p className="mt-2 text-sm text-mute">
          {t('profile.tempPassword.hint')}
        </p>
        <PasswordForm/>
        <form action="/auth/signout" method="post" className="mt-10 border-t border-line pt-6">
          <button className="btn">{t('profile.signOutAccount')}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="text-sm text-mute hover:text-ink">
        {t('profile.backToDepartments')}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t('common.profile')}</h1>
      <p className="mt-1 text-sm text-mute">{accountLabel(user.email)}</p>
      <div className="mt-6">
        <ProfileForm userId={user.id} initial={{ name: look.name, icon: look.icon ?? null, color: look.color ?? null }} />
      </div>
      <LanguageSwitcher/>
      <PasswordForm/>
      <NotificationSettings/>
      <ApiTokens tokens={tokensError ? null : (apiTokens ?? [])}/>
      <Onboarding userId={user.id} auto={false}/>
      <form action="/auth/signout" method="post" className="mt-10 border-t border-line pt-6">
        <button className="btn">{t('profile.signOutAccount')}</button>
      </form>
    </main>
  );
}
