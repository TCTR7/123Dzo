import 'server-only';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { readAll } from './lists';
export async function readPublicMenu() {
 const db=createSupabaseServiceRoleClient();
 const {data}=await readAll(after=>{
  const query=db.from('menu_items').select('id,name,category,station,price,prep_time_minutes,image_url,is_available').order('id',{ascending:true}).limit(250);
  return after?query.gt('id',after):query;
 });
 return data.sort((a,b)=>a.name.localeCompare(b.name,'vi'));
}
