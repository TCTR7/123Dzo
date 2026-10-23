import {act,createElement,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('recharts',()=>{
 const Box=({children}:{children?:ReactNode})=>createElement('div',null,children);
 return {ResponsiveContainer:Box,BarChart:({data}:{data:unknown})=>createElement('pre',null,JSON.stringify(data)),Bar:Box,PieChart:Box,Pie:Box,Cell:()=>null,XAxis:()=>null,YAxis:()=>null,CartesianGrid:()=>null,Tooltip:()=>null,Legend:()=>null};
});
import {AdminKpiDashboard} from '@/components/admin/AdminKpiDashboard';
const financial={gross_revenue:0,cash_revenue:0,vietqr_revenue:0,dine_in_revenue:0,takeaway_revenue:0,closed_sessions_count:0,total_cogs:0,total_wastage_cost:0,net_profit:0};
const kitchen={total_cooked_items:0,batch_cooked_items:0,avg_queue_wait_minutes:0,avg_actual_cook_minutes:0,avg_standard_prep_minutes:0,cook_time_evaluation:'NO_DATA' as const,batch_cooking_efficiency_pct:0,slow_cancelled_count:0};
describe('Dashboard updates every projection and preserves last valid data',()=>{
 let root:Root,host:HTMLDivElement;const fetchMock=vi.fn();
 beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(createElement(AdminKpiDashboard,{initialFinancial:financial,initialPeakHours:[],initialMenuAnalytics:[],initialKitchenKpi:kitchen,initialWaitstaffKpi:[]})));
 });
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
 const click=async()=>{const button=[...host.querySelectorAll('button')].find(node=>node.textContent?.includes('Hôm nay'));expect(button).toBeDefined();await act(async()=>button!.click());};
 it('updates peak-hours too and does not praise an empty kitchen',async()=>{
  expect(host.textContent).toContain('Chưa có dữ liệu nấu');
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{financial,menu:[],kitchen,staff:[],peak:[{hour_of_day:15,total_orders_count:7,total_items_quantity:11,total_order_value:900}]}})));
  await click();expect(host.textContent).toContain('15:00');expect(host.textContent).toContain('"totalItems":11');expect(host.textContent).toContain('Cập nhật:');
  const url=new URL(fetchMock.mock.calls[0][0],'http://fixture');expect(new Date(url.searchParams.get('start')!).getUTCHours()).toBe(17);
 });
 it('keeps last valid charts and shows a subsequent query failure',async()=>{
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{financial,menu:[],kitchen,staff:[],peak:[{hour_of_day:12,total_orders_count:1,total_items_quantity:2,total_order_value:100}]}})));
  await click();fetchMock.mockRejectedValueOnce(new Error('database down'));await click();expect(host.textContent).toContain('12:00');expect(host.querySelector('[role=alert]')?.textContent).toContain('chưa được cập nhật');
 });
});
