import {afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {client}=vi.hoisted(()=>({client:vi.fn()}));
vi.mock('@supabase/ssr',()=>({createServerClient:client}));
import {middleware} from '@/middleware';
afterEach(()=>vi.clearAllMocks());
describe('native endpoints and existing authentication',()=>{
 it('allows webhook to verify its own secret without a browser session',async()=>{const result=await middleware(new NextRequest('https://flowdesk.example/api/telegram/webhook'));expect(result.status).toBe(200);expect(client).not.toHaveBeenCalled()});
 it('allows only the exact dispatch route to use its own bearer authentication',async()=>{const result=await middleware(new NextRequest('https://flowdesk.example/api/notifications/dispatch'));expect(result.status).toBe(200);expect(client).not.toHaveBeenCalled()});
 it('still requires an account for private application and administrative routes',async()=>{client.mockReturnValue({auth:{getUser:async()=>({data:{user:null}})}});for(const path of ['/d/dep/my-day','/api/admin/users','/api/telegram/webhook/other']){const result=await middleware(new NextRequest('https://flowdesk.example'+path));if(path.startsWith('/api/'))expect(result.status).toBe(401);else {expect(result.status).toBe(307);expect(new URL(result.headers.get('location')!).pathname).toBe('/login')}}});
});
