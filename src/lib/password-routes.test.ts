import {describe,it,expect,vi,beforeEach} from 'vitest';
const f=vi.hoisted(()=>({session:{auth:{getUser:vi.fn(),signOut:vi.fn()},rpc:vi.fn()},isolated:{auth:{signInWithPassword:vi.fn(),updateUser:vi.fn(),signOut:vi.fn()}},admin:{auth:{admin:{updateUserById:vi.fn()}},rpc:vi.fn()},configured:true}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>f.session}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>f.configured?f.admin:null}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>f.isolated}));
import {POST as change} from '../app/api/account/password/route';
import {POST as reset} from '../app/api/admin/reset-password/route';
const uid='00000000-0000-4000-8000-000000000001';const dep='00000000-0000-4000-8000-000000000010';
const request=(body:unknown,origin='https://flowdesk.test')=>new Request('https://flowdesk.test/api',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();f.configured=true;f.session.auth.getUser.mockResolvedValue({data:{user:{id:uid,email:'member@users.flowdesk.invalid'}}});f.session.auth.signOut.mockResolvedValue({error:null});f.session.rpc.mockResolvedValue({data:'audit-id',error:null});f.isolated.auth.signInWithPassword.mockResolvedValue({data:{user:{id:uid}},error:null});f.isolated.auth.updateUser.mockResolvedValue({error:null});f.isolated.auth.signOut.mockResolvedValue({error:null});f.admin.auth.admin.updateUserById.mockResolvedValue({error:null});f.admin.rpc.mockResolvedValue({error:null})});
describe('self password change',()=>{
 const body={currentPassword:'old password',password:'new password 123'};
 it('rejects another origin before reading the session',async()=>{expect((await change(request(body,'https://evil.test'))).status).toBe(403);expect(f.session.auth.getUser).not.toHaveBeenCalled()});
 it('requires authentication',async()=>{f.session.auth.getUser.mockResolvedValue({data:{user:null}});expect((await change(request(body))).status).toBe(401)});
 it('checks the current password without changing the application session',async()=>{f.isolated.auth.signInWithPassword.mockResolvedValue({data:{user:null},error:{message:'bad'}});expect((await change(request(body))).status).toBe(400);expect(f.isolated.auth.updateUser).not.toHaveBeenCalled();expect(f.session.auth.signOut).not.toHaveBeenCalled()});
 it('never changes another user even if Auth returns a different ID',async()=>{f.isolated.auth.signInWithPassword.mockResolvedValue({data:{user:{id:'other'}},error:null});expect((await change(request(body))).status).toBe(400);expect(f.isolated.auth.updateUser).not.toHaveBeenCalled()});
 it('uses a fresh verified session and clears it afterwards',async()=>{const result=await change(request(body));expect(result.status).toBe(200);expect(f.isolated.auth.updateUser).toHaveBeenCalledWith({password:body.password});expect(f.isolated.auth.signOut).toHaveBeenCalledWith({scope:'local'});expect(f.session.auth.signOut).toHaveBeenCalledWith({scope:'local'});expect(JSON.stringify(await result.json())).not.toContain(body.password)});
 it('does not sign out the user when Auth refuses the new password',async()=>{f.isolated.auth.updateUser.mockResolvedValue({error:{message:'weak'}});expect((await change(request(body))).status).toBe(400);expect(f.session.auth.signOut).not.toHaveBeenCalled()});
});
describe('administrator password reset',()=>{
 const body={departmentId:dep,userId:uid,password:'new admin password'};
 it('rejects forbidden origins',async()=>{expect((await reset(request(body,'https://evil.test'))).status).toBe(403)});
 it('does not call Auth without database authorization',async()=>{f.session.rpc.mockResolvedValue({data:null,error:{message:'forbidden'}});expect((await reset(request(body))).status).toBe(403);expect(f.admin.auth.admin.updateUserById).not.toHaveBeenCalled()});
 it('requires the server key',async()=>{f.configured=false;expect((await reset(request(body))).status).toBe(503)});
 it('records the attempt before changing a password and stores no secret in audit',async()=>{const response=await reset(request(body));expect(response.status).toBe(200);expect(f.session.rpc).toHaveBeenCalledWith('begin_password_reset',{dep,target:uid});expect(f.session.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.admin.auth.admin.updateUserById.mock.invocationCallOrder[0]);expect(f.admin.rpc).toHaveBeenCalledWith('finish_password_reset',{event:'audit-id',success:true});expect(JSON.stringify(f.admin.rpc.mock.calls)).not.toContain(body.password);expect(JSON.stringify(await response.json())).not.toContain(body.password)});
 it('records provider failures without claiming success',async()=>{f.admin.auth.admin.updateUserById.mockResolvedValue({error:{message:'failed'}});expect((await reset(request(body))).status).toBe(502);expect(f.admin.rpc).toHaveBeenCalledWith('finish_password_reset',{event:'audit-id',success:false})});
 it('reports an audit finalization failure after a successful reset',async()=>{f.admin.rpc.mockResolvedValue({error:{message:'offline'}});const result=await reset(request(body));expect(result.status).toBe(200);expect((await result.json()).warning).toBeTruthy()});
});
