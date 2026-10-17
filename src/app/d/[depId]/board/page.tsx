import { createClient } from '@/lib/supabase/server';
import { lookFromRow } from '@/lib/profile';
import Board, { type Label, type Member, type Task } from '@/components/Board';

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { depId: string };
  searchParams: { task?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requestedTask = searchParams.task ? (await supabase.from('tasks').select('board_id').eq('id',searchParams.task).maybeSingle()).data : null;
  let boardQuery = supabase.from('boards').select('id, name').eq('department_id',params.depId);
  if(requestedTask) boardQuery = boardQuery.eq('id',requestedTask.board_id);
  const {data:board} = await boardQuery.order('created_at').limit(1).maybeSingle();
  if (!board) return <p className="text-sm text-mute">Доска не найдена.</p>;

  const [{ data: columns }, { data: tasks }, { data: memberRows }, { data: labelRows }] = await Promise.all([
    supabase
      .from('columns')
      .select('id, name, position, is_done, color, wip_limit')
      .eq('board_id', board.id)
      .order('position'),
    supabase
      .from('tasks')
      .select('id, board_id, archived_at, column_id, title, description, priority, due_date, position, assignee_id, blocked_reason, task_checklist(id, title, is_done, position), task_labels(label_id)')
      .eq('board_id', board.id)
      .is('archived_at',null)
      .order('position'),
    supabase
      .from('department_members')
      .select('user_id, role, profiles(full_name, avatar_icon, name_color)')
      .eq('department_id', params.depId),
    supabase.from('labels').select('id, name').eq('department_id', params.depId).order('name'),
  ]);

  if(searchParams.task&&!(tasks??[]).some(t=>t.id===searchParams.task)){
    const {data:archived}=await supabase.from('tasks').select('id,board_id,archived_at,column_id,title,description,priority,due_date,position,assignee_id,blocked_reason,task_checklist(id,title,is_done,position),task_labels(label_id)').eq('id',searchParams.task).eq('board_id',board.id).maybeSingle();if(archived)tasks?.push(archived);
  }
  const taskLabels: Record<string, string[]> = {};
  const plainTasks = (tasks ?? []).map((row) => {
    const { task_labels, ...task } = row as typeof row & { task_labels?: { label_id: string }[] };
    taskLabels[task.id] = (task_labels ?? []).map((x) => x.label_id);
    return task;
  });
  const labels: Label[] = (labelRows ?? []).map((l) => ({ id: l.id, name: l.name }));

  const members: Member[] = (memberRows ?? []).map((m) => {
    const look = lookFromRow(m.profiles, m.user_id.slice(0, 8));
    return { id: m.user_id, name: look.name, icon: look.icon ?? null, color: look.color ?? null };
  });
  const myRole = (memberRows ?? []).find((m) => m.user_id === user!.id)?.role;

  return (
    <Board
      depId={params.depId}
      boardId={board.id}
      canWrite={myRole === 'owner' || myRole === 'member'}
      columns={columns ?? []}
      initialTasks={plainTasks as Task[]}
      members={members}
      currentUserId={user!.id}
      labels={labels}
      initialTaskLabels={taskLabels}
      openTaskId={searchParams.task ?? null}
    />
  );
}
