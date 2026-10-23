// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({client:vi.fn(),rpc:vi.fn(),from:vi.fn(),ranges:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:m.client}));
import {readAdminAnalytics} from '@/lib/data/analytics';
describe('Admin aggregate reader respects Data API row caps',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  function source(name:string){
   const data=name.includes('financial')?[{gross_revenue:123}]:name.includes('kitchen')?[{total_cooked_items:0}]:[{hour_of_day:12}];
   const builder={select:()=>builder,order:()=>builder,range:(from:number,to:number)=>{m.ranges(name,from,to);return Promise.resolve({data:from<3?[{id:from}]:[],error:null});},then:<T>(resolve:(value:{data:typeof data;error:null})=>T)=>Promise.resolve(resolve({data,error:null}))};
   return builder;
  }
  m.from.mockImplementation(source);m.rpc.mockImplementation(source);m.client.mockReturnValue({from:m.from,rpc:m.rpc});
 });
 it('continues after short pages until empty, for menu and staff',async()=>{
  const data=await readAdminAnalytics();expect(data.menu).toHaveLength(3);expect(data.staff).toHaveLength(3);
  expect(m.ranges).toHaveBeenCalledWith('vw_kpi_menu_analytics',1,250);expect(m.ranges).toHaveBeenCalledWith('vw_kpi_waitstaff_performance',3,252);expect(data.peak).toEqual([{hour_of_day:12}]);
 });
 it('filtered reader queries all five SQL RPCs, never raw order rows',async()=>{
  const range={p_start_date:'2026-10-21T17:00:00Z',p_end_date:'2026-10-22T17:00:00Z'};await readAdminAnalytics(range);
  for(const name of ['financial','menu','kitchen','waitstaff','peak_hours'])expect(m.rpc).toHaveBeenCalledWith(`fn_get_${name}_kpi`,range);expect(m.from).not.toHaveBeenCalled();
 });
});
