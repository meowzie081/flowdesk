'use client';
import {useMemo,useState,useEffect} from 'react';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/client';
import {moscowDay} from '@/lib/collaboration';
import {calendarCells,addDays,shiftMonth,monthTitle} from '@/lib/workflow';
import Icon from './Icon';
interface Row{id:string;title:string;due_date:string|null;priority:string;column_id:string;assignee_id:string|null}
const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const priorities:Record<string,string>={low:'Низкий',medium:'Средний',high:'Высокий'};
function formatDay(day:string){return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`))}
export default function TaskExplorer({depId,userId,mode}:{depId:string;userId:string;mode:'mine'|'calendar'|'archive'}){
 const sb=useMemo(()=>createClient(),[]);
 const today=moscowDay();
 const [mine,setMine]=useState(mode==='mine'),[status,setStatus]=useState('open'),[deadline,setDeadline]=useState('all');
 const [month,setMonth]=useState(today.slice(0,7)),[priority,setPriority]=useState('all'),[rows,setRows]=useState<Row[]>([]);
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[version,setVersion]=useState(0),[page,setPage]=useState(0);
 const [canWrite,setCanWrite]=useState(false),[selectedDay,setSelectedDay]=useState('');
 const cells=useMemo(()=>calendarCells(month),[month]);
 const years=Array.from(new Set([...Array.from({length:21},(_,i)=>Number(today.slice(0,4))-10+i),Number(month.slice(0,4))])).sort((a,b)=>a-b);
 function changeMonth(value:string){setMonth(value);setSelectedDay('');setPage(0)}
 function chooseDay(day:string){if(day.slice(0,7)!==month)setMonth(day.slice(0,7));setSelectedDay(day);setPage(0)}
 useEffect(()=>{let alive=true;sb.from('department_members').select('role').eq('department_id',depId).eq('user_id',userId).maybeSingle().then(({data})=>{if(alive)setCanWrite(data?.role==='member'||data?.role==='owner')});return()=>{alive=false}},[sb,depId,userId]);
 useEffect(()=>{
  let alive=true;
  async function load(){
   setBusy(true);setError('');setRows([]);
   try{
    const result:Row[]=[];
    for(let offset=0;;offset+=500){
     let q=sb.from('tasks').select('id,title,due_date,priority,column_id,assignee_id,boards!inner(department_id),columns!inner(name,is_done)').eq('boards.department_id',depId).order('due_date',{nullsFirst:false}).order('id').range(offset,offset+499);
     if(mode==='archive')q=q.not('archived_at','is',null);
     else{
      q=q.is('archived_at',null);
      if(mine)q=q.eq('assignee_id',userId);
      if(status!=='all')q=q.eq('columns.is_done',status==='done');
      if(priority!=='all')q=q.eq('priority',priority);
      if(mode==='calendar')q=q.gte('due_date',cells[0].date).lt('due_date',addDays(cells[cells.length-1].date,1));
      else{
       if(deadline==='overdue')q=q.lt('due_date',today);
       if(deadline==='today')q=q.eq('due_date',today);
       if(deadline==='week')q=q.gte('due_date',today).lt('due_date',addDays(today,7));
       if(deadline==='none')q=q.is('due_date',null);
      }
     }
     const {data,error}=await q;if(error)throw error;
     result.push(...data as Row[]);if(data.length<500)break;
    }
    if(alive){setRows(result);setPage(0)}
   }catch(e){if(alive)setError((e as Error).message)}finally{if(alive)setBusy(false)}
  }
  load();return()=>{alive=false};
 },[sb,depId,userId,mode,mine,status,deadline,priority,cells,today,version]);
 async function restore(id:string){setBusy(true);const {error}=await sb.rpc('archive_task',{task:id,archived:false});if(error){setError(error.message);setBusy(false)}else setVersion(v=>v+1)}
 const monthRows=mode==='calendar'?rows.filter(t=>t.due_date?.startsWith(month)):rows;
 const visible=selectedDay&&mode==='calendar'?rows.filter(t=>t.due_date===selectedDay):monthRows;
 const byDay=useMemo(()=>{const map=new Map<string,Row[]>();for(const task of rows){if(task.due_date)map.set(task.due_date,[...(map.get(task.due_date)??[]),task])}return map},[rows]);
 return <section className="space-y-5" aria-busy={busy}>
  <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-mute">Планирование работы</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{{mine:'Мои задачи',calendar:'Календарь задач',archive:'Архив задач'}[mode]}</h1><p className="mt-2 text-sm text-mute">{{mine:'Всё, что требует вашего внимания, в одном месте.',calendar:'Сроки, приоритеты и планы команды — по дням.',archive:'Завершённая работа и задачи, которые можно вернуть на доску.'}[mode]}</p></div>
  {mode!=='archive'&&<div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
   <label className="mr-auto flex min-h-10 cursor-pointer items-center gap-2 px-2 text-sm"><input className="h-4 w-4 accent-orange-600" type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/> Только мои задачи</label>
   <select aria-label="Состояние задач" className="input w-auto" value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Открытые</option><option value="done">Завершённые</option><option value="all">Все состояния</option></select>
   <select aria-label="Приоритет задач" className="input w-auto" value={priority} onChange={e=>setPriority(e.target.value)}><option value="all">Любой приоритет</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option></select>
   {mode!=='calendar'&&<select aria-label="Срок задач" className="input w-auto" value={deadline} onChange={e=>setDeadline(e.target.value)}><option value="all">Все сроки</option><option value="overdue">Просроченные</option><option value="today">На сегодня</option><option value="week">Ближайшие 7 дней</option><option value="none">Без срока</option></select>}
  </div>}
  {error&&<p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600">{error}</p>}
  {mode==='calendar'&&<div className="calendar-panel overflow-hidden rounded-2xl border border-line bg-white">
   <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-4 sm:p-5">
    <div className="flex items-center gap-3"><span className="hidden rounded-xl bg-orange-500/10 p-2.5 text-orange-600 sm:block"><Icon name="calendar" width={24} height={24}/></span><div><h2 className="text-xl font-semibold tracking-tight" aria-live="polite">{monthTitle(month)}</h2><p className="mt-0.5 text-xs text-mute">{busy?'Загрузка задач…':`Задач на месяц: ${monthRows.length}`}</p></div></div>
    <div className="flex flex-wrap items-center gap-2">
     <div className="flex items-center gap-1"><select aria-label="Месяц" className="input w-auto" value={month.slice(5)} onChange={e=>changeMonth(`${month.slice(0,4)}-${e.target.value}`)}>{months.map((name,i)=><option key={name} value={String(i+1).padStart(2,'0')}>{name}</option>)}</select><select aria-label="Год" className="input w-auto" value={month.slice(0,4)} onChange={e=>changeMonth(`${e.target.value}-${month.slice(5)}`)}>{years.map(year=><option key={year} value={year}>{year}</option>)}</select></div>
     <button className="btn" onClick={()=>changeMonth(today.slice(0,7))}>Сегодня</button>
     <div className="flex gap-1"><button className="btn px-2" aria-label="Предыдущий месяц" onClick={()=>changeMonth(shiftMonth(month,-1))}><Icon name="left"/></button><button className="btn px-2" aria-label="Следующий месяц" onClick={()=>changeMonth(shiftMonth(month,1))}><Icon name="right"/></button></div>
    </div>
   </div>
   <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Календарь по дням">
    <div className="calendar-grid grid min-w-[630px] grid-cols-7">
     {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((day,i)=><div key={day} className={`bg-neutral-50 px-3 py-3 text-xs font-semibold ${i>4?'text-mute':'text-ink'}`}>{day}</div>)}
     {cells.map((cell,i)=>{const tasks=byDay.get(cell.date)??[];return <div key={cell.date} data-calendar-date={cell.date} className={`calendar-cell min-w-0 border-t border-line p-2 ${cell.inMonth?'':'calendar-outside'} ${i%7>4?'calendar-weekend':''} ${selectedDay===cell.date?'calendar-selected':''}`}>
      <button aria-label={formatDay(cell.date)} aria-pressed={selectedDay===cell.date} aria-current={cell.date===today?'date':undefined} className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium transition ${cell.date===today?'calendar-today':selectedDay===cell.date?'bg-orange-500/15 text-orange-600':'hover:bg-neutral-100'}`} onClick={()=>chooseDay(cell.date)}>{cell.day}</button>
      <div className="space-y-1">{tasks.slice(0,3).map(task=><Link key={task.id} href={`/d/${depId}/board?task=${task.id}`} title={`${task.title} · ${priorities[task.priority]??task.priority} приоритет`} className="calendar-task" data-priority={task.priority}><span className="line-clamp-2 break-words">{task.title}</span></Link>)}</div>
      {tasks.length>3&&<button className="mt-2 rounded px-1 text-xs font-medium text-orange-600 hover:underline" onClick={()=>chooseDay(cell.date)}>Ещё {tasks.length-3}</button>}
     </div>})}
    </div>
   </div>
   <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-neutral-50 px-4 py-3 text-xs text-mute"><span>Нажмите на дату, чтобы увидеть задачи дня</span><div className="flex gap-3">{[['bg-red-400','Высокий'],['bg-amber-400','Средний'],['bg-emerald-400','Низкий']].map(([color,label])=><span className="flex items-center gap-1.5" key={label}><span className={`h-1.5 w-1.5 rounded-full ${color}`}/>{label}</span>)}</div></div>
  </div>}
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{selectedDay&&mode==='calendar'?formatDay(selectedDay):mode==='calendar'?'Задачи месяца':'Список задач'} <span className="ml-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-mute">{visible.length}</span></h2>{selectedDay&&<button className="btn text-xs" onClick={()=>{setSelectedDay('');setPage(0)}}>Показать месяц</button>}</div>
  {busy&&<p role="status" className="text-sm text-mute">Загрузка…</p>}
  <ul className="space-y-2">{visible.slice(page*50,page*50+50).map(task=><li key={task.id} className="card flex flex-wrap items-center gap-3"><span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${task.priority==='high'?'bg-red-400':task.priority==='low'?'bg-emerald-400':'bg-amber-400'}`}/><div className="min-w-0 flex-1"><Link className="break-words text-sm font-medium hover:text-orange-600" href={`/d/${depId}/board?task=${task.id}`}>{task.title}</Link><p className="mt-1 text-xs text-mute">{task.due_date?`Срок: ${formatDay(task.due_date)}`:'Без срока'} · {priorities[task.priority]??task.priority}</p></div>{mode==='archive'&&canWrite&&<button className="btn" disabled={busy} onClick={()=>restore(task.id)}>Восстановить</button>}</li>)}</ul>
  {!busy&&!error&&!visible.length&&<div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center"><Icon name="calendar" className="mx-auto mb-3 text-mute" width={28} height={28}/><p className="text-sm font-medium">По выбранным условиям задач нет</p><p className="mt-1 text-xs text-mute">Выберите другую дату или измените фильтры.</p></div>}
  {visible.length>50&&<div className="flex items-center gap-3"><button className="btn" disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>Назад</button><span className="text-xs text-mute">{page+1} / {Math.ceil(visible.length/50)}</span><button className="btn" disabled={(page+1)*50>=visible.length||busy} onClick={()=>setPage(p=>p+1)}>Далее</button></div>}
 </section>;
}
