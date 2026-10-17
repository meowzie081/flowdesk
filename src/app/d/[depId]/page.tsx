import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import UserName from '@/components/UserName';
import { lookFromRow, type ProfileLook } from '@/lib/profile';
import AiAction from '@/components/AiAction';
import DailySummary from '@/components/DailySummary';
import { moscowDay } from '@/lib/collaboration';
import {
  computeDeadlineRisks,
  computeWorkload,
  type ACol,
  type ATask,
  type LoadStatus,
  type RiskLevel,
} from '@/lib/analytics';

const NEW_SESSION_GAP_MS = 30 * 60 * 1000;
const WEEK_MS = 7 * 86_400_000;

const LOAD_LABEL: Record<LoadStatus, string> = {
  overloaded: 'перегружен',
  normal: 'в норме',
  free: 'есть ресурс',
};
const RISK_LABEL: Record<RiskLevel, string> = {
  overdue: 'просрочено',
  high: 'высокий риск',
  medium: 'следить',
};

export default async function Dashboard({ params }: { params: { depId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: boards } = await supabase
    .from('boards')
    .select('id')
    .eq('department_id', params.depId);
  const boardIds = (boards ?? []).map((b) => b.id);

  const [
    { count: total },
    { data: stuck },
    { data: me },
    { data: member },
    { data: colRows },
    { data: taskRows },
    { data: memberRows },
  ] = await Promise.all([
    supabase.from('tasks').select('id', { count: 'exact', head: true }).is('archived_at',null).in('board_id', boardIds),
    supabase
      .from('stuck_tasks')
      .select('id, title, days_stuck')
      .in('board_id', boardIds)
      .order('days_stuck', { ascending: false })
      .limit(5),
    supabase.from('profiles').select('last_seen_at, prev_seen_at').eq('id', userId).single(),
    supabase
      .from('department_members')
      .select('role')
      .eq('department_id', params.depId)
      .eq('user_id', userId)
      .single(),
    supabase.from('columns').select('id, position, is_done').in('board_id', boardIds),
    supabase
      .from('tasks')
      .select('id, title, column_id, assignee_id, priority, due_date, created_at, moved_at').is('archived_at',null)
      .in('board_id', boardIds)
      .limit(1000),
    supabase.from('department_members').select('user_id, profiles(full_name, avatar_icon, name_color)').eq('department_id', params.depId),
  ]);

  // Аналитика по доске: загрузка команды и риск срыва сроков
  const cols: ACol[] = (colRows ?? []).map((c) => ({ id: c.id, position: c.position, isDone: !!c.is_done }));
  const atasks: ATask[] = (taskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    columnId: t.column_id,
    assigneeId: t.assignee_id ?? null,
    priority: t.priority,
    dueDate: t.due_date ?? null,
    createdAt: t.created_at,
    movedAt: t.moved_at,
  }));
  const looks = new Map<string, ProfileLook>();
  for (const m of memberRows ?? []) looks.set(m.user_id, lookFromRow(m.profiles, m.user_id.slice(0, 8)));
  const analyticsNow = new Date();
  const { rows: workload, unassigned } = computeWorkload(atasks, cols, [...looks.keys()], analyticsNow);
  const risks = computeDeadlineRisks(atasks, cols, analyticsNow).slice(0, 6);
  const maxScore = Math.max(1, ...workload.map((w) => w.score));

  // «Что я пропустил»: отсчёт от предыдущего визита. Новый визит начинается после 30 минут паузы,
  // поэтому дайджест не пропадает при обновлении страницы.
  const now = new Date();
  const lastSeen = me?.last_seen_at ? new Date(me.last_seen_at) : new Date(0);
  const isNewVisit = now.getTime() - lastSeen.getTime() > NEW_SESSION_GAP_MS;
  const since: string = isNewVisit
    ? lastSeen.toISOString()
    : (me?.prev_seen_at ?? me?.last_seen_at ?? new Date(0).toISOString());

  const { data: missed } = await supabase
    .from('task_events')
    .select('id, kind, payload, created_at')
    .eq('department_id', params.depId)
    .gt('created_at', since)
    .or(`actor_id.is.null,actor_id.neq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(20);

  await supabase
    .from('profiles')
    .update(
      isNewVisit
        ? { prev_seen_at: lastSeen.toISOString(), last_seen_at: now.toISOString() }
        : { last_seen_at: now.toISOString() },
    )
    .eq('id', userId);

  const canUseAi = member?.role === 'member' || member?.role === 'owner';

  const KIND: Record<string, string> = {
    created: 'создана задача',
    moved: 'задача перемещена',
    assigned: 'назначен исполнитель',
    commented: 'новый комментарий',
    done: 'задача завершена',
    edited: 'задача изменена',
    checklist: 'изменён чек-лист',
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <section className="md:col-span-3"><div className="mb-3 flex items-center justify-between"><h1 className="text-xl font-semibold">Сегодня в команде</h1><Link href={`/d/${params.depId}/summary`} className="text-sm text-orange-600">Сводка за день ↗</Link></div><DailySummary depId={params.depId} date={moscowDay()} compact/></section>
      <section className="card">
        <h2 className="text-sm text-mute">Всего задач</h2>
        <p className="mt-2 text-4xl font-semibold">{total ?? 0}</p>
      </section>

      <section className="card md:col-span-2">
        <h2 className="text-sm text-mute">Радар блокеров</h2>
        {(stuck ?? []).length === 0 ? (
          <p className="mt-2 text-sm">Застрявших задач нет.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {stuck!.map((t) => (
              <li key={t.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-mute">{t.days_stuck} дн. без движения</span>
                  {canUseAi && (
                    <AiAction
                      label="Что делать?"
                      className="ml-auto"
                      request={{ departmentId: params.depId, command: 'blocker', taskId: t.id }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card md:col-span-2">
        <h2 className="text-sm text-mute">Загрузка команды</h2>
        {workload.every((w) => w.open === 0) ? (
          <p className="mt-2 text-sm">Открытых задач с исполнителями нет.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {workload.map((w) => (
              <li key={w.userId} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <UserName
                    className="font-medium"
                    look={looks.get(w.userId ?? '') ?? { name: 'без имени' }}
                  />
                  <span className="text-mute">
                    {w.open} задач{w.overdue > 0 && `, просрочено ${w.overdue}`}
                    {w.high > 0 && `, срочных ${w.high}`}
                  </span>
                  <span
                    className={`ml-auto text-xs ${
                      w.status === 'overloaded' ? 'font-medium text-red-600' : 'text-mute'
                    }`}
                  >
                    {LOAD_LABEL[w.status]}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-neutral-200">
                  <div
                    className={`h-1.5 rounded-full ${w.status === 'free' ? 'bg-mute' : 'bg-ink'}`}
                    style={{ width: `${Math.max(w.score > 0 ? 4 : 0, Math.round((w.score / maxScore) * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {unassigned > 0 && (
          <p className="mt-3 text-xs text-mute">
            Без исполнителя: {unassigned}.{' '}
            <Link href={`/d/${params.depId}/board`} className="underline">
              Назначить на доске
            </Link>
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="text-sm text-mute">Риск срыва сроков</h2>
        {risks.length === 0 ? (
          <p className="mt-2 text-sm">Угроз срокам не видно.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {risks.map((r) => (
              <li key={r.taskId} className="py-2 text-sm">
                <Link href={`/d/${params.depId}/board?task=${r.taskId}`} className="font-medium hover:underline">
                  {r.title}
                </Link>
                <p className="text-xs text-mute">
                  <span className={r.level === 'medium' ? '' : 'font-medium text-red-600'}>
                    {RISK_LABEL[r.level]}
                  </span>
                  {' · '}
                  {r.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canUseAi && (
        <section className="card md:col-span-3">
          <h2 className="text-sm text-mute">Недельный отчёт</h2>
          <p className="text-xs text-mute">
            Сделано, в работе, риски и планы за 7 дней — по данным доски. Можно скачать в .md.
          </p>
          <AiAction
            className="mt-3"
            label="Составить отчёт"
            downloadName={`flowdesk-report-${analyticsNow.toISOString().slice(0, 10)}.md`}
            request={{
              departmentId: params.depId,
              command: 'report',
              since: new Date(analyticsNow.getTime() - WEEK_MS).toISOString(),
            }}
          />
        </section>
      )}

      <section className="card md:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm text-mute">Что я пропустил</h2>
          {canUseAi && (missed ?? []).length > 0 && (
            <AiAction
              label="Резюме от ИИ"
              request={{ departmentId: params.depId, command: 'digest', since }}
            />
          )}
        </div>
        {(missed ?? []).length === 0 ? (
          <p className="mt-2 text-sm">С прошлого визита ничего нового.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {missed!.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-2 text-sm">
                <span>
                  {KIND[e.kind] ?? e.kind}
                  {e.payload?.title ? `: ${e.payload.title}` : ''}
                </span>
                <time className="shrink-0 text-mute">
                  {new Date(e.created_at).toLocaleString('ru-RU')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
