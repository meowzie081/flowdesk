import MyDay from '@/components/MyDay';
import { createClient } from '@/lib/supabase/server';
export default async function Page({ params }: {
    params: {
        depId: string;
    };
}) {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const { data: membership } = await sb.from('department_members').select('role,blocked_at').eq('department_id', params.depId).eq('user_id', user!.id).maybeSingle();
    return <MyDay depId={params.depId} userId={user!.id} role={membership?.blocked_at ? 'viewer' : membership?.role ?? 'viewer'}/>;
}
