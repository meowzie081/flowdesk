import TaskExplorer from '@/components/TaskExplorer';
import {createClient} from '@/lib/supabase/server';
export default async function Page({params}:{params:{depId:string}}){const sb=createClient();const {data:{user}}=await sb.auth.getUser();return <TaskExplorer depId={params.depId} userId={user!.id} mode='calendar'/>}
