import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionManagedAccount } from '@/lib/managed-accounts';
import { sameOrigin } from '@/lib/http';
export async function POST(request:Request) {
 if(!sameOrigin(request))return NextResponse.json({error:'Недопустимый источник запроса'},{status:403});
 const raw=await request.json().catch(()=>null);
 const session=createClient();
 const outcome=await provisionManagedAccount(raw,{
  currentUser:async()=>{const {data:{user}}=await session.auth.getUser();return user?.id??null},
  isOwner:async(departmentId,userId)=>{const {data,error}=await session.from('department_members').select('role').eq('department_id',departmentId).eq('user_id',userId).maybeSingle();return !error&&data?.role==='owner'},
  admin:()=>{
   const admin=createAdminClient();if(!admin)return null;
   return {
    createUser:async(input)=>{const {data,error}=await admin.auth.admin.createUser(input);return {id:data.user?.id??null,error}},
    registerLogin:async(input)=>{const {error}=await admin.from('managed_accounts').insert(input);return error},
    deleteUser:async(id)=>{const {error}=await admin.auth.admin.deleteUser(id);return error},
   };
  },
  addMember:async(departmentId,userId,role)=>{const {error}=await session.from('department_members').upsert({department_id:departmentId,user_id:userId,role},{onConflict:'department_id,user_id'});return error},
 });
 if(outcome.status===201&&typeof raw?.departmentId==='string')revalidatePath(`/d/${raw.departmentId}/team`);
 return NextResponse.json(outcome.body,{status:outcome.status,headers:{'Cache-Control':'no-store'}});
}
