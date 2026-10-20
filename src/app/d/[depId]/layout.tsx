import { redirect } from 'next/navigation';
import Onboarding from '@/components/Onboarding';
import Nav from '@/components/Nav';
import Sidebar from '@/components/Sidebar';
import { createClient } from '@/lib/supabase/server';
import { lookFromRow } from '@/lib/profile';

export default async function DepLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { depId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: dep } = await supabase
    .from('departments')
    .select('id, name')
    .eq('id', params.depId)
    .maybeSingle();
  // Отдела нет или он удалён (например, другим владельцем) — возвращаем к выбору отдела
  if (!dep) redirect('/');
  const {data:hasAccess}=await supabase.rpc('is_member',{dep:dep.id});if(!hasAccess)redirect('/');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_icon, name_color')
    .eq('id', user.id)
    .maybeSingle();
  const look = lookFromRow(profile, user.email?.split('@')[0] ?? 'Профиль');

  const {data:departments} = await supabase.from('departments').select('id, name').order('name');
  return (
    <>
      <Onboarding userId={user.id}/>
      <Nav depId={dep.id} name={dep.name} userId={user.id} look={look} email={user.email} />
      <div className="mx-auto flex max-w-[1600px] flex-col lg:flex-row"><Sidebar depId={dep.id} departments={departments??[]}/><main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main></div>
    </>
  );
}
