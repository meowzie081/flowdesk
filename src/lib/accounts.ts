import { z } from 'zod';
export const LOGIN_DOMAIN = 'users.flowdesk.invalid';
export const loginSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, 'Логин: 3–32 латинские буквы, цифры, точки, дефисы или подчёркивания').refine(v=>!v.endsWith('.')&&!v.includes('..'),'Логин не должен оканчиваться точкой или содержать две точки подряд');
export const createAccountSchema = z.object({
 departmentId: z.string().uuid(),
 fullName: z.string().trim().min(1,'Введите имя').max(100,'Имя не длиннее 100 символов'),
 login: loginSchema,
 password: z.string().min(8,'Пароль — минимум 8 символов').max(128,'Пароль не длиннее 128 символов'),
 role: z.enum(['member','viewer','owner']).default('member'),
});
export function loginEmail(login:string) {return `${loginSchema.parse(login)}@${LOGIN_DOMAIN}`;}
export function signInEmail(identity:string) {
 const value=identity.trim().toLowerCase();
 if(value.includes('@')) return z.string().email('Введите email или корректный логин').parse(value);
 return loginEmail(value);
}
export function isManagedEmail(email:string) {return email.trim().toLowerCase().endsWith(`@${LOGIN_DOMAIN}`);}

export function accountLabel(email:string|null|undefined) {return email&&isManagedEmail(email)?`Логин: ${email.split('@')[0]}`:email??'Вы вошли';}
