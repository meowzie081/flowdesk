import { createClient } from '@/lib/supabase/server';
import Chat from '@/components/Chat';
import { lookFromRow } from '@/lib/profile';
import { CHAT_FIELDS } from '@/lib/collaboration';

export default async function ChatPage({ params, searchParams }: { params: { depId: string }; searchParams: { message?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: messages }, { data: member }, { data: board }, { data: memberRows }] = await Promise.all([
    supabase
      .from('chat_messages')
      .select(CHAT_FIELDS)
      .eq('department_id', params.depId)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .order('id', {ascending:false})
      .limit(100),
    supabase.from('department_members').select('role').eq('department_id', params.depId).eq('user_id', user!.id).single(),
    supabase.from('boards').select('id').eq('department_id', params.depId).order('created_at').limit(1).maybeSingle(),
    supabase
      .from('department_members')
      .select('user_id, profiles(full_name, avatar_icon, name_color)')
      .eq('department_id', params.depId),
  ]);

  const looks: Record<string, { name: string; icon: string | null; color: string | null }> = {};
  for (const m of memberRows ?? []) {
    const l = lookFromRow(m.profiles, m.user_id.slice(0, 8));
    looks[m.user_id] = { name: l.name, icon: l.icon ?? null, color: l.color ?? null };
  }

  const firstColumn = board
    ? (
        await supabase
          .from('columns')
          .select('id')
          .eq('board_id', board.id)
          .order('position')
          .limit(1)
          .maybeSingle()
      ).data
    : null;

  const {data: readInfo} = await supabase.rpc('chat_unread',{dep:params.depId});
  return (
    <Chat
      initialRead={readInfo??{count:0,first_id:null,last_read_at:new Date(0).toISOString(),last_read_id:'00000000-0000-0000-0000-000000000000'}}
      targetMessageId={searchParams.message??null}
      depId={params.depId}
      userId={user!.id}
      canWrite={member?.role === 'owner' || member?.role === 'member'}
      boardId={board?.id ?? null}
      firstColumnId={firstColumn?.id ?? null}
      initial={(messages ?? []).reverse()}
      looks={looks}
    />
  );
}
