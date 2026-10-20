'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import UnreadBadge from './UnreadBadge';
import Icon,{type IconName} from './Icon';
const items:{suffix:string;label:string;icon:IconName}[]=[
 {suffix:'/my-day',label:'Мой день',icon:'calendar'},{suffix:'',label:'Обзор',icon:'overview'},{suffix:'/board',label:'Канбан',icon:'board'},
 {suffix:'/chat',label:'Чат',icon:'chat'},{suffix:'/files',label:'Файлы',icon:'files'},
 {suffix:'/search',label:'Поиск',icon:'search'},{suffix:'/tasks',label:'Мои задачи',icon:'tasks'},
 {suffix:'/calendar',label:'Календарь',icon:'calendar'},{suffix:'/templates',label:'Шаблоны и повторы',icon:'repeat'},
 {suffix:'/archive',label:'Архив',icon:'archive'},{suffix:'/summary',label:'Сводка',icon:'summary'},
 {suffix:'/announcements',label:'Объявления',icon:'bell'},
 {suffix:'/team',label:'Команда',icon:'team'},
];
export default function Sidebar({depId,departments}:{depId:string;departments:{id:string;name:string}[]}){
 const path=usePathname();
 return <aside className="app-sidebar border-b border-line bg-white p-3 lg:sticky lg:top-0 lg:max-h-dvh lg:w-60 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-4 lg:py-6">
  <p className="mb-3 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-mute lg:block">Рабочее пространство</p>
  <nav aria-label="Разделы отдела" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">{items.map(({suffix,label,icon})=>{const href=`/d/${depId}${suffix}`,active=path===href;return <Link key={href} href={href} aria-current={active?'page':undefined} className={`sidebar-link flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active?'sidebar-active font-semibold':'text-mute hover:bg-neutral-100 hover:text-ink'}`}><Icon name={icon} className="shrink-0" width={18} height={18}/><span className="whitespace-nowrap">{label}</span>{suffix==='/chat'&&<UnreadBadge depId={depId}/>}</Link>})}</nav>
  <details className="mt-4 border-t border-line pt-4 lg:mt-6 lg:pt-5" open><summary className="cursor-pointer px-3 text-[10px] font-semibold uppercase tracking-widest text-mute">Мои отделы</summary><ul className="mt-2 flex flex-wrap gap-1 lg:flex-col">{departments.map(department=><li key={department.id}><Link href={`/d/${department.id}/my-day`} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${depId===department.id?'bg-neutral-100 font-medium':'text-mute hover:bg-neutral-100'}`}><span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-xs text-mute">{department.name.slice(0,1).toUpperCase()}</span><span className="break-words">{department.name}</span></Link></li>)}</ul><Link href="/" className="mt-3 block px-3 text-xs font-medium text-orange-600 hover:underline">+ Управление отделами</Link></details>
 </aside>;
}
