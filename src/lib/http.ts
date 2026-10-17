/** Check the browser-facing authority. Next's request URL may use the container host.
 * Reverse proxies must preserve Host and overwrite X-Forwarded-Proto.
 * Never authorize a different host using client-supplied X-Forwarded-Host.
 */
export function sameOrigin(request:Request) {
 const value=request.headers.get('origin');
 if(!value||request.headers.get('sec-fetch-site')==='cross-site')return false;
 try {
  const origin=new URL(value),internal=new URL(request.url);
  if(!['http:','https:'].includes(origin.protocol)||value!==origin.origin)return false;
  const host=request.headers.get('host')??internal.host;
  if(!host||/[\s,\\/@?#]/.test(host))return false;
  const forwarded=request.headers.get('x-forwarded-proto');
  if(forwarded&&forwarded!=='http'&&forwarded!=='https')return false;
  const protocol=forwarded?`${forwarded}:`:internal.protocol;
  return origin.origin===new URL(`${protocol}//${host}`).origin;
 }catch{return false;}
}
export async function postJSON(url:string,body:unknown) {
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(response.redirected)throw new Error('Сессия истекла. Войдите снова');
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error??'Не удалось выполнить запрос');return data;
}
