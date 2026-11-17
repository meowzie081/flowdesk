import Onboarding from '@/components/Onboarding';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UserMenu from '@/components/UserMenu';
import CreateDepartmentForm from '@/components/CreateDepartmentForm';
import Landing from '@/components/Landing';
import { lookFromRow } from '@/lib/profile';
import { getLang } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/dictionary';

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <Landing />;

  const { data: deps } = await supabase
    .from('departments')
    .select('id, name')
    .order('created_at');
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (profile?.must_change_password) redirect('/profile');
  const lang = getLang();
  const t = (key: string) => translate(lang, key);
  const look = lookFromRow(profile, user.email?.split('@')[0] ?? t('common.profile'));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Onboarding userId={user.id}/>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('home.title')}</h1>
        <UserMenu look={look} email={user.email} />
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
          <li className="text-sm text-mute">{t('home.empty')}</li>
        )}
      </ul>
      <CreateDepartmentForm />
      <Link href="/org" className="mt-4 inline-block text-sm font-medium text-orange-600 hover:underline">
        {t('home.orgLink')}
      </Link>
    </main>
  );
}