'use client';
import {useState,useMemo} from 'react';
import {useRouter} from 'next/navigation';
import {createClient} from '@/lib/supabase/client';
import {postJSON} from '@/lib/http';
export default function MemberAccess({depId,userId,blocked,canReset}:{depId:string;userId:string;blocked:boolean;canReset:boolean}){
 const sb=useMemo(()=>createClient(),[]);const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState('');
 async function toggle(){setBusy(true);setError('');try{const {error}=await sb.rpc('set_member_blocked',{dep:depId,target:userId,blocked:!blocked});if(error)throw error;router.refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function reset(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{const result=await postJSON('/api/admin/reset-password',{departmentId:depId,userId,password});setPassword('');setMessage(result.warning??'Пароль изменён')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="mt-2 w-full"><button className="btn" disabled={busy} onClick={toggle}>{blocked?'Восстановить доступ':'Приостановить доступ к отделу'}</button>{canReset&&<details className="mt-2 text-xs"><summary className="cursor-pointer">Сбросить пароль</summary><form className="mt-2 flex flex-wrap gap-2" onSubmit={reset}><input className="input max-w-xs" type="password" aria-label="Новый пароль пользователя" placeholder="Новый пароль · минимум 8 символов" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/><button className="btn" disabled={busy}>Задать пароль</button></form></details>}{error&&<p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}{message&&<p role="status" className="mt-2 text-xs text-green-600">{message}</p>}</div>;
}
