import {describe,it,expect} from 'vitest';
import {sameOrigin} from './http';
const req=(origin:string|undefined,host?:string,extra:Record<string,string>={})=>new Request('http://0.0.0.0:3000/api/admin/users',{method:'POST',headers:{...(origin?{origin}:{}),...(host?{host}:{}),...extra}});
describe('browser-facing origin behind Docker and reverse proxy',()=>{
 it('accepts localhost and LAN addresses despite the internal container URL',()=>{for(const host of ['localhost:3000','127.0.0.1:3000','192.168.1.25:3000','[::1]:3000'])expect(sameOrigin(req(`http://${host}`,host))).toBe(true)});
 it('accepts HTTPS terminated by a proxy which preserves Host',()=>{expect(sameOrigin(req('https://flowdesk.example','flowdesk.example',{'x-forwarded-proto':'https'}))).toBe(true)});
 it('rejects other hosts, ports and schemes',()=>{for(const origin of ['https://evil.example','http://localhost:3001','https://localhost:3000'])expect(sameOrigin(req(origin,'localhost:3000'))).toBe(false)});
 it('rejects missing, opaque, malformed and non-origin values',()=>{for(const origin of [undefined,'null','invalid','http://localhost:3000/path','http://localhost:3000/','http://user:password@localhost:3000'])expect(sameOrigin(req(origin,'localhost:3000'))).toBe(false)});
 it('does not trust a forwarded host to authorize another origin',()=>{expect(sameOrigin(req('https://evil.example','flowdesk.example',{'x-forwarded-host':'evil.example','x-forwarded-proto':'https'}))).toBe(false)});
 it('rejects malformed proxy protocol, Host and cross-site requests',()=>{expect(sameOrigin(req('http://localhost:3000','localhost:3000',{'sec-fetch-site':'cross-site'}))).toBe(false);expect(sameOrigin(req('http://localhost:3000','localhost:3000',{'x-forwarded-proto':'https,http'}))).toBe(false);expect(sameOrigin(req('http://localhost:3000','localhost:3000/path'))).toBe(false)});
 it('normalizes default ports and falls back to URL in native test requests',()=>{expect(sameOrigin(req('https://flowdesk.example','flowdesk.example:443',{'x-forwarded-proto':'https'}))).toBe(true);expect(sameOrigin(new Request('https://flowdesk.test/api',{headers:{origin:'https://flowdesk.test'}}))).toBe(true)});
});
