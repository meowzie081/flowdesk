'use client';

import Link from 'next/link';
import Icon from './Icon';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Notice {
  id: string;
  department_id: string;
  task_id: string | null;
  message_id: string | null;
  kind: 'assigned' | 'comment' | 'mention' | 'reply' | 'help_request' | 'help_response';
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

const FIELDS = 'id, department_id, task_id, message_id, kind, title, body, read_at, created_at';

export default function NotificationBell({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [unread,setUnread] = useState(0);
  const [error,setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const [{data}, {count}] = await Promise.all([
        supabase.from('notifications').select(FIELDS).eq('user_id',userId).order('created_at',{ascending:false}).limit(20),
        supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).is('read_at',null),
      ]);
      if(alive){if(data)setItems(data as Notice[]);if(count!==null)setUnread(count);}
    }
    refresh();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},5000);

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => { refresh(); },
      )
      .subscribe();

    return () => {
      alive = false; clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  async function markAllRead() {
    const now = new Date().toISOString();
    const {error}=await supabase.from('notifications').update({read_at:now}).eq('user_id',userId).is('read_at',null);
    if(error)return setError(error.message);setError('');setUnread(0);setItems(prev=>prev.map(n=>({...n,read_at:n.read_at??now})));
  }

  return (
    <div className="relative">
      <button
        className="btn relative h-9 min-w-9 gap-1.5 px-2"
        onClick={() => setOpen((o) => !o)}
        aria-label="Уведомления"
        title="Уведомления"
      >
        <Icon name="bell" width={18} height={18}/>
        {unread > 0 && (
          <span className="ml-1 rounded-full bg-ink px-1.5 text-xs text-paper">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[90vw] rounded-lg border border-line bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-2 py-1">
            <span className="text-sm font-medium">Уведомления</span>
            {unread > 0 && (
              <button className="text-xs text-mute hover:text-ink" onClick={markAllRead}>
                Прочитать все
              </button>
            )}
          </div>
          {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
          {items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-mute">Пока ничего нет.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.message_id ? `/d/${n.department_id}/chat?message=${n.message_id}` : `/d/${n.department_id}/board${n.task_id ? `?task=${n.task_id}` : ''}`}
                    onClick={async () => { setOpen(false); const now=new Date().toISOString(); const {error}=await supabase.from('notifications').update({read_at:now}).eq('id',n.id);if(!error){setItems(prev=>prev.map(item=>item.id===n.id?{...item,read_at:now}:item));if(!n.read_at)setUnread(v=>Math.max(0,v-1));} }}
                    className={`block rounded px-2 py-2 text-sm hover:bg-neutral-100 ${
                      n.read_at ? 'text-mute' : ''
                    }`}
                  >
                    <span className="block text-xs text-mute">
                      {{assigned:'Вам назначена задача',comment:'Новый комментарий',mention:'Вас упомянули',reply:'Ответ в обсуждении',help_request:'Нужна ваша помощь',help_response:'Ответ на запрос помощи'}[n.kind]}
                    </span>
                    <span className="block font-medium">{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-mute">{n.body}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
