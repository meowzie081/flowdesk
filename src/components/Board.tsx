'use client';
import {trackEvent} from '@/lib/analytics-client';

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import TaskDetail from './TaskDetail';
import UserName from './UserName';
import ColumnSettings from './ColumnSettings';
import { checklistProgress, columnLoad, type ChecklistItem } from '@/lib/collaboration';

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
  title: z.string().trim().min(1, 'Введите название').max(200),
});

const PRIORITY_LABEL = { low: 'Низкий', medium: 'Средний', high: 'Высокий' } as const;

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
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 10000);
    window.addEventListener('focus', refresh);
    return () => { alive=false; clearInterval(timer); window.removeEventListener('focus', refresh); };
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

  async function addTask(columnId: string) {
    const parsed = taskSchema.safeParse({ title: newTitle[columnId] ?? '' });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
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
    setTasks((ts) => ts.map((t) => updates.find((u) => u.id === t.id) ?? t));

    const {error} = await supabase.rpc('move_board_task',{task:taskId,target_column:columnId,before_task:beforeId??null});
    if (error) { setTasks(prev); setError(error.message); } else trackEvent('task_moved',{source:'board'});

  }

  async function removeTask(taskId: string) {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== taskId));
    const { error } = await supabase.rpc('archive_task',{task:taskId,archived:true});
    if (error) {
      setTasks(prev);
      setError(error.message);
    } else trackEvent('task_archived',{source:'board'});
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
          placeholder="Поиск по задачам"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input w-auto"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          aria-label="Фильтр по приоритету"
        >
          <option value="all">Любой приоритет</option>
          <option value="high">Высокий</option>
          <option value="medium">Средний</option>
          <option value="low">Низкий</option>
        </select>
        <select
          className="input w-auto"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label="Фильтр по исполнителю"
        >
          <option value="all">Все исполнители</option>
          <option value="me">Мои задачи</option>
          <option value="none">Без исполнителя</option>
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
            aria-label="Фильтр по метке"
          >
            <option value="all">Все метки</option>
            {labelList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <a href={`/api/export?dep=${depId}`} className="btn ml-auto">
          Экспорт CSV
        </a>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <section
            key={col.id}
            style={{borderTopColor:col.color}}
            className={`board-column w-72 shrink-0 p-3 transition ${
              dragOver === col.id ? 'bg-neutral-200 ring-1 ring-ink' : 'bg-neutral-100'
            }`}
            onDragOver={(e) => {
              if (!canWrite) return;
              e.preventDefault();
              setDragOver(col.id);
            }}
            onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
            onDrop={(e) => canWrite && dropOnColumn(e, col.id)}
          >
            <h3 className="mb-3 text-sm font-medium">
              {col.name}{' '}
              <span className={columnLoad(tasks.filter(t=>t.column_id===col.id).length,col.wip_limit).exceeded ? 'text-red-600' : 'text-mute'}>{columnLoad(tasks.filter(t=>t.column_id===col.id).length,col.wip_limit).label}</span>
            </h3>
            {columnLoad(tasks.filter(t=>t.column_id===col.id).length,col.wip_limit).exceeded && <p className="mb-2 text-xs text-red-600">Лимит превышен. Завершите текущие задачи.</p>}
            <ul className="flex min-h-8 flex-col gap-2">
              {visible
                .filter((t) => t.column_id === col.id)
                .sort((a, b) => a.position - b.position)
                .map((t) => (
                  <li
                    key={t.id}
                    data-priority={t.priority}
                    className={`card task-card p-3 ${canWrite ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    draggable={canWrite}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                    onDrop={(e) => canWrite && dropOnCard(e, t)}
                  >
                    <button
                      className="block w-full text-left text-sm font-medium hover:underline"
                      onClick={() => setOpenTask(t)}
                    >
                      {t.title}
                    </button>
                    <p className="mt-1 text-xs text-mute">
                      {PRIORITY_LABEL[t.priority]}
                      {t.due_date && ` · до ${new Date(t.due_date).toLocaleDateString('ru-RU')}`}
                      {t.assignee_id && (
                        <>
                          {' · '}
                          <UserName look={memberById.get(t.assignee_id) ?? { name: 'исполнитель' }} />
                        </>
                      )}
                    </p>
                    {readiness[t.id]>0&&<p className="mt-2 text-xs text-orange-600">Ожидает задач: {readiness[t.id]}</p>}
                    {t.blocked_reason && <p className="mt-2 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-600">Блокер: {t.blocked_reason}</p>}
                    {t.task_checklist?.length > 0 && <div className="mt-2"><div className="mb-1 flex justify-between text-xs text-mute"><span>Чек-лист</span><span>{checklistProgress(t.task_checklist).done}/{t.task_checklist.length}</span></div><div className="h-1.5 rounded-full bg-neutral-200"><div className="h-full rounded-full bg-orange-500" style={{width:`${checklistProgress(t.task_checklist).percent}%`}}/></div></div>}
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
                          className="rounded border border-line bg-white px-1 py-0.5 text-xs"
                          value={t.column_id}
                          onChange={(e) => moveTask(t.id, e.target.value)}
                          aria-label="Переместить в колонку"
                        >
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ml-auto text-xs text-mute hover:text-ink"
                          onClick={() => removeTask(t.id)}
                        >
                          В архив
                        </button>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
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
                  placeholder="Новая задача"
                  value={newTitle[col.id] ?? ''}
                  onChange={(e) => setNewTitle((p) => ({ ...p, [col.id]: e.target.value }))}
                />
                <button className="btn py-1">+</button>
              </form>
            )}
          </section>
        ))}
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
    </div>
  );
}
