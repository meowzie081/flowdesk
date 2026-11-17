import { createClient } from '@/lib/supabase/server';
import ImportBoard from '@/components/ImportBoard';

export default async function ImportPage({ params }: { params: { depId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: member } = await supabase
    .from('department_members')
    .select('role')
    .eq('department_id', params.depId)
    .eq('user_id', user!.id)
    .maybeSingle();
  const canWrite = member?.role === 'owner' || member?.role === 'member';

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Импорт доски</h1>
      <p className="mt-2 text-sm text-mute">
        Перенесите задачи из Trello или CSV в новую доску этого отдела. Существующие доски не изменяются.
      </p>
      <ImportBoard depId={params.depId} canWrite={canWrite} />
    </main>
  );
}