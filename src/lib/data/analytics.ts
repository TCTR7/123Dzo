import 'server-only';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

async function collect<T>(query:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>):Promise<T[]> {
  const rows:T[]=[];
  for(let page=0;page<200;page++){
    const {data,error}=await query(rows.length,rows.length+249);
    if(error||!data)throw new Error('KPI_UNAVAILABLE');
    if(!data.length)return rows;
    rows.push(...data);
  }
  throw new Error('KPI_RESULT_TOO_LARGE');
}

export async function readAdminAnalytics(range?: { p_start_date: string; p_end_date: string }) {
  const db = createSupabaseServiceRoleClient();
  const [financial,kitchen,menu,staff,peak]=await Promise.all([
    range?db.rpc('fn_get_financial_kpi',range):db.from('vw_kpi_financial_summary').select('*'),
    range?db.rpc('fn_get_kitchen_kpi',range):db.from('vw_kpi_kitchen_performance').select('*'),
    collect((from,to)=>(range?db.rpc('fn_get_menu_kpi',range):db.from('vw_kpi_menu_analytics').select('*')).order('menu_item_id').range(from,to)),
    collect((from,to)=>(range?db.rpc('fn_get_waitstaff_kpi',range):db.from('vw_kpi_waitstaff_performance').select('*')).order('staff_id').range(from,to)),
    range?db.rpc('fn_get_peak_hours_kpi',range):db.from('vw_kpi_peak_hours').select('*').order('hour_of_day'),
  ]);
  if([financial,kitchen,peak].some(result=>result.error||result.data===null)||!financial.data?.[0]||!kitchen.data?.[0])throw new Error('KPI_UNAVAILABLE');
  return {financial:financial.data[0],menu,kitchen:kitchen.data[0],staff,peak:peak.data!};
}
