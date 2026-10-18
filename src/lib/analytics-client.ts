/** GA4 receives only fixed event names and categorical values. Never pass user content here. */
export const CONSENT_KEY='flowdesk-analytics-consent';
export type Consent='granted'|'denied';
export type ProductEvent='task_created'|'task_moved'|'task_archived'|'message_sent'|'file_uploaded'|'ai_response_received'|'search_used';
export type EventParams={source?:'board'|'chat'|'task'|'search';kind?:'image'|'pdf'|'other';command?:'task'|'summary'|'ask'|'standup'|'meeting'|'digest'|'blocker'|'report'};
const events=new Set(['task_created','task_moved','task_archived','message_sent','file_uploaded','ai_response_received','search_used']);
const values:Record<string,Set<string>>={source:new Set(['board','chat','task','search']),kind:new Set(['image','pdf','other']),command:new Set(['task','summary','ask','standup','meeting','digest','blocker','report'])};
declare global{interface Window{dataLayer?:unknown[];gtag?:(...args:unknown[])=>void;flowdeskGaId?:string}}
export function validMeasurementId(id:string|undefined){return !!id&&/^G-[A-Z0-9]+$/.test(id)}
export function readConsent():Consent|null{
 try{const value=localStorage.getItem(CONSENT_KEY);return value==='granted'||value==='denied'?value:null}catch{return null}
}
export function analyticsSection(path:string){
 const department=path.match(/^\/d\/[^/]+(?:\/([^/?#]+))?\/?$/);
 const names:Record<string,string>={'my-day':'Мой день',overview:'Обзор',board:'Канбан',chat:'Чат',files:'Файлы',search:'Поиск',tasks:'Мои задачи',calendar:'Календарь',templates:'Шаблоны',archive:'Архив',summary:'Сводка',team:'Команда',audit:'Журнал'};
 if(department){const key=department[1]||'overview';if(names[key])return{path:`/app/${key}`,title:`FlowDesk · ${names[key]}`}}
 if(path==='/')return{path:'/',title:'FlowDesk · Отделы'};
 if(path==='/telegram')return{path:'/telegram',title:'FlowDesk · Telegram'};
 if(path==='/login')return{path:'/login',title:'FlowDesk · Вход'};
 if(path==='/profile')return{path:'/profile',title:'FlowDesk · Профиль'};
 return{path:'/other',title:'FlowDesk'};
}
function disable(id:string,value:boolean){(window as unknown as Record<string,unknown>)[`ga-disable-${id}`]=value}
export function startAnalytics(id:string){
 if(typeof window==='undefined'||!validMeasurementId(id)||readConsent()!=='granted')return;
 disable(id,false);window.flowdeskGaId=id;window.dataLayer??=[];
 window.gtag??=((...args:unknown[])=>{window.dataLayer!.push(args)});
 if(document.getElementById('flowdesk-ga')){window.gtag('consent','update',{analytics_storage:'granted'});return;}
 window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 window.gtag('js',new Date());
 const section=analyticsSection(window.location.pathname);
 window.gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:window.location.origin+section.path,page_title:section.title,page_referrer:''});
 const script=document.createElement('script');script.id='flowdesk-ga';script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${id}`;document.head.appendChild(script);
}
export function stopAnalytics(id:string){if(typeof window!=='undefined'&&validMeasurementId(id)){disable(id,true);window.gtag?.('consent','update',{analytics_storage:'denied'});window.flowdeskGaId=undefined}}
export function trackPage(path:string){
 if(typeof window==='undefined'||!window.flowdeskGaId||readConsent()!=='granted')return;
 const section=analyticsSection(path),params={page_location:window.location.origin+section.path,page_title:section.title,page_referrer:''};
 window.gtag?.('set',params);window.gtag?.('event','page_view',params);
}
export function trackEvent(name:ProductEvent,params:EventParams={}){
 if(typeof window==='undefined'||!window.flowdeskGaId||readConsent()!=='granted'||!events.has(name))return;
 const safe=Object.fromEntries(Object.entries(params).filter(([key,value])=>values[key]?.has(value)));
 window.gtag?.('event',name,safe);
}
export function fileKind(type:string):'image'|'pdf'|'other'{return ['image/png','image/jpeg','image/gif','image/webp'].includes(type)?'image':type==='application/pdf'?'pdf':'other'}
