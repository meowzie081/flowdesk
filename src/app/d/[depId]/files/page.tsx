import { createClient } from '@/lib/supabase/server';
import { lookFromRow } from '@/lib/profile';
import DepartmentFiles from '@/components/DepartmentFiles';
export default async function FilesPage({params}:{params:{depId:string}}) {
 const supabase=createClient();const {data}=await supabase.from('department_members').select('user_id, profiles(full_name, avatar_icon, name_color)').eq('department_id',params.depId);
 const people:Record<string,string>={};for(const m of data??[])people[m.user_id]=lookFromRow(m.profiles,m.user_id.slice(0,8)).name;
 return <DepartmentFiles depId={params.depId} people={people}/>;
}
