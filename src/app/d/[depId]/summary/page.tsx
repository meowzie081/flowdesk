import DailySummary from '@/components/DailySummary';
import { dayBounds, moscowDay } from '@/lib/collaboration';
export default async function SummaryPage({params,searchParams}:{params:{depId:string};searchParams:{date?:string}}) {
 let date=searchParams.date??moscowDay();let invalid=false;try{dayBounds(date)}catch{date=moscowDay();invalid=true}
 return <section><h1 className="text-2xl font-semibold">Ежедневная сводка команды</h1><p className="mt-1 text-sm text-mute">Итоги и обсуждения за выбранный день. Просрочки и блокеры — текущее состояние доски.</p><form className="my-5 flex flex-wrap items-end gap-3"><label className="text-xs text-mute">День · московское время<input className="input mt-1" type="date" name="date" defaultValue={date} required/></label><button className="btn-solid">Показать</button></form>{invalid&&<p className="mb-3 text-sm text-red-600">Некорректная дата. Показан текущий день.</p>}<DailySummary depId={params.depId} date={date}/></section>;
}
