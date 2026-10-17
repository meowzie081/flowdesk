import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sameOrigin } from '@/lib/http';
const schema=z.object({departmentId:z.string().uuid(),userId:z.string().uuid(),password:z.string().min(8).max(128)});
export async function POST(req:Request) {
 if(!sameOrigin(req))return NextResponse.json({error:'Недопустимый источник запроса'},{status:403});
 const sb=createClient();const {data:{user}}=await sb.auth.getUser();if(!user)return NextResponse.json({error:'Войдите в аккаунт'},{status:401});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Проверьте пользователя и пароль (8–128 символов)'},{status:400});
 const admin=createAdminClient();if(!admin)return NextResponse.json({error:'Не настроен серверный ключ Supabase'},{status:503});
 const {data:event,error}=await sb.rpc('begin_password_reset',{dep:parsed.data.departmentId,target:parsed.data.userId});
 if(error)return NextResponse.json({error:'Сброс доступен только для созданных вами пользователей этого отдела'},{status:403});
 let success=false;
 try {const response=await admin.auth.admin.updateUserById(parsed.data.userId,{password:parsed.data.password});success=!response.error;}
 catch {success=false;}
 const finished=await admin.rpc('finish_password_reset',{event,success});
 if(!success)return NextResponse.json({error:'Не удалось сбросить пароль. Проверьте требования Supabase Auth'},{status:502});
 return NextResponse.json({ok:true,warning:finished.error?'Пароль изменён; в журнале сохранён запрос без подтверждённого результата':undefined},{headers:{'Cache-Control':'no-store'}});
}
