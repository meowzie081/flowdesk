import {afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {client}=vi.hoisted(()=>({client:vi.fn()}));
vi.mock('@supabase/ssr',()=>({createServerClient:client}));
import {middleware} from '@/middleware';
afterEach(()=>vi.clearAllMocks());
describe('native endpoints and existing authentication',()=>{
 it('allows webhook to verify its own secret without a browser session',async()=>{const result=await middleware(new NextRequest('https://flowdesk.example/api/telegram/webhook'));expect(result.status).toBe(200);expect(client).not.toHaveBeenCalled()});
 it('still requires an account for private application and administrative routes',async()=>{client.mockReturnValue({auth:{getUser:async()=>({data:{user:null}})}});for(const path of ['/d/dep/my-day','/api/admin/users','/api/telegram/webhook/other']){const result=await middleware(new NextRequest('https://flowdesk.example'+path));expect(result.status).toBe(307);expect(new URL(result.headers.get('location')!).pathname).toBe('/login')}});
});
