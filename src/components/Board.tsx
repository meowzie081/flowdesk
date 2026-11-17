'use client';
import {trackEvent} from '@/lib/analytics-client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import TaskDetail from './TaskDetail';
import UserName from './UserName';
import Icon from './Icon';
import ColumnSettings from './ColumnSettings';
import { checklistProgress, columnLoad, type ChecklistItem } from '@/lib/collaboration';
import { applyColumnChange, applyTaskChange, mergeFetchedTasks, type RealtimeChange } from '@/lib/board-sync';
import { useI18n } from './I18nProvider';

export interface Column {
  id: string;
  name: string;
  position: number;
  is_done: boolean;
  color: string;
  wip_limit: number | null;
}
export interface Member {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
}
export interface Label {
  id: string;
  name: string;
}
export interface Task {
  board_id: string;
  archived_at: string | null;
  task_checklist: ChecklistItem[];
  blocked_reason: string;
  id: string;
  column_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  position: number;
  assignee_id: string | null;
}

const TASK_FIELDS =
  'id, board_id, archived_at, column_id, title, description, priority, due_date, position, assignee_id, blocked_reason, task_checklist(id, title, is_done, position)';

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export default function Board({
  depId,
  boardId,
  canWrite,
  columns: initialColumns,
  initialTasks,
  members,
  currentUserId,
  labels,
  initialTaskLabels,
  openTaskId,
}: {
  depId: string;
  boardId: string;
  canWrite: boolean;
  columns: Column[];
  initialTasks: Task[];
  members: Member[];
  currentUserId: string;
  labels: Label[];
  initialTaskLabels: Record<string, string[]>;
  openTaskId?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { t: tr, lang } = useI18n();
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState<'all' | Task['priority']>('all');
  const [assignee, setAssignee] = useState<string>('all'); // all | me | none | <user id>
  const [newTitle, setNewTitle] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [labelList, setLabelList] = useState<Label[]>(labels);
  const [taskLabels, setTaskLabels] = useState<Record<string, string[]>>(initialTaskLabels);
  const [labelFilter, setLabelFilter] = useState<string>('all');
  const [openTask, setOpenTask] = useState<Task | null>(
    () => initialTasks.find((t) => t.id === openTaskId) ?? null,
  );
  const [readiness,setReadiness]=useState<Record<string,number>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toastId = useRef(0);
  const flipRef = useRef<{ id: string; rect: DOMRect } | null>(null);

  function pushToast(text: string) {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 2600);
  }

  // FLIP: карточка плавно перелетает на новое место после перерисовки колонок.
  useLayoutEffect(() => {
    const flip = flipRef.current;
    if (!flip) return;
    flipRef.current = null;
    const el = document.querySelector<HTMLElement>(`[data-task-id="${flip.id}"]`);
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const next = el.getBoundingClientRect();
    const dx = flip.rect.left - next.left;
    const dy = flip.rect.top - next.top;
    if (dx || dy) el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }],
      { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }, [tasks]);

  function rememberRect(taskId: string) {
    const el = document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
    if (el) flipRef.current = { id: taskId, rect: el.getBoundingClientRect() };
  }

  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const [{data: taskRows}, {data: columnRows}] = await Promise.all([
        supabase.from('tasks').select(TASK_FIELDS).eq('board_id',boardId).is('archived_at',null).order('position'),
        supabase.from('columns').select('id, name, position, is_done, color, wip_limit').eq('board_id',boardId).order('position').order('id'),
      ]);
      if (!alive) return;
      if (taskRows) {setTasks(taskRows as Task[]);if(taskRows.length){const {data}=await supabase.from('task_readiness').select('id,blocked_count').in('id',taskRows.map(t=>t.id));if(alive&&data)setReadiness(Object.fromEntries(data.map(t=>[t.id,Number(t.blocked_count)])))}}
      if (columnRows) setColumns(columnRows as Column[]);
    }

    // Realtime-события плоские: вложенные чек-листы догружаем отдельным запросом.
    const pendingFetch = new Set<string>();
    let fetchTimer: ReturnType<typeof setTimeout> | null = null;
    let readinessTimer: ReturnType<typeof setTimeout> | null = null;

    async function flushFetches() {
      fetchTimer = null;
      const ids = [...pendingFetch];
      pendingFetch.clear();
      if (!ids.length) return;
      const { data } = await supabase.from('tasks').select(TASK_FIELDS).in('id', ids);
      if (!alive || !data) return;
      const rows = (data as Task[]).filter((t) => !t.archived_at);
      if (rows.length) setTasks((prev) => mergeFetchedTasks(prev, rows));
    }

    function scheduleReadiness() {
      if (readinessTimer) clearTimeout(readinessTimer);
      readinessTimer = setTimeout(async () => {
        readinessTimer = null;
        const ids = tasksRef.current.map((t) => t.id);
        if (!ids.length) return;
        const { data } = await supabase.from('task_readiness').select('id,blocked_count').in('id', ids);
        if (alive && data) setReadiness(Object.fromEntries(data.map((t) => [t.id, Number(t.blocked_count)])));
      }, 500);
    }

    let degraded = false;
    const channel = supabase
      .channel(`board:${boardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `board_id=eq.${boardId}` }, (payload) => {
        const change = payload as unknown as RealtimeChange;
        const { fetchIds } = applyTaskChange(tasksRef.current, change);
        setTasks((prev) => applyTaskChange(prev, change).rows);
        for (const id of fetchIds) pendingFetch.add(id);
        if (fetchIds.length && !fetchTimer) fetchTimer = setTimeout(flushFetches, 250);
        scheduleReadiness();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'columns', filter: `board_id=eq.${boardId}` }, (payload) => {
        setColumns((prev) => applyColumnChange(prev, payload as unknown as RealtimeChange));
      })
      .subscribe((status) => {
        // При сбое канала и после переподключения сверяемся с БД, чтобы не потерять события.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { degraded = true; refresh(); }
        else if (status === 'SUBSCRIBED' && degraded) { degraded = false; refresh(); }
      });

    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      alive=false;
      clearInterval(timer);
      if (fetchTimer) clearTimeout(fetchTimer);
      if (readinessTimer) clearTimeout(readinessTimer);
      window.removeEventListener('focus', refresh);
      supabase.removeChannel(channel);
    };
  }, [supabase, boardId]);

  const memberById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);
  const labelNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of labelList) map.set(l.id, l.name);
    return map;
  }, [labelList]);

  const visible = tasks.filter((t) => {
    if(t.archived_at)return false;
    if (!t.title.toLowerCase().includes(query.toLowerCase())) return false;
    if (priority !== 'all' && t.priority !== priority) return false;
    if (labelFilter !== 'all' && !(taskLabels[t.id] ?? []).includes(labelFilter)) return false;
    if (assignee === 'me') return t.assignee_id === currentUserId;
    if (assignee === 'none') return t.assignee_id === null;
    if (assignee !== 'all') return t.assignee_id === assignee;
    return true;
  });

  const todayISO = new Date().toISOString().slice(0, 10);

  async function addTask(columnId: string) {
    const parsed = taskSchema.safeParse({ title: newTitle[columnId] ?? '' });
    if (!parsed.success) return setError(tr('board.errTitle'));
    setError(null);
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        board_id: boardId,
        column_id: columnId,
        title: parsed.data.title,
        created_by: currentUserId,
        position: tasks.filter((t) => t.column_id === columnId).length,
      })
      .select(TASK_FIELDS)
      .single();
    if (error) return setError(error.message);
    trackEvent('task_created',{source:'board'});
    setTasks((prev) => [...prev, data as Task]);
    setNewTitle((p) => ({ ...p, [columnId]: '' }));
    pushToast(tr('board.toastCreated'));
  }

  /**
   * Перемещение карточки. beforeId — перед какой карточкой вставить (иначе в конец колонки).
   * Позиции целевой колонки пересчитываются, в базу уходят только изменившиеся.
   */
  async function moveTask(taskId: string, columnId: string, beforeId?: string | null) {
    const current = tasks.find((t) => t.id === taskId);
    if (!current || beforeId === taskId) return;

    const target = tasks
      .filter((t) => t.column_id === columnId && t.id !== taskId)
      .sort((a, b) => a.position - b.position);
    let index = beforeId ? target.findIndex((t) => t.id === beforeId) : target.length;
    if (index < 0) index = target.length;

    const moved: Task = { ...current, column_id: columnId };
    const ordered = [...target.slice(0, index), moved, ...target.slice(index)];
    const updates = ordered.map((t, i) => ({ ...t, position: i }));

    const changed = updates.filter((u) => {
      const old = tasks.find((t) => t.id === u.id);
      return !old || old.position !== u.position || old.column_id !== u.column_id;
    });
    if (changed.length === 0) return;

    const prev = tasks;
    rememberRect(taskId);
    setTasks((ts) => ts.map((t) => updates.find((u) => u.id === t.id) ?? t));

    const {error} = await supabase.rpc('move_board_task',{task:taskId,target_column:columnId,before_task:beforeId??null});
    if (error) { rememberRect(taskId); setTasks(prev); setError(error.message); return; }
    trackEvent('task_moved',{source:'board'});
    const targetCol = columns.find((c) => c.id === columnId);
    const sourceCol = columns.find((c) => c.id === current.column_id);
    if (targetCol?.is_done && !sourceCol?.is_done) pushToast(tr('board.toastDone', { column: targetCol.name }));
  }

  async function removeTask(taskId: string) {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== taskId));
    const { error } = await supabase.rpc('archive_task',{task:taskId,archived:true});
    if (error) {
      setTasks(prev);
      setError(error.message);
    } else { trackEvent('task_archived',{source:'board'}); pushToast(tr('board.toastArchived')); }
  }

  function dropOnColumn(e: React.DragEvent, columnId: string) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveTask(id, columnId);
  }

  function dropOnCard(e: React.DragEvent, card: Task) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveTask(id, card.column_id, card.id);
  }

  return (
    <div>
      {canWrite && <ColumnSettings boardId={boardId} columns={columns} onChange={setColumns} />}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder={tr('board.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input w-auto"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          aria-label={tr('board.filterPriority')}
        >
          <option value="all">{tr('board.anyPriority')}</option>
          <option value="high">{tr('board.priority.high')}</option>
          <option value="medium">{tr('board.priority.medium')}</option>
          <option value="low">{tr('board.priority.low')}</option>
        </select>
        <select
          className="input w-auto"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label={tr('board.filterAssignee')}
        >
          <option value="all">{tr('board.allAssignees')}</option>
          <option value="me">{tr('board.filterMe')}</option>
          <option value="none">{tr('board.noAssignee')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {labelList.length > 0 && (
          <select
            className="input w-auto"
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            aria-label={tr('board.filterLabel')}
          >
            <option value="all">{tr('board.allLabels')}</option>
            {labelList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {(query !== '' || priority !== 'all' || assignee !== 'all' || labelFilter !== 'all') && (
          <span className="inline-flex items-center gap-2 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-xs text-mute">
            <span className="tabular-nums">{tr('board.found', { count: visible.length })}</span>
            <button
              className="font-medium text-ink transition-colors hover:text-orange-700"
              onClick={() => { setQuery(''); setPriority('all'); setAssignee('all'); setLabelFilter('all'); }}
            >
              {tr('board.resetFilters')}
            </button>
          </span>
        )}
        <a href={`/api/export?dep=${depId}`} className="btn ml-auto">
          {tr('board.exportCsv')}
        </a>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.column_id === col.id);
          const load = columnLoad(colTasks.length, col.wip_limit);
          return (
          <section
            key={col.id}
            className={`board-column w-72 shrink-0 p-3 ${dragOver === col.id ? 'board-column-drop' : ''}`}
            onDragOver={(e) => {
              if (!canWrite) return;
              e.preventDefault();
              setDragOver(col.id);
            }}
            onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
            onDrop={(e) => canWrite && dropOnColumn(e, col.id)}
          >
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-medium">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{background: col.color}}/>
              <span className="truncate">{col.name}</span>
              <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${load.exceeded ? 'bg-red-500/10 text-red-600' : 'bg-neutral-200/60 text-mute'}`}>{load.label}</span>
            </h3>
            {load.exceeded && <p className="mb-2 text-xs text-red-600">{tr('board.wipExceeded')}</p>}
            <ul className="flex min-h-8 flex-col gap-2">
              {visible
                .filter((t) => t.column_id === col.id)
                .sort((a, b) => a.position - b.position)
                .map((t) => (
                  <li
                    key={t.id}
                    data-task-id={t.id}
                    data-priority={t.priority}
                    className={`task-card p-3 ${canWrite ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    draggable={canWrite}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                    onDrop={(e) => canWrite && dropOnCard(e, t)}
                  >
                    <button
                      className="block w-full text-left text-sm font-medium leading-snug"
                      onClick={() => setOpenTask(t)}
                    >
                      {t.title}
                    </button>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-mute">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={`priority-dot priority-dot-${t.priority}`}/>
                        {tr(`board.priority.${t.priority}`)}
                      </span>
                      {t.due_date && (
                        <span className={`inline-flex items-center gap-1 tabular-nums ${t.due_date < todayISO && !col.is_done ? 'text-red-600' : ''}`}>
                          <Icon name="calendar" width={12} height={12}/>
                          {new Date(t.due_date).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}
                        </span>
                      )}
                      {t.assignee_id && (
                        <UserName look={memberById.get(t.assignee_id) ?? { name: tr('board.assigneeFallback') }} />
                      )}
                    </p>
                    {readiness[t.id]>0&&<p className="mt-2 text-xs text-orange-600">{tr('board.waitingTasks', { count: readiness[t.id] })}</p>}
                    {t.blocked_reason && <p className="mt-2 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-600">{tr('board.blocker', { reason: t.blocked_reason })}</p>}
                    {t.task_checklist?.length > 0 && <div className="mt-2.5"><div className="mb-1 flex justify-between text-xs text-mute"><span>{tr('board.checklist')}</span><span className="tabular-nums">{checklistProgress(t.task_checklist).done}/{t.task_checklist.length}</span></div><div className="h-1 rounded-full bg-neutral-200/70"><div className="h-full rounded-full bg-orange-500" style={{width:`${checklistProgress(t.task_checklist).percent}%`}}/></div></div>}
                    {(taskLabels[t.id] ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(taskLabels[t.id] ?? []).map((id) => (
                          <span
                            key={id}
                            className="rounded-full border border-line px-2 py-0.5 text-[11px] text-mute"
                          >
                            {labelNameById.get(id) ?? '…'}
                          </span>
                        ))}
                      </div>
                    )}
                    {canWrite && (
                      <div className="mt-2 flex items-center gap-2">
                        <select
                          className="cursor-pointer rounded-md border border-line bg-white px-1.5 py-1 text-xs text-mute transition-colors hover:border-neutral-200 hover:text-ink"
                          value={t.column_id}
                          onChange={(e) => moveTask(t.id, e.target.value)}
                          aria-label={tr('board.moveToColumn')}
                        >
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ml-auto rounded-md px-1.5 py-1 text-xs text-mute transition-colors hover:bg-red-500/10 hover:text-red-600"
                          onClick={() => removeTask(t.id)}
                        >
                          {tr('board.archive')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
            {colTasks.length === 0 && <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-mute">{tr('board.dropHint')}</p>}
            {canWrite && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTask(col.id);
                }}
              >
                <input
                  className="input py-1"
                  placeholder={tr('board.newTask')}
                  value={newTitle[col.id] ?? ''}
                  onChange={(e) => setNewTitle((p) => ({ ...p, [col.id]: e.target.value }))}
                />
                <button className="btn py-1">+</button>
              </form>
            )}
          </section>
          );
        })}
      </div>

      {openTask && (
        <TaskDetail
          key={openTask.id}
          task={openTask}
          canWrite={canWrite}
          members={members}
          labels={labelList}
          selectedLabelIds={taskLabels[openTask.id] ?? []}
          departmentId={depId}
          currentUserId={currentUserId}
          onLabelsChanged={(taskId, ids) => setTaskLabels((p) => ({ ...p, [taskId]: ids }))}
          onLabelCreated={(label) => setLabelList((p) => [...p, label])}
          onClose={() => setOpenTask(null)}
          onSaved={(saved) => { setTasks(ts => ts.map(t => t.id === saved.id ? {...t,...saved} : t)); setOpenTask(saved); }}
        />
      )}

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast-item flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm shadow-lg">
            <svg className="shrink-0 text-orange-600" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5"/></svg>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
