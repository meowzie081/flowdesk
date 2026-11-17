'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from './I18nProvider';
export default function UnreadBadge({ depId }: { depId: string }) {
 const { t } = useI18n();
 const supabase = useMemo(() => createClient(), []);
 const [count, setCount] = useState(0);
 useEffect(() => {
  let alive = true;
  async function refresh() { const { data } = await supabase.rpc('chat_unread', { dep: depId }); if (alive && data) setCount(Number(data.count)); }
  refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5000);
  window.addEventListener('chat-read', refresh); window.addEventListener('focus', refresh);
  return () => { alive = false; clearInterval(timer); window.removeEventListener('chat-read', refresh); window.removeEventListener('focus', refresh); };
 }, [supabase, depId]);
 return count > 0 ? <span aria-label={t('bell.unreadMessages', { count })} className="ml-1 rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px]" style={{color:'#fff'}}>{count > 99 ? '99+' : count}</span> : null;
}
