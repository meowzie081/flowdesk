import { createAccountSchema, loginEmail } from './accounts';
interface ProviderError { code?: string; message?: string; status?: number }
export interface AccountAdmin {
 createUser: (input:{email:string;password:string;email_confirm:boolean;user_metadata:{full_name:string;login:string}})=>Promise<{id:string|null;error:ProviderError|null}>;
 registerLogin: (input:{user_id:string;login:string;created_by:string})=>Promise<ProviderError|null>;
 deleteUser: (id:string)=>Promise<ProviderError|null>;
}
export interface AccountPorts {
 currentUser:()=>Promise<string|null>;
 isOwner:(departmentId:string,userId:string)=>Promise<boolean>;
 admin:()=>AccountAdmin|null;
 addMember:(departmentId:string,userId:string,role:string)=>Promise<ProviderError|null>;
}
export interface AccountResult { status:number; body:{error?:string;login?:string;userId?:string} }
const result=(status:number,error:string):AccountResult=>({status,body:{error}});
export async function provisionManagedAccount(raw:unknown, ports:AccountPorts):Promise<AccountResult> {
 const userId=await ports.currentUser();if(!userId)return result(401,'Войдите в аккаунт');
 const parsed=createAccountSchema.safeParse(raw);if(!parsed.success)return result(400,parsed.error.issues[0].message);
 const input=parsed.data;
 if(!await ports.isOwner(input.departmentId,userId))return result(403,'Создавать пользователей может только владелец отдела');
 const admin=ports.admin();if(!admin)return result(503,'Создание пользователей не настроено. Администратору сервера нужно указать SUPABASE_SERVICE_ROLE_KEY');
 let createdId:string|null=null;
 async function rollback(message:string,status=500):Promise<AccountResult> {
  try {if(createdId&&await admin!.deleteUser(createdId))return result(500,'Не удалось завершить создание и удалить новый аккаунт. Проверьте Supabase Auth перед повторной попыткой');}
  catch{return result(500,'Не удалось завершить создание и удалить новый аккаунт. Проверьте Supabase Auth перед повторной попыткой');}
  return result(status,message);
 }
 try {
  const created=await admin.createUser({email:loginEmail(input.login),password:input.password,email_confirm:true,user_metadata:{full_name:input.fullName,login:input.login}});
  if(created.error||!created.id){
   if(['email_exists','user_already_exists'].includes(created.error?.code??''))return result(409,'Этот логин уже занят');
   if(created.error?.code==='weak_password')return result(400,'Пароль не соответствует настройкам безопасности Supabase');
   return result(502,'Не удалось создать пользователя в Supabase Auth');
  }
  createdId=created.id;
  const registry=await admin.registerLogin({user_id:createdId,login:input.login,created_by:userId});
  if(registry)return rollback(registry.code==='23505'?'Этот логин уже занят':'Не удалось сохранить логин. Проверьте миграцию 0011',registry.code==='23505'?409:500);
  // Use the actor's session and RLS, so revoked owner privileges cannot be bypassed by the service key.
  const membership=await ports.addMember(input.departmentId,createdId,input.role);
  if(membership)return rollback('Не удалось добавить пользователя в отдел. Проверьте права владельца');
  return {status:201,body:{login:input.login,userId:createdId}};
 }catch{return rollback('Создание пользователя прервано. Повторите попытку');}
}
