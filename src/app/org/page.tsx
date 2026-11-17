import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UserMenu from '@/components/UserMenu';
import { lookFromRow } from '@/lib/profile';

type Usage = {
  member_count: number;
  board_count: number;
  max_members: number;
  max_boards: number;
  plan_id: string;
  plan_name: string;
  price_per_seat_month: number | null;
};

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const full = used >= max;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-mute">{label}</span>
        <span className={full ? 'font-semibold text-red-600' : 'font-medium'}>
          {used} / {max}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className={`h-full rounded-full ${full ? 'bg-red-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function OrgPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (profile?.must_change_password) redirect('/profile');
  const look = lookFromRow(profile, user.email?.split('@')[0] ?? 'Профиль');

  const { data: memberships, error } = await supabase
    .from('org_members')
    .select('organization_id, role, organizations(name)')
    .eq('user_id', user.id);

  const orgs = (memberships ?? []).map((m) => ({
    id: m.organization_id as string,
    role: m.role as string,
    name: (m.organizations as { name?: string } | null)?.name ?? 'Организация',
  }));

  const usages = await Promise.all(
    orgs.map(async (o) => {
      const { data } = await supabase.rpc('org_usage', { org: o.id });
      return { org: o, usage: (Array.isArray(data) ? data[0] : data) as Usage | null };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Организация и тариф</h1>
        <UserMenu look={look} email={user.email} />
      </div>
      <p className="mt-2 text-sm text-mute">
        Отделы объединены в организации. Лимиты тарифа считаются на всю организацию: участники и доски всех её отделов.
      </p>
      <Link href="/" className="mt-3 inline-block text-sm font-medium text-orange-600 hover:underline">
        ← К списку отделов
      </Link>

      {error && (
        <div className="card mt-6 text-sm text-mute">
          Слой организаций ещё не включён в этой базе. Примените миграции 0020–0022 в Supabase SQL Editor — после этого здесь появятся тариф и использование.
        </div>
      )}

      {!error && orgs.length === 0 && (
        <div className="card mt-6 text-sm text-mute">
          У вас пока нет организации. Создайте отдел на главной — он автоматически станет вашей первой организацией.
        </div>
      )}

      <div className="mt-6 grid gap-4">
        {usages.map(({ org, usage }) => (
          <section key={org.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{org.name}</h2>
              <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-mute">
                {org.role === 'owner' ? 'владелец' : org.role === 'admin' ? 'администратор' : 'участник'}
              </span>
            </div>
            {usage ? (
              <div className="mt-4 grid gap-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">Тариф {usage.plan_name}</span>
                  {usage.price_per_seat_month != null ? (
                    <span className="text-sm text-mute">{usage.price_per_seat_month} ₽ за место в месяц</span>
                  ) : (
                    <span className="text-sm text-mute">бесплатно</span>
                  )}
                </div>
                <Meter label="Участники" used={usage.member_count} max={usage.max_members} />
                <Meter label="Доски" used={usage.board_count} max={usage.max_boards} />
                {usage.plan_id === 'free' && (
                  <p className="text-sm text-mute">
                    Нужно больше участников и досок? Тариф Team — 299 ₽ за место в месяц: до 500 участников и 100 досок.
                    Оплата подключается позже — напишите нам, чтобы перейти на Team.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-mute">Не удалось загрузить использование тарифа.</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}