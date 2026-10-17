import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {previewType} from '@/lib/file-preview';
export async function GET(req:Request){const sb=createClient();const {data:{user}}=await sb.auth.getUser();if(!user)return NextResponse.json({error:'Войдите в аккаунт'},{status:401});
 const q=new URL(req.url).searchParams;const id=q.get('id');const source=q.get('source');let path:string|undefined;let bucket:string|undefined;
 if(source==='task'){const {data}=await sb.from('attachments').select('storage_path').eq('id',id).maybeSingle();if(data){path=data.storage_path;bucket='attachments'}}
 else if(source==='message'){const {data}=await sb.from('messages').select('files').eq('id',id).is('deleted_at',null).maybeSingle();if(data){const files=data.files as {path:string}[];path=files.find(f=>f.path===q.get('path'))?.path;bucket='chat-files'}}
 if(!path||!bucket)return NextResponse.json({error:'Файл недоступен'},{status:404});
 const {data,error}=await sb.storage.from(bucket).download(path);if(error||!data)return NextResponse.json({error:'Не удалось загрузить файл'},{status:404});
 if(data.size>10485760)return NextResponse.json({error:'Файл больше 10 МБ'},{status:413});
 const bytes=new Uint8Array(await data.arrayBuffer());const type=previewType(bytes);if(!type)return NextResponse.json({error:'Для этого формата доступно скачивание. Предпросмотр: PNG, JPEG, GIF, WebP и PDF'},{status:415});
 return new Response(bytes,{headers:{'Content-Type':type,'Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'"}});
}
