'use client';
import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Column } from './Board';
const FIELDS = 'id, name, position, is_done, color, wip_limit';
export default function ColumnSettings({ boardId, columns, onChange }: { boardId: string; columns: Column[]; onChange: (columns: Column[]) => void }) {
 const supabase = useMemo(() => createClient(), []);
 const [editing, setEditing] = useState<Column | null>(null);
 const [adding, setAdding] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const fresh = (): Column => ({id:'',name:'',position:columns.length,is_done:false,color:'#f1ae75',wip_limit:null});
 async function refresh() {
  const { data, error } = await supabase.from('columns').select(FIELDS).eq('board_id',boardId).order('position').order('id');
  if(error) throw error; onChange(data as Column[]);
 }
 async function save(e: React.FormEvent) {
  e.preventDefault(); if(!editing || busy) return;
  if(!editing.name.trim()) return setError('Введите название');
  setBusy(true);setError(null);
  try {
   const value = {name:editing.name.trim(),color:editing.color,is_done:editing.is_done,wip_limit:editing.wip_limit};
   const {error} = adding ? await supabase.from('columns').insert({...value,board_id:boardId,position:columns.length}) : await supabase.from('columns').update(value).eq('id',editing.id);
   if(error) throw error; await refresh();setEditing(null);
  } catch(e) {setError(e instanceof Error?e.message:String((e as {message?:string}).message ?? e));} finally {setBusy(false);}
 }
 async function reorder(index: number, delta: number) {
  if(busy || index+delta<0 || index+delta>=columns.length) return;
  setBusy(true);setError(null);
  const ids=columns.map(c=>c.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];
  try {const {error}=await supabase.rpc('reorder_columns',{b:boardId,ordered:ids});if(error)throw error;await refresh();}
  catch(e){setError((e as {message:string}).message);}finally{setBusy(false);}
 }
 async function remove(id:string) {
  if(!confirm('Удалить пустую колонку?'))return;setBusy(true);setError(null);
  try {const {error}=await supabase.rpc('delete_empty_column',{col:id});if(error)throw error;await refresh();}
  catch(e){setError((e as {message:string}).message);}finally{setBusy(false);}
 }
 return <details className="card mb-4"><summary className="cursor-pointer text-sm font-medium">Настроить колонки и лимиты задач</summary>
  <ul className="mt-3 space-y-2">{columns.map((c,i)=><li key={c.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="h-3 w-3 rounded-full" style={{background:c.color}}/><span className="mr-auto">{c.name}{c.is_done?' · завершено':''}{c.wip_limit?` · лимит ${c.wip_limit}`:''}</span><button className="btn" disabled={busy||i===0} onClick={()=>reorder(i,-1)} aria-label={`Передвинуть ${c.name} влево`}>←</button><button className="btn" disabled={busy||i===columns.length-1} onClick={()=>reorder(i,1)} aria-label={`Передвинуть ${c.name} вправо`}>→</button><button className="btn" disabled={busy} onClick={()=>{setEditing({...c});setAdding(false)}}>Изменить</button><button className="btn" disabled={busy} onClick={()=>remove(c.id)}>Удалить</button></li>)}</ul>
  <button className="btn mt-3" disabled={busy} onClick={()=>{setEditing(fresh());setAdding(true)}}>+ Колонка</button>
  {editing && <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-3" onSubmit={save}><label className="text-xs">Название<input className="input mt-1" required maxLength={60} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><label className="text-xs">Цвет<input type="color" className="mt-1 block h-10 w-14" value={editing.color} onChange={e=>setEditing({...editing,color:e.target.value})}/></label><label className="text-xs">Лимит (пусто — без лимита)<input type="number" className="input mt-1 w-32" min={1} max={999} value={editing.wip_limit??''} onChange={e=>setEditing({...editing,wip_limit:e.target.value?Number(e.target.value):null})}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_done} onChange={e=>setEditing({...editing,is_done:e.target.checked})}/>Завершённые задачи</label><button className="btn-solid" disabled={busy}>Сохранить</button><button type="button" className="btn" onClick={()=>setEditing(null)}>Отмена</button></form>}
  {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
 </details>;
}
