import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
// Docker passes environment directly; these files also support local development.
for(const file of ['.env.local','.env']){try{for(const line of readFileSync(file,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]??=m[2].trim().replace(/^(['"])(.*)\1$/,'$2')}}catch{}}
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;let stopping=false;
process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
if(!url||!key){console.error('Scheduler: configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');process.exitCode=1;}
else{while(!stopping){try{const response=await fetch(`${url.replace(/\/$/,'')}/rest/v1/rpc/run_due_recurring`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(45000)});if(!response.ok)console.error(`Scheduler: database request failed (${response.status})`);else{const result=await response.json();if(result.created||result.failed)console.log('Scheduler:',JSON.stringify(result));}}catch{console.error('Scheduler: connection failed; retrying')}for(let n=0;n<60&&!stopping;n++)await delay(1000)}}
