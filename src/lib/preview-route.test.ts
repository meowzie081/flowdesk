import {describe,it,expect,vi,beforeEach} from 'vitest';
const f=vi.hoisted(()=>({getUser:vi.fn(),maybeSingle:vi.fn(),download:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>({auth:{getUser:f.getUser},from:()=>{const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:f.maybeSingle};return q},storage:{from:()=>({download:f.download})}})}));
import {GET} from '../app/api/files/preview/route';
beforeEach(()=>{vi.resetAllMocks();f.getUser.mockResolvedValue({data:{user:{id:'me'}}});f.maybeSingle.mockResolvedValue({data:{files:[{path:'dep/me/file.pdf'}]}});f.download.mockResolvedValue({data:new Blob(['%PDF-1.7\n']),error:null})});
describe('private file preview',()=>{
 it('requires authentication',async()=>{f.getUser.mockResolvedValue({data:{user:null}});expect((await GET(new Request('https://test/api?source=message&id=m&path=dep/me/file.pdf'))).status).toBe(401);expect(f.download).not.toHaveBeenCalled()});
 it('never downloads a path absent from the authorized message',async()=>{expect((await GET(new Request('https://test/api?source=message&id=m&path=other/file.pdf'))).status).toBe(404);expect(f.download).not.toHaveBeenCalled()});
 it('rejects inaccessible attachment records before Storage access',async()=>{f.maybeSingle.mockResolvedValue({data:null});expect((await GET(new Request('https://test/api?source=task&id=foreign'))).status).toBe(404);expect(f.download).not.toHaveBeenCalled()});
 it('returns sniffed PDF with private/no-store headers',async()=>{const response=await GET(new Request('https://test/api?source=message&id=m&path=dep/me/file.pdf'));expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('application/pdf');expect(response.headers.get('Cache-Control')).toContain('no-store');expect(f.download).toHaveBeenCalledWith('dep/me/file.pdf')});
 it('rejects renamed HTML and SVG regardless of declared MIME',async()=>{f.download.mockResolvedValue({data:new Blob(['<svg onload=alert(1)>'],{type:'application/pdf'}),error:null});expect((await GET(new Request('https://test/api?source=message&id=m&path=dep/me/file.pdf'))).status).toBe(415)});
});
