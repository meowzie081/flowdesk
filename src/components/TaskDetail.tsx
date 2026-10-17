'use client';
import {trackEvent,fileKind} from '@/lib/analytics-client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import type { Label, Member, Task } from './Board';
import UserName from './UserName';
import TaskWorkflow from './TaskWorkflow';
import FilePreview from './FilePreview';
import TaskHistory from './TaskHistory';
import { checklistProgress, displayMentions, type ChecklistItem } from '@/lib/collaboration';

interface Attachment {
  id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number;
}

interface CommentRow {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

interface ChatCtx {
  id: string;
  body: string;
  is_ai: boolean;
  created_at: string;
  author_id: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

const editSchema = z.object({
  title: z.string().trim().min(1, 'Введите название').max(200, 'Не длиннее 200 символов'),
  description: z.string().max(5000, 'Описание слишком длинное'),
  blocked_reason: z.string().max(1000),
  priority: z.enum(['low', 'medium', 'high']),
  due_date: z.string().nullable(),
  assignee_id: z.string().uuid().nullable(),
});

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120) || 'file';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function TaskDetail({
  task,
  canWrite,
  members,
  labels,
  selectedLabelIds,
  departmentId,
  currentUserId,
  onClose,
  onSaved,
  onLabelsChanged,
  onLabelCreated,
}: {
  task: Task;
  canWrite: boolean;
  members: Member[];
  labels: Label[];
  selectedLabelIds: string[];
  departmentId: string;
  currentUserId: string;
  onClose: () => void;
  onSaved: (t: Task) => void;
  onLabelsChanged: (taskId: string, labelIds: string[]) => void;
  onLabelCreated: (label: Label) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [blockedReason,setBlockedReason] = useState(task.blocked_reason??'');
  const [checklist,setChecklist] = useState<ChecklistItem[]>(task.task_checklist??[]);
  const [newItem,setNewItem] = useState('');
  const [checkBusy,setCheckBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [priority, setPriority] = useState<Task['priority']>(task.priority);
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? '');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState('');
  const [chatCtx, setChatCtx] = useState<{ sourceId: string; items: ChatCtx[] } | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);

  async function loadChecklist() {
    const {data,error} = await supabase.from('task_checklist').select('id, title, is_done, position').eq('task_id',task.id).order('position').order('id');
    if(error) return setError(error.message);
    const items=data as ChecklistItem[];setChecklist(items);onSaved({...task,task_checklist:items});
  }
  async function changeChecklist(item:ChecklistItem, remove=false) {
    if(!canWrite||checkBusy)return;setCheckBusy(true);setError(null);
    try {
      const {error} = remove ? await supabase.from('task_checklist').delete().eq('id',item.id) : await supabase.from('task_checklist').update({is_done:!item.is_done}).eq('id',item.id);
      if(error)throw error;await loadChecklist();
    } catch(e){setError((e as {message:string}).message)}finally{setCheckBusy(false)}
  }
  async function addChecklist(e:React.FormEvent) {
    e.preventDefault();if(!canWrite||checkBusy||!newItem.trim())return;setCheckBusy(true);setError(null);
    try {const {error}=await supabase.from('task_checklist').insert({task_id:task.id,title:newItem.trim(),position:checklist.length?Math.max(...checklist.map(i=>i.position))+1:0});if(error)throw error;setNewItem('');await loadChecklist();}
    catch(e){setError((e as {message:string}).message)}finally{setCheckBusy(false)}
  }

  const memberById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const loadFiles = useCallback(async () => {
    const { data, error } = await supabase
      .from('attachments')
      .select('id, storage_path, file_name, size_bytes')
      .eq('task_id', task.id)
      .order('created_at');
    if (error) setError(error.message);
    else setFiles((data ?? []) as Attachment[]);
  }, [supabase, task.id]);

  const loadComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, author_id, body, created_at')
      .eq('task_id', task.id)
      .order('created_at');
    if (error) setError(error.message);
    else setComments((data ?? []) as CommentRow[]);
  }, [supabase, task.id]);

  // «Откуда задача»: исходное сообщение чата и пара сообщений вокруг него
  const loadChatContext = useCallback(async () => {
    const { data: row } = await supabase
      .from('tasks')
      .select('source_message_id')
      .eq('id', task.id)
      .maybeSingle();
    const sourceId = (row as { source_message_id: string | null } | null)?.source_message_id;
    if (!sourceId) return setChatCtx(null);
    const { data: src } = await supabase
      .from('messages')
      .select('id, body, is_ai, created_at, author_id')
      .eq('id', sourceId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!src) return setChatCtx(null);
    const source = src as ChatCtx;
    const [{ data: before }, { data: after }] = await Promise.all([
      supabase
        .from('messages')
        .select('id, body, is_ai, created_at, author_id')
        .eq('department_id', departmentId)
        .is('deleted_at', null)
        .lt('created_at', source.created_at)
        .order('created_at', { ascending: false })
        .limit(2),
      supabase
        .from('messages')
        .select('id, body, is_ai, created_at, author_id')
        .eq('department_id', departmentId)
        .is('deleted_at', null)
        .gt('created_at', source.created_at)
        .order('created_at', { ascending: true })
        .limit(2),
    ]);
    setChatCtx({
      sourceId,
      items: [...((before ?? []) as ChatCtx[]).reverse(), source, ...((after ?? []) as ChatCtx[])],
    });
  }, [supabase, task.id, departmentId]);

  useEffect(() => {
    loadFiles();
    loadComments();
    loadChatContext();
  }, [loadFiles, loadComments, loadChatContext]);

  async function save() {
    const parsed = editSchema.safeParse({
      title,
      description,
      blocked_reason: blockedReason,
      priority,
      due_date: dueDate || null,
      assignee_id: assigneeId || null,
    });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setError(null);
    setBusy(true);
    const { data, error } = await supabase
      .from('tasks')
      .update(parsed.data)
      .eq('id', task.id)
      .select('id, board_id, archived_at, column_id, title, description, priority, due_date, position, assignee_id, blocked_reason, task_checklist(id, title, is_done, position)')
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(data as Task);
    onClose();
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) return setError('Файл больше 10 МБ');
    setError(null);
    setBusy(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const path = `${task.id}/${crypto.randomUUID()}-${safeName(file.name)}`;

    const up = await supabase.storage.from('attachments').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (up.error) {
      setBusy(false);
      return setError(up.error.message);
    }
    const ins = await supabase.from('attachments').insert({
      task_id: task.id,
      storage_path: path,
      file_name: file.name,
      size_bytes: file.size,
      uploaded_by: user!.id,
    });
    if (ins.error) {
      // не оставляем «осиротевший» файл в хранилище
      await supabase.storage.from('attachments').remove([path]);
      setBusy(false);
      return setError(ins.error.message);
    }
    trackEvent('file_uploaded',{source:'task',kind:fileKind(file.type)});
    setBusy(false);
    loadFiles();
  }

  async function download(a: Attachment) {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(a.storage_path, 60, { download: a.file_name });
    if (error) return setError(error.message);
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function remove(a: Attachment) {
    const row = await supabase.from('attachments').delete().eq('id', a.id);
    if (row.error) return setError(row.error.message);
    await supabase.storage.from('attachments').remove([a.storage_path]);
    setFiles((prev) => prev.filter((f) => f.id !== a.id));
  }

  async function toggleLabel(labelId: string) {
    if (!canWrite) return;
    setError(null);
    const has = selectedLabelIds.includes(labelId);
    const res = has
      ? await supabase.from('task_labels').delete().eq('task_id', task.id).eq('label_id', labelId)
      : await supabase.from('task_labels').insert({ task_id: task.id, label_id: labelId });
    if (res.error) return setError(res.error.message);
    onLabelsChanged(
      task.id,
      has ? selectedLabelIds.filter((id) => id !== labelId) : [...selectedLabelIds, labelId],
    );
  }

  async function createLabel() {
    const name = newLabel.trim();
    if (!name) return;
    if (name.length > 30) return setError('Метка не длиннее 30 символов');
    setError(null);

    // такая метка уже есть — просто назначаем её
    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setNewLabel('');
      if (!selectedLabelIds.includes(existing.id)) await toggleLabel(existing.id);
      return;
    }

    const { data, error } = await supabase
      .from('labels')
      .insert({ department_id: departmentId, name })
      .select('id, name')
      .single();
    if (error || !data) return setError(error?.message ?? 'Не удалось создать метку');
    const created = data as Label;
    onLabelCreated(created);

    const link = await supabase
      .from('task_labels')
      .insert({ task_id: task.id, label_id: created.id });
    if (link.error) return setError(link.error.message);
    onLabelsChanged(task.id, [...selectedLabelIds, created.id]);
    setNewLabel('');
  }

  async function addComment() {
    const body = commentText.trim();
    if (!body) return;
    if (body.length > 2000) return setError('Комментарий не длиннее 2000 символов');
    setError(null);
    const { data, error } = await supabase
      .from('comments')
      .insert({ task_id: task.id, author_id: currentUserId, body })
      .select('id, author_id, body, created_at')
      .single();
    if (error) return setError(error.message);
    setComments((prev) => [...prev, data as CommentRow]);
    setCommentText('');
  }

  async function deleteComment(id: string) {
    const { error } = await supabase.from('comments').delete().eq('id', id);
    if (error) return setError(error.message);
    setComments((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef} tabIndex={-1}
        onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const focusable=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')??[]);const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialogRef.current)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}}
        className="h-[100dvh] w-full overflow-y-auto bg-white p-5 shadow-xl sm:max-w-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Карточка задачи"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Карточка</h2>
          <button className="text-mute hover:text-ink" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-sm">
            Название
            <input
              className="input mt-1"
              value={title}
              disabled={!canWrite}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Описание
            <textarea
              className="input mt-1 min-h-24"
              value={description}
              disabled={!canWrite}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="flex gap-3">
            <label className="flex-1 text-sm">
              Приоритет
              <select
                className="input mt-1"
                value={priority}
                disabled={!canWrite}
                onChange={(e) => setPriority(e.target.value as Task['priority'])}
              >
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </label>
            <label className="flex-1 text-sm">
              Срок
              <input
                type="date"
                className="input mt-1"
                value={dueDate}
                disabled={!canWrite}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </div>
          <label className="text-sm">
            Исполнитель
            <select
              className="input mt-1"
              value={assigneeId}
              disabled={!canWrite}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Не назначен</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="mt-5"><h3 className="text-sm font-medium">Чек-лист · {checklistProgress(checklist).done}/{checklist.length}</h3><div className="mt-2 h-1.5 rounded-full bg-neutral-200"><div className="h-full rounded-full bg-orange-500" style={{width:`${checklistProgress(checklist).percent}%`}}/></div><ul className="mt-3 space-y-2">{checklist.map(item=><li key={item.id} className="flex items-center gap-2 text-sm"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={item.is_done} disabled={!canWrite||checkBusy} onChange={()=>changeChecklist(item)}/><span className={item.is_done?'break-words text-mute line-through':'break-words'}>{item.title}</span></label>{canWrite&&<button aria-label={`Удалить пункт ${item.title}`} disabled={checkBusy} className="text-xs text-mute" onClick={()=>changeChecklist(item,true)}>✕</button>}</li>)}</ul>{canWrite&&<form onSubmit={addChecklist} className="mt-3 flex gap-2"><input className="input" aria-label="Новый пункт чек-листа" placeholder="Новый пункт" maxLength={200} value={newItem} onChange={e=>setNewItem(e.target.value)}/><button className="btn" disabled={checkBusy||!newItem.trim()}>Добавить</button></form>}</section>
        <label className="mt-5 block text-sm">Причина блокировки<textarea className="input mt-1" disabled={!canWrite} maxLength={1000} placeholder="Что мешает завершить задачу?" value={blockedReason} onChange={e=>setBlockedReason(e.target.value)}/></label>
        {chatCtx && (
          <section className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Из чата</h3>
              <a href={`/d/${departmentId}/chat?message=${chatCtx.sourceId}`} className="text-xs text-mute hover:text-ink">
                Открыть чат
              </a>
            </div>
            <ul className="mt-2 space-y-1 rounded-md border border-line p-2 text-xs">
              {chatCtx.items.map((m) => (
                <li
                  key={m.id}
                  className={m.id === chatCtx.sourceId ? 'rounded bg-neutral-100 px-1 py-0.5 font-medium' : 'px-1 text-mute'}
                >
                  <span className="mr-1 text-mute">
                    {m.is_ai ? 'ИИ' : <UserName look={memberById.get(m.author_id) ?? { name: 'участник' }} />}:
                  </span>
                  {displayMentions(m.body).length > 240 ? `${displayMentions(m.body).slice(0, 240)}…` : displayMentions(m.body)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-5">
          <h3 className="text-sm font-medium">Метки</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {labels.length === 0 && <p className="text-sm text-mute">Меток пока нет.</p>}
            {labels.map((l) => {
              const on = selectedLabelIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => toggleLabel(l.id)}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                    on ? 'border-ink bg-ink text-paper' : 'border-line text-ink hover:border-ink'
                  } disabled:cursor-default`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
          {canWrite && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                createLabel();
              }}
            >
              <input
                className="input py-1"
                placeholder="Новая метка"
                maxLength={30}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button className="btn py-1">Добавить</button>
            </form>
          )}
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-medium">Файлы</h3>
          {files.length === 0 ? (
            <p className="mt-1 text-sm text-mute">Файлов нет.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-md border border-line">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 p-2 text-sm">
                  <button className="flex-1 truncate text-left underline" onClick={() => download(f)}>
                    {f.file_name}
                  </button>
                  <span className="text-xs text-mute">{formatSize(f.size_bytes)}</span><FilePreview source="task" id={f.id} name={f.file_name}/>
                  {canWrite && (
                    <button className="text-xs text-mute hover:text-ink" onClick={() => remove(f)}>
                      Удалить
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <label className="btn mt-3 cursor-pointer">
              Прикрепить файл (до 10 МБ)
              <input type="file" className="hidden" onChange={upload} disabled={busy} />
            </label>
          )}
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-medium">Комментарии</h3>
          {comments.length === 0 ? (
            <p className="mt-1 text-sm text-mute">Комментариев нет.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-md border border-line p-2 text-sm">
                  <div className="flex items-center justify-between gap-2 text-xs text-mute">
                    <span>
                      <UserName look={memberById.get(c.author_id) ?? { name: 'Участник' }} /> ·{' '}
                      {new Date(c.created_at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {c.author_id === currentUserId && (
                      <button className="hover:text-ink" onClick={() => deleteComment(c.id)}>
                        Удалить
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addComment();
              }}
            >
              <input
                className="input py-1"
                placeholder="Написать комментарий"
                maxLength={2000}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <button className="btn py-1">Отправить</button>
            </form>
          )}
        </section>

        <TaskWorkflow task={task} depId={departmentId} canWrite={canWrite} onArchived={()=>{onSaved({...task,archived_at:task.archived_at?null:new Date().toISOString()});onClose()}}/>
        <TaskHistory taskId={task.id} members={members}/>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

        {canWrite && (
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn-solid" onClick={save} disabled={busy}>
              Сохранить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
