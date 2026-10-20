import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
for(const file of ['.env.local','.env']){try{for(const line of readFileSync(file,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]??=m[2].trim().replace(/^(['"])(.*)\1$/,'$2')}}catch{}}
const loop=process.argv.includes('--loop');
const dry=process.argv.includes('--dry-run');
const secret=process.env.NOTIFICATION_CRON_SECRET;
const raw=process.env.NOTIFICATION_DISPATCH_URL??`${process.env.FLOWDESK_PUBLIC_URL??''}/api/notifications/dispatch`;
let url;
try {
 url=new URL(raw);
 const local=['localhost','127.0.0.1','web'].includes(url.hostname);
 if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash||url.pathname!=='/api/notifications/dispatch'||!secret||!/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw new Error();
} catch {console.error('Настройте FLOWDESK_PUBLIC_URL (HTTPS) и NOTIFICATION_CRON_SECRET (32–256 букв, цифр, _ или -).');process.exit(1);}
if(dry){console.log('Конфигурация адреса и секрета проверена. Очередь не запускалась, письма и push не отправлялись.');process.exit(0);}
let stopping=false;
process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
do {
 try {
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(55000),redirect:'error'});
  if(!response.ok){console.error(`Доставка: HTTP ${response.status}. Проверьте настройки и миграцию 0014.`);if(!loop)process.exitCode=1;}
  else {const result=await response.json();console.log('Доставка:',JSON.stringify({sent:result.sent,skipped:result.skipped,pending:result.pending,failed:result.failed}));}
 } catch {console.error('Не удалось подключиться к обработчику доставки');if(!loop)process.exitCode=1;}
 if(loop)for(let i=0;i<60&&!stopping;i++)await delay(1000);
} while(loop&&!stopping);
