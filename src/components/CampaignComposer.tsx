'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {postJSON} from '@/lib/http';
export default function CampaignComposer({depId}: {depId: string}) {
  const router = useRouter();
  const [subject, setSubject] = useState(''), [body, setBody] = useState(''), [preview, setPreview] = useState(false);
  const [id, setId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function publish() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    const campaignId = id ?? crypto.randomUUID(); setId(campaignId);
    try {
      const result = await postJSON('/api/notifications/campaigns', {departmentId: depId, id: campaignId, subject, body});
      setMessage(`Объявление создано для ${result.recipients} участников. Письма и push поставлены в очередь для подписавшихся пользователей.`);
      setSubject(''); setBody(''); setPreview(false); setId(null); router.refresh();
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section className="card mb-6">
    <h2 className="font-semibold">Новое объявление</h2><p className="mt-1 text-sm text-mute">Все активные участники увидят его в FlowDesk. Email получат подписавшиеся пользователи с подтверждённой почтой; push — подключённые устройства.</p>
    {!preview ? <form className="mt-5 space-y-4" onSubmit={e => {e.preventDefault(); setPreview(true); setError('');}}>
      <label className="block text-sm font-medium">Тема<input className="input mt-1 w-full" required maxLength={120} value={subject} onChange={e => {setSubject(e.target.value); setId(null);}} placeholder="Например, планы команды на неделю"/></label>
      <label className="block text-sm font-medium">Текст<textarea className="input mt-1 min-h-40 w-full" required maxLength={4000} value={body} onChange={e => {setBody(e.target.value); setId(null);}} placeholder="Что важно знать коллегам?"/></label>
      <div className="flex items-center justify-between"><span className="text-xs text-mute">{body.length} / 4000</span><button className="btn-solid" disabled={!subject.trim() || !body.trim()}>Предпросмотр</button></div>
    </form> : <div className="mt-5">
      <p className="mb-2 text-xs font-medium uppercase tracking-widest text-mute">Так увидят получатели</p>
      <article className="rounded-2xl border border-line p-5"><p className="mb-3 text-sm font-semibold text-orange-600">FlowDesk · объявление отдела</p><h3 className="break-words text-xl font-semibold">{subject}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{body}</p><span className="mt-4 inline-block text-sm text-orange-600">Открыть FlowDesk →</span></article>
      <p className="mt-3 text-xs text-mute">После отправки объявление нельзя отредактировать. Email содержит этот текст; push показывает только факт нового уведомления.</p>
      <div className="mt-4 flex flex-wrap gap-2"><button className="btn" disabled={busy} onClick={() => setPreview(false)}>Изменить</button><button className="btn-solid" disabled={busy} onClick={publish}>{busy ? 'Создаём…' : 'Опубликовать и поставить в рассылку'}</button></div>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-mute">{message}</p>}
  </section>;
}
