'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { localDay, resumeKey, todayTasks, type DayTask, type HelpRequest } from '@/lib/my-day';
import { HelpItem } from './TaskHelp';
type Inbox = {
    id: string;
    task_id: string | null;
    message_id: string | null;
    kind: string;
    title: string;
    body: string | null;
};
type Data = {
    tasks: DayTask[];
    requests: HelpRequest[];
    inbox: Inbox[];
};
const priorityNames = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
export default function MyDay({ depId, userId, role }: {
    depId: string;
    userId: string;
    role: string;
}) {
    const sb = useMemo(() => createClient(), []);
    const [data, setData] = useState<Data>({ tasks: [], requests: [], inbox: [] });
    const [day, setDay] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [resume, setResume] = useState<{
        id: string;
        title: string;
    } | null>(null);
    const canWrite = role === 'owner' || role === 'member';
    const load = useCallback(async () => { const current = localDay(); setDay(current); const { data, error } = await sb.rpc('my_day', { dep: depId, day: current }); setLoading(false); if (error) {
        setError('Не удалось обновить «Мой день». Проверьте подключение и повторите попытку.');
        return;
    } setError(''); setData(data as Data); }, [sb, depId]);
    useEffect(() => { load(); const timer = setInterval(() => { if (document.visibilityState === 'visible')
        load(); }, 15000); const focus = () => load(); window.addEventListener('focus', focus); return () => { clearInterval(timer); window.removeEventListener('focus', focus); }; }, [load]);
    useEffect(() => { let alive = true; try {
        const id = localStorage.getItem(resumeKey(depId, userId));
        if (id && /^[0-9a-f-]{36}$/i.test(id))
            sb.from('tasks').select('id,title,boards!inner(department_id)').eq('id', id).eq('boards.department_id', depId).is('archived_at', null).maybeSingle().then(({ data }) => { if (alive)
                setResume(data ? { id: data.id, title: data.title } : null); });
    }
    catch { /* Storage may be disabled. */ } return () => { alive = false; }; }, [sb, depId, userId]);
    async function plan(task: DayTask) { setBusy(true); setError(''); const { error } = task.planned ? await sb.from('day_plans').delete().eq('user_id', userId).eq('task_id', task.id).eq('day', day) : await sb.from('day_plans').insert({ user_id: userId, task_id: task.id, day }); if (error)
        setError(error.message);
    else
        await load(); setBusy(false); }
    async function read(n: Inbox) { setBusy(true); const { error } = await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).eq('user_id', userId); if (error)
        setError(error.message);
    else
        await load(); setBusy(false); }
    const today = todayTasks(data.tasks, day);
    const incoming = data.requests.filter(r => r.helper_id === userId && r.status === 'open');
    const waiting = data.requests.filter(r => r.requester_id === userId || data.tasks.some(t => t.id === r.task_id));
    const team = role === 'owner' ? data.requests.filter(r => !waiting.includes(r) && !incoming.includes(r)) : [];
    function tasks(items: DayTask[], empty: string) { return items.length ? <ul className="divide-y divide-line">{items.map(t => <li key={t.id} className="flex items-center gap-3 py-4"><div className="min-w-0 flex-1"><Link href={`/d/${depId}/board?task=${t.id}`} className="font-medium hover:text-orange-600 break-words">{t.title}</Link><p className="mt-1 text-xs text-mute">{priorityNames[t.priority]} приоритет{t.due_date ? ` · ${new Date(t.due_date + 'T12:00:00').toLocaleDateString('ru-RU')}` : ' · Без срока'}{t.due_date && t.due_date < day ? ' · Просрочено' : ''}</p></div>{canWrite && <button className="btn shrink-0 text-xs" disabled={busy} aria-label={`${t.planned ? 'Убрать из плана' : 'На сегодня'}: ${t.title}`} onClick={() => plan(t)}>{t.planned ? 'Убрать из плана' : 'На сегодня'}</button>}</li>)}</ul> : <p className="py-5 text-sm text-mute">{empty}</p>; }
    function requests(items: HelpRequest[]) { return <div className="mt-3 space-y-3">{items.map(r => <div key={r.id}><Link className="mb-2 block text-sm font-medium text-orange-600 hover:underline" href={`/d/${depId}/board?task=${r.task_id}`}>{r.task_title}</Link><HelpItem request={r} userId={canWrite ? userId : ''} isOwner={role === 'owner'} onChanged={load}/></div>)}</div>; }
    return <div className="mx-auto max-w-6xl"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-orange-600">Личное рабочее пространство</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Мой день</h1><p className="mt-2 text-sm text-mute">{day ? new Date(day + 'T12:00:00').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Сегодня'} · отдел текущего пространства</p></div><button className="btn" onClick={load}>Обновить</button></div>{error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-500/10 p-4 text-sm text-red-600">{error}</p>}{loading ? <p role="status" className="mt-6">Собираем ваш день…</p> : <><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['На сегодня', today.length], ['От меня ждут', incoming.length + data.inbox.length], ['Мои ожидания', waiting.length], ['Получены ответы', waiting.filter(r => r.status === 'answered').length]].map(([label, value]) => <div key={label} className="rounded-2xl border border-line bg-white p-4"><p className="text-xs text-mute">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div>{resume && <Link href={`/d/${depId}/board?task=${resume.id}`} className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-500/10 p-5"><div><p className="text-xs text-mute">Продолжить работу</p><p className="mt-1 font-semibold break-words">{resume.title}</p></div><span className="text-sm text-orange-700">Открыть карточку →</span></Link>}<div className="mt-6 grid gap-6 xl:grid-cols-2"><div className="space-y-6"><section className="rounded-2xl border border-line bg-white p-5"><h2 className="text-lg font-semibold">Сегодня</h2><p className="mt-1 text-xs text-mute">Мои задачи со сроком сегодня и раньше, а также добавленные в план вручную.</p>{tasks(today, 'Срочных задач нет. Выберите задачу из списка ниже.')}</section><section className="rounded-2xl border border-line bg-white p-5"><h2 className="text-lg font-semibold">Мои ожидания</h2><p className="mt-1 text-xs text-mute">Запросы от вас и по назначенным вам задачам.</p>{requests(waiting)}{!waiting.length && <p className="mt-4 text-sm text-mute">Нет активных запросов. В карточке задачи можно запросить помощь.</p>}{data.tasks.filter(t => t.blocked_reason).map(t => <Link key={t.id} href={`/d/${depId}/board?task=${t.id}`} className="mt-3 block rounded-xl bg-orange-500/10 p-3 text-sm"><strong>{t.title}</strong><p className="mt-1 break-words">{t.blocked_reason}</p><span className="text-xs text-mute">Блокировка из карточки</span></Link>)}</section></div><section className="self-start rounded-2xl border border-line bg-white p-5"><h2 className="text-lg font-semibold">От меня ждут ответа</h2><p className="mt-1 text-xs text-mute">Запросы помощи, непрочитанные упоминания и ответы в чате.</p>{requests(incoming)}{data.inbox.map(n => <div key={n.id} className="mt-3 rounded-xl border border-line p-4"><Link href={n.message_id ? `/d/${depId}/chat?message=${n.message_id}` : `/d/${depId}/board?task=${n.task_id}`} className="text-sm font-medium hover:text-orange-600">{n.title}</Link><p className="mt-1 whitespace-pre-wrap break-words text-sm text-mute">{n.body}</p><button className="mt-3 text-xs text-orange-600" disabled={busy} onClick={() => read(n)}>Отметить прочитанным</button></div>)}{!incoming.length && !data.inbox.length && <p className="mt-4 text-sm text-mute">Вы всё посмотрели. Новые запросы появятся здесь.</p>}</section></div><details className="mt-6 rounded-2xl border border-line bg-white p-5"><summary className="cursor-pointer font-semibold">Другие мои задачи · {data.tasks.filter(t => !today.some(d => d.id === t.id)).length}</summary>{tasks(data.tasks.filter(t => !today.some(d => d.id === t.id)), 'Все задачи уже в плане на сегодня.')}</details>{role === 'owner' && <section className="mt-6 rounded-2xl border border-line bg-white p-5"><h2 className="text-lg font-semibold">Ожидания команды</h2><p className="mt-1 text-xs text-mute">Остальные активные запросы отдела. Владелец может отменить потерявший актуальность запрос.</p>{requests(team)}{!team.length && <p className="mt-3 text-sm text-mute">Других активных ожиданий нет.</p>}</section>}<p className="mt-5 text-xs text-mute">План действует на выбранный календарный день по времени вашего устройства. Срок задачи при добавлении в план не меняется. Данные обновляются каждые 15 секунд.</p></>}</div>;
}
