import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {operationId,item} from './item_action_fixtures';
import {result as orderResult,menuId} from './order_fixtures';
import type {OrderItemRow,MenuItemRow,TableSessionRow} from '@/types/database.types';
const mocks=vi.hoisted(()=>({refresh:vi.fn(),from:vi.fn(),channel:vi.fn(),removeChannel:vi.fn()}));
const db={from:mocks.from,channel:mocks.channel,removeChannel:mocks.removeChannel};
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('@clerk/nextjs',()=>({UserButton:()=>null}));
vi.mock('@/lib/supabase/client',()=>({createSupabaseBrowserClient:()=>db}));
import {KitchenKdsBoard} from '@/components/kitchen/KitchenKdsBoard';
const row:OrderItemRow={...orderResult.items[0],unit_cost_price:40,served_by_staff_id:null,cancelled_by:null,stock_export_log_id:null};
const second={...row,id:'50000000-0000-4000-8000-000000000002',note:'extra chili'};
const menu:MenuItemRow={id:menuId,name:'Món kiểm thử',category:'FOOD',station:'KITCHEN',price:100,cost_price:40,prep_time_minutes:10,image_url:null,is_available:true,linked_ingredient_id:null};
const session:TableSessionRow={id:item.sessionId,session_token:'test-only-token',session_type:'DINE_IN',status:'ACTIVE',table_id:null,assigned_staff_id:null,customer_name:null,customer_phone:null,payment_method:null,payment_code:'TEST',total_amount:200,activated_at: null, opened_at:row.created_at,closed_at:null};
describe('KDS through production action journal',()=>{
  let container:HTMLDivElement,root:Root;
  const fetchMock=vi.fn();
  async function mount(rows:OrderItemRow[]=[row,second]){
    await act(async()=>root.render(createElement(KitchenKdsBoard,{initialKitchenOrders:rows,initialActiveSessions:[session],tables:[],initialMenuItems:[menu],currentStaffRole:'kitchen',currentStaffId:'user_kitchen'})));
  }
  function button(text:string){const control=[...container.querySelectorAll('button')].find((node)=>node.textContent?.includes(text));if(!control)throw new Error(`Missing ${text}`);return control;}
  function result(action:'START'|'READY',rows:OrderItemRow[]=[row,second]){return {operationId,action,batchId:action==='START'?'b0000000-0000-4000-8000-000000000001':null,items:rows.map((entry)=>({id:entry.id,sessionId:entry.session_id,fromStatus:action==='START'?'QUEUED':'COOKING',status:action==='START'?'COOKING':'READY'}))};}
  beforeEach(()=>{
    vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
    mocks.channel.mockImplementation(()=>{const channel={on:vi.fn(),subscribe:vi.fn()};channel.on.mockReturnValue(channel);channel.subscribe.mockReturnValue(channel);return channel;});
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
  it('double click starts one explicit full batch with no client timestamp or batch ID',async()=>{
    let resolve!:(value:Response)=>void;fetchMock.mockReturnValue(new Promise<Response>((done)=>{resolve=done;}));await mount();
    act(()=>{button('Nấu gộp cả').click();button('Nấu gộp cả').click();});expect(fetchMock).toHaveBeenCalledOnce();
    const body=JSON.parse(fetchMock.mock.calls[0][1].body);expect(body.action).toBe('START');expect(body.items).toHaveLength(2);expect(body).not.toHaveProperty('batchId');expect(body).not.toHaveProperty('cooking_started_at');
    await act(async()=>resolve(new Response(JSON.stringify({data:result('START')}))));expect(mocks.from).not.toHaveBeenCalled();expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('completion uses READY transaction and does not call push from the browser',async()=>{
    const cooking={...row,status:'COOKING' as const,cooking_started_at:row.created_at};fetchMock.mockResolvedValue(new Response(JSON.stringify({data:result('READY',[cooking])})));await mount([cooking]);
    await act(async()=>button('Hoàn thành •').click());expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][0]).toBe('/api/staff/item-actions');expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({action:'READY',items:[{id:row.id,expectedStatus:'COOKING'}]});expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps unknown batch frozen and recovers through GET without a second POST',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('lost'));await mount();await act(async()=>button('Nấu gộp cả').click());
    expect(button('Nấu gộp cả').disabled).toBe(true);expect(localStorage.getItem('123dzo-pending-item-action:user_kitchen')).not.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:result('START')})));await act(async()=>button('Kiểm tra thao tác món vừa gửi').click());
    expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();expect(localStorage.getItem('123dzo-pending-item-action:user_kitchen')).toBeNull();
  });
  it('86ing uses the narrow menu transaction and no direct browser update',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,action:'AVAILABILITY',menuItemId:menu.id}})));await mount();
    await act(async()=>button('Báo hết món nhanh').click());await act(async()=>button('Đang còn hàng').click());
    expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][0]).toBe('/api/staff/menu-actions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operationId,action:'AVAILABILITY',id:menu.id,item:{is_available:false},expected:{is_available:true}});
    expect(mocks.from).not.toHaveBeenCalled();expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('keeps recovery accessible inside the 86ing drawer and disables further toggles',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('lost'));await mount();await act(async()=>button('Báo hết món nhanh').click());await act(async()=>button('Đang còn hàng').click());
    expect(button('Đang còn hàng').disabled).toBe(true);
    const recoveries=[...container.querySelectorAll('button')].filter(node=>node.textContent?.includes('Kiểm tra thay đổi thực đơn vừa gửi'));
    expect(recoveries).toHaveLength(2);fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{operationId,action:'AVAILABILITY',menuItemId:menu.id}})));
    await act(async()=>recoveries[1].click());expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
  });
});
