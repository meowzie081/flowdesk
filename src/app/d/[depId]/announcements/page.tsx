import {createClient} from '@/lib/supabase/server';
import CampaignComposer from '@/components/CampaignComposer';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
type Stat = {id: string; channel: string; status: string; count: number};
const statuses: Record<string, string> = {pending: 'В очереди', processing: 'Обрабатывается', sent: 'Принято сервисом', skipped: 'Пропущено', failed: 'Ошибка'};
export default async function AnnouncementsPage({params}: {params: {depId: string}}) {
  const db = createClient();
  const {data: owner} = await db.rpc('is_owner', {dep: params.depId});
  const {data: campaigns, error} = await db.from('email_campaigns').select('id,subject,body,recipient_count,created_at').eq('department_id', params.depId).order('created_at', {ascending: false}).limit(30);
  const {data: rawStats} = owner ? await db.rpc('campaign_delivery_stats', {dep: params.depId}) : {data: null};
  const stats = (rawStats ?? []) as Stat[];
  return <div className="max-w-3xl">
    <div className="mb-6"><p className="text-xs font-semibold uppercase tracking-widest text-orange-600">На связи с командой</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Объявления и рассылки</h1><p className="mt-2 text-sm text-mute">Важные новости отдела в одном месте. Каналы доставки можно выбрать в <Link className="underline" href="/profile#notifications">профиле</Link>.</p></div>
    {error ? <p role="alert" className="card text-sm text-red-600">Не удалось загрузить объявления. Проверьте миграцию 0014.</p> : <>
      {owner && <CampaignComposer depId={params.depId}/>}
      <h2 className="mb-3 text-sm font-semibold">Последние объявления</h2>
      {!campaigns?.length && <p className="card text-sm text-mute">Пока нет объявлений.{owner ? ' Создайте первое сообщение для команды.' : 'Здесь появятся сообщения владельца отдела.'}</p>}
      <div className="space-y-4">{campaigns?.map(c => <article key={c.id} id={c.id} className="card scroll-mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mute"><time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow'})} МСК</time>{owner && <span>Участников: {c.recipient_count}</span>}</div>
        <h3 className="mt-3 break-words text-lg font-semibold">{c.subject}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{c.body}</p>
        {owner && <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">{stats.filter(s => s.id === c.id).map(s => <span key={`${s.channel}-${s.status}`} className="rounded-full bg-neutral-100 px-2 py-1 text-xs text-mute">{s.channel === 'email' ? 'Email' : 'Push'} · {statuses[s.status] ?? s.status}: {s.count}</span>)}{!stats.some(s => s.id === c.id) && <span className="text-xs text-mute">Внешняя доставка не запланирована: подписавшихся получателей нет.</span>}</div>}
      </article>)}</div>
      {owner && <p className="mt-4 text-xs text-mute">Счётчики доставки показывают очередь за последние 30 дней. «Принято сервисом» не подтверждает прочтение или попадание письма во входящие. Обновите страницу для актуального статуса.</p>}
    </>}
  </div>;
}
