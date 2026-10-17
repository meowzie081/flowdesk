'use client';
import {trackEvent,fileKind} from '@/lib/analytics-client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import { COMMAND_HELP, parseSlash, usesBoardData } from '@/lib/ai/commands';
import { maskSensitive, totalMasked } from '@/lib/ai/mask';
import { mergeMessages, reconcileMessages } from '@/lib/chat';
import { meetingMessage, parseMeeting } from '@/lib/ai/meeting';
import RichText from './RichText';
import FilePreview from './FilePreview';
import UserName from './UserName';
import { CHAT_FIELDS, displayMentions, mentionToken, type ReadInfo } from '@/lib/collaboration';

interface Attachment { name: string; path: string; size: number }

interface Msg {
  parent_id: string | null;
  mentions: string[];
  is_pinned: boolean;
  reply_count: number;
  files: Attachment[];
  deleted_at: string | null;
  id: string;
  author_id: string;
  body: string;
  is_ai: boolean;
  created_at: string;
}

interface Draft {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  sourceMessageId?: string;
}

const draftSchema = z.array(
  z.object({
    title: z.string().min(1).max(200),
    description: z.string().default(''),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
);

export default function Chat({
  depId,
  userId,
  canWrite,
  boardId,
  firstColumnId,
  initial,
  looks,
  initialRead,
  targetMessageId,
}: {
  depId: string;
  userId: string;
  canWrite: boolean;
  boardId: string | null;
  firstColumnId: string | null;
  initial: Msg[];
  initialRead: ReadInfo;
  targetMessageId?: string | null;
  looks: Record<string, { name: string; icon: string | null; color: string | null }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState('');
  const [threadId,setThreadId] = useState<string|null>(null);
  const [threadBusy,setThreadBusy] = useState(false);
  const [readInfo,setReadInfo] = useState<ReadInfo>(initialRead);
  const [highlight,setHighlight] = useState<string|null>(null);
  const [taskBusy,setTaskBusy] = useState<string|null>(null);
  const [createdTasks,setCreatedTasks] = useState<Record<string,string>>({});
  const [mentionIds,setMentionIds] = useState<string[]>([]);
  const [mentionQuery,setMentionQuery] = useState<string|null>(null);
  const textareaRef=useRef<HTMLTextAreaElement>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasHistory, setHasHistory] = useState(initial.length === 100);
  const [historyCursor,setHistoryCursor] = useState<{created_at:string;id:string}|null>(initial[0]?{created_at:initial[0].created_at,id:initial[0].id}:null);
  const fileRef = useRef<HTMLInputElement>(null);
  const visible = messages.filter(m => (threadId ? m.id===threadId || m.parent_id===threadId : !m.parent_id) && (!m.deleted_at || (m.id===threadId || m.reply_count>0)) && (displayMentions(m.body).toLowerCase().includes(search.toLowerCase()) || (m.files??[]).some(f=>f.name.toLowerCase().includes(search.toLowerCase()))));
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const messagesRef = useRef<Msg[]>(initial);
  const scrollRef = useRef<HTMLUListElement>(null);
  const shouldScroll = useRef(true);

  // Индикатор «что уйдёт в ИИ» считается на клиенте тем же маскированием
  const preview = useMemo(() => {
    const cmd = parseSlash(text);
    if (!cmd) return null;
    const ctx = selected.length
      ? messages.filter((m) => !m.deleted_at && selected.includes(m.id)).map((m) => displayMentions(m.body)).join('\n')
      : messages.filter(m => !m.deleted_at).slice(-20).map((m) => displayMentions(m.body)).join('\n');
    const masked = maskSensitive(`${ctx}\n${cmd.args}`);
    return {
      masked: totalMasked(masked.counts),
      chars: masked.text.length,
      withBoard: usesBoardData(cmd.command),
    };
  }, [text, selected, messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Новые сообщения: Realtime (мгновенно) + опрос как запасной вариант, если Realtime не подключён
  useEffect(() => {
    let pulling = false;
    let cancelled = false;
    async function pull() {
      if (pulling) return;
      pulling = true;
      try {
        const list = messagesRef.current;
        const incoming: Msg[] = [];
        for (let offset = 0; !cancelled; offset += 500) {
          let q = supabase.from('chat_messages').select(CHAT_FIELDS)
            .eq('department_id', depId).order('created_at', { ascending: true }).order('id').range(offset, offset + 499);
          if (list.length) q = q.gte('created_at', list[0].created_at);
          const { data, error } = await q;
          if (error) return;
          incoming.push(...data as Msg[]);
          if (data.length < 500) break;
        }
        if (!cancelled && incoming.length) setMessages(prev => reconcileMessages(prev, incoming));
      } finally { pulling = false; }
    }

    const channel = supabase
      .channel(`chat:${depId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `department_id=eq.${depId}` },
        (payload) => { const row={...payload.new,reply_count:0} as Msg; setMessages(prev=>prev.some(m=>m.id===row.id)?prev:mergeMessages(prev.map(m=>m.id===row.parent_id?{...m,reply_count:Number(m.reply_count??0)+1}:m),[row])); },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `department_id=eq.${depId}` }, (payload) => setMessages(prev => prev.map(m => m.id === payload.new.id ? {...m,...payload.new} as Msg : m)))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') pull(); // догоняем то, что пришло, пока подключались
      });

    // Опрос также синхронизирует удаления после пропущенных событий Realtime.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') pull();
    }, 4000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true; clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      supabase.removeChannel(channel);
    };
  }, [supabase, depId]);

  useEffect(() => {
    if (shouldScroll.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  /** Отправляет сообщение, возвращает его id (или null при ошибке). */
  async function postMessage(body: string, isAi = false, attachments: Attachment[] = []): Promise<string | null> {
    const { data, error } = await supabase
      .from('messages')
      .insert({ department_id: depId, author_id: userId, body, is_ai: isAi, files: attachments, parent_id: threadId, mentions: mentionIds.filter(id=>body.includes(`](${id})`)) })
      .select(CHAT_FIELDS.replace(', reply_count',''))
      .single();
    if (error) {
      setError(error.message);
      return null;
    }
    // Показываем сразу, не дожидаясь Realtime; повторное получение того же сообщения отфильтруется по id
    const saved = {...(data as unknown as Msg),reply_count:0};
    setMessages((prev) => mergeMessages(prev, [saved]));
    return saved.id;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    let encoded = value;
    for(const id of mentionIds) { const name=looks[id]?.name; if(name) encoded=encoded.split(`@${name}`).join(mentionToken(id,name)); }
    if (busy || (!value && !files.length)) return;
    setError(null);
    const cmd = parseSlash(value);
    if (!cmd) {
      if (value.length > 4000) return setError('Сообщение длиннее 4000 символов');
      setBusy(true);
      const uploaded: Attachment[] = [];
      try {
        for (const file of files) {
          const path = `${depId}/${userId}/${crypto.randomUUID()}-${file.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0,120)}`;
          const { error } = await supabase.storage.from('chat-files').upload(path, file);
          if (error) throw new Error(error.message);
          uploaded.push({ name: file.name, path, size: file.size });
        }
        const id = await postMessage(encoded || '📎 Вложения', false, uploaded);
        if (!id) throw new Error('Не удалось отправить сообщение');
        trackEvent('message_sent',{source:'chat'});
        for(const file of files)trackEvent('file_uploaded',{source:'chat',kind:fileKind(file.type)});
        shouldScroll.current = true; setText(''); setFiles([]); setMentionIds([]); setMentionQuery(null);
      } catch (err) {
        if (uploaded.length) await supabase.storage.from('chat-files').remove(uploaded.map(f => f.path));
        setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      } finally { setBusy(false); }
      return;
    }

    if (files.length) return setError('Отправьте вложения отдельно от команды ИИ');
    setBusy(true);
    try {
    // для /meeting все данные — в самих заметках, чат в запрос не добавляем
    const context =
      cmd.command === 'meeting'
        ? ''
        : (selected.length ? messages.filter((m) => !m.deleted_at && selected.includes(m.id)) : messages.filter(m => !m.deleted_at).slice(-20))
            .map((m) => displayMentions(m.body))
            .join('\n');

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        departmentId: depId,
        command: cmd.command,
        input: cmd.args,
        context,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail ? `: ${data.detail}` : '';
      return setError(`ИИ недоступен (${data.error ?? res.status}${detail})`);
    }
    trackEvent('ai_response_received',{source:'chat',command:cmd.command});
    setText('');

    if (cmd.command === 'task') {
      try {
        const json = String(data.answer).replace(/```json|```/g, '').trim();
        const parsed = draftSchema.parse(JSON.parse(json));
        setDrafts(parsed.map((d) => ({ ...d, sourceMessageId: selected[0] })));
      } catch {
        setError('ИИ вернул ответ в неожиданном формате — попробуйте ещё раз');
      }
    } else if (cmd.command === 'meeting') {
      const result = parseMeeting(String(data.answer));
      if (!result) {
        setError('ИИ вернул ответ в неожиданном формате — попробуйте ещё раз');
      } else {
        // Итоги встречи публикуются в чате, а задачи привязываются к этому сообщению
        const messageId = await postMessage(meetingMessage(result), true);
        setDrafts(result.tasks.map((d) => ({ ...d, sourceMessageId: messageId ?? undefined })));
      }
    } else {
      await postMessage(String(data.answer).slice(0, 4000), true);
    }
    setSelected([]);
    } catch { setError('Не удалось связаться с ИИ. Попробуйте ещё раз'); }
    finally { setBusy(false); }
  }

  function pickFiles(incoming: File[]) {
    if (files.length + incoming.length > 5) return setError('До 5 файлов в одном сообщении');
    if (incoming.some(f => f.size > 10 * 1024 * 1024)) return setError('Максимальный размер файла — 10 МБ');
    setError(null); setFiles(prev => [...prev, ...incoming]);
  }

  async function download(file: Attachment) {
    const { data, error } = await supabase.storage.from('chat-files').createSignedUrl(file.path, 60, { download: file.name });
    if (error) return setError(error.message);
    const link = document.createElement('a'); link.href = data.signedUrl; link.rel = 'noopener'; link.click();
  }

  async function removeMessage(m: Msg) {
    if (!window.confirm('Удалить сообщение и его вложения?')) return;
    const { error } = await supabase.rpc('delete_chat_message', { message_id: m.id });
    if (error) return setError(error.message);
    setMessages(prev => prev.map(item => item.id === m.id ? { ...item, deleted_at: new Date().toISOString(), body: 'Сообщение удалено', files: [] } : item));
    setSelected(prev => prev.filter(id => id !== m.id));
    if (m.files?.length) {
      const { error } = await supabase.storage.from('chat-files').remove(m.files.map(f => f.path));
      if (error) setError('Сообщение удалено, но очистка вложений не удалась: ' + error.message);
    }
  }

  async function loadHistory() {
    if (loadingHistory || !messages.length) return;
    setLoadingHistory(true);
    try {
      if(!historyCursor)return;
      const { data, error } = await supabase.from('chat_messages').select(CHAT_FIELDS)
        .eq('department_id', depId).is('parent_id',null)
        .or(`created_at.lt.${historyCursor.created_at},and(created_at.eq.${historyCursor.created_at},id.lt.${historyCursor.id})`)
        .order('created_at', { ascending: false }).order('id',{ascending:false}).limit(100);
      if (error) throw error;
      shouldScroll.current = false; setMessages(prev => mergeMessages(prev, data as Msg[])); setHasHistory(data.length === 100);if(data.length){const oldest=data[data.length-1];setHistoryCursor({created_at:oldest.created_at,id:oldest.id});}
    } catch { setError('Не удалось загрузить историю'); } finally { setLoadingHistory(false); }
  }

  async function refreshUnread() {
    const {data}=await supabase.rpc('chat_unread',{dep:depId});if(data)setReadInfo(data as ReadInfo);
  }
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')refreshUnread()},5000);return()=>clearInterval(timer);},[supabase,depId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openMessage(id:string) {
    setThreadBusy(true);setSearch('');
    try {
      const {data,error}=await supabase.from('chat_messages').select(CHAT_FIELDS).eq('department_id',depId).eq('id',id).maybeSingle();
      if(error)throw error;if(!data)throw new Error('Сообщение недоступно');
      const root=data.parent_id??data.id;
      const {data:rootRow,error:rootError}=await supabase.from('chat_messages').select(CHAT_FIELDS).eq('id',root).eq('department_id',depId).single();
      if(rootError)throw rootError;
      const replies:Msg[]=[];
      for(let offset=0;;offset+=500){const {data,error}=await supabase.from('chat_messages').select(CHAT_FIELDS).eq('department_id',depId).eq('parent_id',root).order('created_at').order('id').range(offset,offset+499);if(error)throw error;replies.push(...data as Msg[]);if(data.length<500)break;}
      setMessages(prev=>reconcileMessages(prev,[rootRow as Msg,...replies]));setThreadId(root);setHighlight(id);shouldScroll.current=false;
      setTimeout(()=>document.getElementById(`message-${id}`)?.scrollIntoView({block:'center',behavior:'smooth'}),100);
    } catch(e){setError((e as {message:string}).message)}finally{setThreadBusy(false)}
  }
  useEffect(()=>{if(targetMessageId)openMessage(targetMessageId)},[targetMessageId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function markRead() {
    const {data,error}=await supabase.from('messages').select('id').eq('department_id',depId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
    if(error)return setError(error.message);if(!data)return;
    const result=await supabase.rpc('mark_chat_read',{dep:depId,message:data.id});if(result.error)return setError(result.error.message);
    await refreshUnread();window.dispatchEvent(new Event('chat-read'));
  }
  async function makeTask(m:Msg) {
    if(taskBusy||!boardId)return;setTaskBusy(m.id);setError(null);
    try {const {data,error}=await supabase.rpc('task_from_message',{message:m.id,target_board:boardId});if(error)throw error;setCreatedTasks(prev=>({...prev,[m.id]:data as string}));}
    catch(e){setError((e as {message:string}).message)}finally{setTaskBusy(null)}
  }
  async function pin(m:Msg) {
    const {error}=await supabase.rpc('pin_chat_message',{message:m.id,pinned:!m.is_pinned});if(error)return setError(error.message);
    setMessages(prev=>prev.map(x=>x.id===m.id?{...x,is_pinned:!x.is_pinned}:x));
  }

  async function confirmDraft(d: Draft, index: number) {
    if (!boardId || !firstColumnId) return setError('На доске нет колонок');
    const { error } = await supabase.from('tasks').insert({
      board_id: boardId,
      column_id: firstColumnId,
      title: d.title,
      description: d.description,
      priority: d.priority,
      source_message_id: d.sourceMessageId ?? null,
      created_by: userId,
    });
    if (error) return setError(error.message);
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="chat-shell flex h-[calc(100dvh-9rem)] min-h-[420px] flex-col rounded-2xl border border-line bg-white p-4 shadow-sm" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (canWrite && !busy) pickFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="mr-auto"><h1 className="text-xl font-semibold">Чат команды <span className="text-orange-600">✦</span></h1><p className="text-xs text-mute">Обсуждения, файлы и идеи для новых задач</p></div>
        <input className="input sm:max-w-64" aria-label="Поиск по загруженным сообщениям" placeholder="Поиск в загруженной истории…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {threadId&&<div className="mb-3 flex items-center gap-3"><button className="btn" disabled={busy} onClick={()=>{setThreadId(null);setSearch('')}}>← Общий чат</button><span className="text-sm text-mute">Ветка обсуждения</span></div>}
      {readInfo.count>0&&<div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-orange-500/10 p-3 text-sm"><span className="mr-auto">Непрочитанных: {readInfo.count}</span><button className="btn" disabled={threadBusy} onClick={()=>readInfo.first_id&&openMessage(readInfo.first_id)}>К первому непрочитанному</button><button className="btn" onClick={markRead}>Отметить прочитанным</button></div>}
      {threadBusy&&<p className="mb-2 text-xs text-mute">Загрузка обсуждения…</p>}
      <ul ref={scrollRef} onScroll={e => { const el = e.currentTarget; shouldScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="flex-1 space-y-2 overflow-y-auto pr-1">
        {hasHistory && !threadId && <li><button type="button" className="btn w-full" disabled={loadingHistory} onClick={loadHistory}>{loadingHistory ? 'Загрузка…' : 'Загрузить предыдущие сообщения'}</button></li>}
        {!visible.length && <li className="py-12 text-center text-mute">{search ? 'Ничего не найдено' : 'Начните обсуждение — отправьте сообщение или файл'}</li>}
        {visible.map((m) => (
          <li
            key={m.id}
            id={`message-${m.id}`}
            className={`card flex flex-wrap gap-3 p-3 text-sm ${m.author_id === userId ? 'chat-own' : ''} ${m.is_ai ? 'bg-neutral-100' : ''} ${
              selected.includes(m.id) || highlight===m.id ? 'ring-2 ring-orange-400' : ''
            }`}
          >
            {canWrite && !m.deleted_at && (
              <input
                type="checkbox"
                aria-label="Выбрать сообщение"
                checked={selected.includes(m.id)}
                onChange={(e) =>
                  setSelected((s) => (e.target.checked ? [...s, m.id] : s.filter((x) => x !== m.id)))
                }
              />
            )}
            <div className="min-w-0 flex-1">
              {m.is_ai ? (
                <span className="mb-1 block text-xs font-medium text-mute">ИИ</span>
              ) : (
                <UserName
                  className="mb-0.5 block text-xs"
                  look={looks[m.author_id] ?? { name: 'Участник', icon: null, color: null }}
                />
              )}
              {m.is_pinned&&<span className="mb-1 block text-xs text-orange-600">📌 Закреплено</span>}
              {m.deleted_at?<span className="italic text-mute">Сообщение удалено</span>:m.is_ai?<RichText text={displayMentions(m.body)}/>:<span className="whitespace-pre-wrap break-words">{displayMentions(m.body)}</span>}
              {readInfo.count>0&&m.author_id!==userId&&(m.created_at>readInfo.last_read_at||(m.created_at===readInfo.last_read_at&&m.id>readInfo.last_read_id))&&<span className="ml-2 text-xs text-orange-600">Новое</span>}
              {!m.deleted_at&&m.mentions?.includes(userId)&&<span className="ml-2 rounded bg-orange-500/10 px-1 text-xs text-orange-600">Вас упомянули</span>}
              {(m.files ?? []).map(f => <div key={f.path} className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={()=>download(f)} className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-left"><span>📎</span><span className="min-w-0 truncate">{f.name}</span><span className="shrink-0 text-xs text-mute">{Math.max(1,Math.round(f.size/1024))} КБ ↓</span></button><FilePreview source="message" id={m.id} path={f.path} name={f.name}/></div>)}
              <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('ru-RU')} className={m.is_ai ? 'mt-1 block text-xs text-mute' : 'ml-2 text-xs text-mute'}>
                {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
            <div className="flex w-full shrink-0 flex-wrap items-center gap-3 border-t border-line pt-2 text-xs sm:w-auto sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
            {!threadId&&<button disabled={threadBusy} className="text-orange-600" onClick={()=>openMessage(m.id)}>Ответы · {m.reply_count??0}</button>}
            {canWrite&&!m.deleted_at&&<><button className="text-mute hover:text-orange-600" disabled={!boardId||!!taskBusy} onClick={()=>makeTask(m)}>{taskBusy===m.id?'Создание…':'Создать задачу'}</button><button className="text-mute" disabled={busy} onClick={()=>{setSelected([m.id]);setText('/task Создай задачу по выбранному сообщению')}}>ИИ-черновик</button><button className="text-mute" onClick={()=>pin(m)}>{m.is_pinned?'Открепить':'Закрепить'}</button></>}
            {createdTasks[m.id]&&<a className="text-orange-600 underline" href={`/d/${depId}/board?task=${createdTasks[m.id]}`}>Открыть задачу ↗</a>}
            {canWrite && !m.deleted_at && m.author_id === userId && <button type="button" className="self-start text-xs text-mute hover:text-red-600" aria-label="Удалить сообщение" onClick={() => removeMessage(m)}>Удалить</button>}
            </div>
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ul>

      {drafts.length > 0 && (
        <section className="my-3 rounded-lg border border-ink p-3">
          <h3 className="text-sm font-medium">Черновики карточек — подтвердите</h3>
          <ul className="mt-2 space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <div className="flex-1">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-mute">{d.description}</p>
                </div>
                <button className="btn-solid py-1" onClick={() => confirmDraft(d, i)}>
                  Создать
                </button>
                <button className="btn py-1" onClick={() => setDrafts((p) => p.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {preview && (
        <p className="mt-2 text-xs text-mute">
          В ИИ уйдёт {preview.chars} симв. из чата; замаскировано элементов: {preview.masked}
          {selected.length > 0 && ` · выбрано сообщений: ${selected.length}`}
          {preview.withBoard && ' · плюс данные доски (задачи, исполнители, сроки; маскируются на сервере)'}
        </p>
      )}

      {files.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{files.map((f, i) => <span key={i} className="flex max-w-full items-center gap-2 rounded-lg bg-paper px-3 py-2 text-xs"><span className="truncate">📎 {f.name}</span><button type="button" disabled={busy} aria-label={`Убрать ${f.name}`} onClick={() => setFiles(prev => prev.filter((_, n) => n !== i))}>✕</button></span>)}</div>}
      {canWrite&&mentionQuery!==null&&<div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-line p-2">{Object.entries(looks).filter(([,look])=>look.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0,8).map(([id,look])=><button type="button" key={id} className="btn" onClick={()=>{setText(prev=>prev.replace(/@[^@\n]*$/,`@${look.name} `));setMentionIds(prev=>[...new Set([...prev,id])]);setMentionQuery(null);textareaRef.current?.focus()}}>@{look.name}</button>)}<button type="button" aria-label="Закрыть подсказки упоминаний" className="text-xs text-mute" onClick={()=>setMentionQuery(null)}>✕</button></div>}
      {canWrite&&<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mute"><label>Упомянуть участника <select className="ml-1 rounded-lg border border-line bg-white p-1" aria-label="Упомянуть участника" value="" disabled={busy} onChange={e=>{const id=e.target.value;if(!id)return;setMentionIds(prev=>[...new Set([...prev,id])]);setText(prev=>`${prev}${prev&&!prev.endsWith(' ')?' ':''}@${looks[id].name} `);textareaRef.current?.focus()}}><option value="">@ Выбрать</option>{Object.entries(looks).map(([id,look])=><option key={id} value={id}>{look.name}</option>)}</select></label>{threadId&&<span>Сообщение будет отправлено в эту ветку</span>}</div>}
      {canWrite ? (
        <form onSubmit={send} className="mt-2 flex items-end gap-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={e => { pickFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          <button type="button" className="btn" disabled={busy} aria-label="Прикрепить файлы" onClick={() => fileRef.current?.click()}>📎</button>
          <textarea
            ref={textareaRef}
            aria-label="Сообщение"
            disabled={busy}
            className="input max-h-40 resize-y"
            rows={text.includes('\n') ? 4 : 1}
            placeholder="Сообщение или /task /summary /ask /standup /meeting"
            value={text}
            onChange={(e) => {setText(e.target.value);const match=e.target.value.slice(0,e.target.selectionStart).match(/@([^@\n]{0,40})$/);setMentionQuery(match?match[1]:null)}}
            onKeyDown={(e) => {
              // Enter отправляет, Shift+Enter — новая строка (для длинных заметок встречи)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={8000}
          />
          <button className="btn-solid" disabled={busy || (!text.trim() && !files.length)}>
            {busy ? '…' : 'Отправить'}
          </button>
        </form>
      ) : (
        <p className="mt-2 text-sm text-mute">Режим просмотра: писать в чат нельзя.</p>
      )}
      <details className="mt-2 text-xs text-mute">
        <summary className="cursor-pointer">ИИ-команды · Enter — отправить · Shift+Enter — новая строка · файлы до 10 МБ</summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {Object.values(COMMAND_HELP).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
