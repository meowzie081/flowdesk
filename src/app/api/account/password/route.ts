import { NextResponse } from 'next/server';
import { createClient as authClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/http';
import { z } from 'zod';
const schema=z.object({currentPassword:z.string().min(1).max(128),password:z.string().min(8).max(128)});
export async function POST(req:Request) {
 if(!sameOrigin(req))return NextResponse.json({error:'Недопустимый источник запроса'},{status:403});
 const sb=createClient();const {data:{user}}=await sb.auth.getUser();if(!user?.email)return NextResponse.json({error:'Войдите в аккаунт'},{status:401});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Пароль: 8–128 символов. Укажите текущий пароль'},{status:400});
 const isolated=authClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 try {
  const verified=await isolated.auth.signInWithPassword({email:user.email,password:parsed.data.currentPassword});
  if(verified.error||verified.data.user?.id!==user.id)return NextResponse.json({error:'Проверьте текущий пароль'},{status:400});
  const changed=await isolated.auth.updateUser({password:parsed.data.password});
  if(changed.error)return NextResponse.json({error:'Не удалось сменить пароль. Проверьте требования безопасности Supabase'},{status:400});
  await sb.auth.signOut({scope:'local'});
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Не удалось связаться с сервером авторизации'},{status:502})}
 finally {await isolated.auth.signOut({scope:'local'}).catch(()=>{});}
}
