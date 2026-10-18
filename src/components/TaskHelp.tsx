'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { helpReasons, type HelpRequest } from '@/lib/my-day';
import type { Member } from './Board';
export function HelpItem({ request: r, userId, isOwner = false, onChanged }: {
    request: HelpRequest;
    userId: string;
    isOwner?: boolean;
    onChanged: () => void;
}) {
    const sb = useMemo(() => createClient(), []);
    const [answer, setAnswer] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function action(kind: 'answer' | 'resume' | 'cancel') { setBusy(true); setError(''); try {
        const { error } = kind === 'answer' ? await sb.rpc('respond_task_help', { request: r.id, answer }) : await sb.rpc('close_task_help', { request: r.id, cancel: kind === 'cancel' });
        if (error)
            throw error;
        setAnswer('');
        onChanged();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <div className="rounded-xl border border-line bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{helpReasons[r.reason]}</strong><span className={`text-xs ${r.status === 'answered' ? 'text-green-700' : 'text-orange-700'}`}>{r.status === 'answered' ? 'Ответ получен' : 'Ждём ответа'}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{r.detail}</p><p className="mt-2 text-xs text-mute">Автор: {r.requester_name ?? 'Участник'} · Помогает: {r.helper_name ?? 'Участник'}</p>{r.response && <div className="mt-3 rounded-lg bg-green-500/10 p-3 text-sm"><strong>Ответ</strong><p className="whitespace-pre-wrap break-words">{r.response}</p><p className="mt-1 text-xs text-mute">Файлы можно приложить в карточке задачи.</p></div>}{r.helper_id === userId && r.status === 'open' && <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); action('answer'); }}><textarea className="input" aria-label="Ответ на запрос помощи" placeholder="Что сделано? Где найти файл или решение?" required maxLength={2000} value={answer} onChange={e => setAnswer(e.target.value)}/><button className="btn btn-primary" disabled={busy || !answer.trim()}>Отправить ответ</button></form>}{(r.requester_id === userId || isOwner) && <div className="mt-3 flex flex-wrap gap-2">{r.status === 'answered' && <button className="btn btn-primary" disabled={busy} onClick={() => action('resume')}>Работа продолжена</button>}<button className="btn" disabled={busy} onClick={() => action('cancel')}>Отменить запрос</button></div>}{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</div>;
}
export default function TaskHelp({ taskId, userId, canWrite, members }: {
    taskId: string;
    userId: string;
    canWrite: boolean;
    members: Member[];
}) {
    const sb = useMemo(() => createClient(), []);
    const [requests, setRequests] = useState<HelpRequest[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [helper, setHelper] = useState('');
    const [reason, setReason] = useState('file');
    const [detail, setDetail] = useState('');
    const [eligible, setEligible] = useState<string[]>([]);
    const load = useCallback(async () => { const { data, error } = await sb.from('task_help_requests').select('*').eq('task_id', taskId).in('status', ['open', 'answered']).order('created_at', { ascending: false }); setLoading(false); if (error) {
        setError('Не удалось загрузить запросы помощи. Обновите страницу или обратитесь к администратору.');
        return;
    } setError(''); setRequests((data ?? []).map(r => ({ ...r, requester_name: members.find(m => m.id === r.requester_id)?.name, helper_name: members.find(m => m.id === r.helper_id)?.name }))); }, [sb, taskId, members]);
    useEffect(() => { load(); const timer = setInterval(() => { if (document.visibilityState === 'visible')
        load(); }, 15000); return () => clearInterval(timer); }, [load]);
    async function show() { setOpen(true); const { data, error } = await sb.from('tasks').select('board_id,boards(department_id)').eq('id', taskId).single(); if (error)
        return setError(error.message); const board = data.boards as unknown as {
        department_id: string;
    }; const result = await sb.from('department_members').select('user_id').eq('department_id', board.department_id).is('blocked_at', null).in('role', ['owner', 'member']).neq('user_id', userId); if (result.error)
        return setError(result.error.message); setEligible((result.data ?? []).map(m => m.user_id)); }
    async function send(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try {
        const { error } = await sb.rpc('request_task_help', { task: taskId, helper, reason_code: reason, details: detail.trim() });
        if (error)
            throw error;
        setOpen(false);
        setDetail('');
        await load();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <section className="mt-5 border-t border-line pt-4"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">Нужна помощь</h3>{canWrite && !requests.length && !loading && !open && <button className="btn" onClick={show}>Запросить помощь</button>}</div><p className="mt-1 text-xs text-mute">Укажите, от кого и чего вы ждёте. Запрос появится в «Моём дне» коллеги.</p>{loading && <p role="status">Загрузка…</p>}<div className="mt-3 space-y-2">{requests.map(r => <HelpItem key={r.id} request={r} userId={canWrite ? userId : ''} onChanged={load}/>)}</div>{open && <form onSubmit={send} className="mt-3 space-y-3"><label className="block text-sm">От кого ждём<select required className="input mt-1" value={helper} onChange={e => setHelper(e.target.value)}><option value="">Выберите коллегу</option>{members.filter(m => eligible.includes(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{!eligible.length && <p className="text-sm text-mute">Нужен ещё один активный участник с правом записи.</p>}<label className="block text-sm">Что нужно<select className="input mt-1" value={reason} onChange={e => setReason(e.target.value)}>{Object.entries(helpReasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="block text-sm">Подробности<textarea className="input mt-1" required maxLength={1000} placeholder="Например: нужен текст для главного экрана" value={detail} onChange={e => setDetail(e.target.value)}/></label><div className="flex gap-2"><button className="btn btn-primary" disabled={busy || !helper || !detail.trim()}>Отправить запрос</button><button type="button" className="btn" onClick={() => setOpen(false)}>Закрыть</button></div></form>}{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</section>;
}
