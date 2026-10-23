import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {MenuItemRow,TableSessionRow} from '@/types/database.types';
import type {SessionBill} from '@/lib/sessions/bill-contract';
import {result as order,menuId} from './order_fixtures';
import {operationId,sessionId,tableId} from './session_action_fixtures';
const mocks=vi.hoisted(()=>({refresh:vi.fn(),push:vi.fn(),bill:vi.fn(),run:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh,push:mocks.push})}));
vi.mock('@/lib/data/use-server-refresh',()=>({useServerRefresh:()=>{}}));
vi.mock('@/lib/data/use-snapshot-sound',()=>({useSnapshotSound:()=>{}}));
vi.mock('@/components/ui/SoundControls',()=>({SoundControls:()=>null}));
vi.mock('@/lib/sessions/use-session-bill',()=>({useSessionBill:mocks.bill}));
vi.mock('@/lib/item-actions/use-item-actions',()=>({useItemActions:()=>({run:mocks.run,pending:null,busy:false,blocked:false,error:null})}));
import {BillsManager} from '@/components/admin/BillsManager';
const session:TableSessionRow={id:sessionId,session_token:'fixture-capability',session_type:'DINE_IN',status:'REQUEST_BILL',table_id:tableId,assigned_staff_id:'user_staff',customer_name:null,customer_phone:null,payment_method:'CASH',payment_code:null,total_amount:100,activated_at:null,opened_at:'2026-10-22T01:00:00Z',closed_at:null};
const menu:MenuItemRow={id:menuId,name:'Món fixture',category:'FOOD',station:'KITCHEN',price:999,cost_price:40,prep_time_minutes:10,image_url:null,is_available:true,linked_ingredient_id:null};
const served={...order.items[0],status:'SERVED' as const};
const bill:SessionBill={sessionId,status:'REQUEST_BILL',totalAmount:100,closedAt:null,items:[served]};
const props={initialSessions:[session],initialOrderItems:[served],tables:[],menuItems:[menu],staffProfiles:[],currentAdminId:'user_admin'};
const closed={operationId,action:'CLOSE',sessionId,tableId,status:'CLOSED',totalAmount:100};
describe('Cashier complete bill, payment confirmation and recovery',()=>{
 let host:HTMLDivElement,root:Root;const fetchMock=vi.fn();
 beforeEach(()=>{vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);vi.spyOn(window,'print').mockImplementation(()=>{});
  mocks.bill.mockReturnValue({data:bill,loading:false,error:null});mocks.run.mockResolvedValue(true);host=document.createElement('div');document.body.append(host);root=createRoot(host);
 });
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 const render=async(overrides:Partial<Parameters<typeof BillsManager>[0]>={})=>act(async()=>root.render(createElement(BillsManager,{...props,...overrides})));
 function button(text:string){const node=[...host.querySelectorAll('button')].find(row=>row.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;}
 const click=async(text:string)=>act(async()=>button(text).click());
 const check=async()=>act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
 it('does not close without actual payment confirmation and prints snapshot prices',async()=>{
  await render();await click('Xác nhận thu tiền');expect(fetchMock).not.toHaveBeenCalled();expect(host.textContent).toContain('Hãy xác nhận');
  expect(host.querySelector('#k80-thermal-receipt')?.textContent).not.toContain('999');
 });
 it('locks double close, uses the full server total, acknowledges then refreshes',async()=>{
  let done!:(response:Response)=>void;fetchMock.mockReturnValue(new Promise<Response>(resolve=>{done=resolve;}));
  await render();await check();await act(async()=>{button('Xác nhận thu tiền').click();button('Xác nhận thu tiền').click();});
  expect(fetchMock).toHaveBeenCalledOnce();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({operationId,action:'CLOSE',input:{sessionId,expectedTotal:100,confirmedReceived:true}});
  await act(async()=>done(new Response(JSON.stringify({data:closed}))));expect(mocks.refresh).toHaveBeenCalledOnce();expect(localStorage.getItem('123dzo-pending-session:staff:user_admin')).toBeNull();
 });
 it('requires fresh confirmation after the server rejects a changed bill',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'BILL_CHANGED',message:'Review new total',totalAmount:200}}),{status:409}));
  await render();await check();await click('Xác nhận thu tiền');expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  await click('Xác nhận thu tiền');expect(fetchMock).toHaveBeenCalledOnce();expect(host.textContent).toContain('200');
 });
 it.each([{data:null,loading:true,error:null},{data:null,loading:false,error:'Không tải đủ'}])('blocks close and print when complete detail is unavailable',async state=>{
  mocks.bill.mockReturnValue(state);await render();await check();await click('Xác nhận thu tiền');expect(fetchMock).not.toHaveBeenCalled();expect(window.print).not.toHaveBeenCalled();expect(host.textContent).toContain('Chưa tải đủ món');
 });
 it('prints a closed bill only when all item amounts match the stored total',async()=>{
  const closedSession={...session,status:'CLOSED' as const,closed_at:'2026-10-22T02:00:00Z'};
  mocks.bill.mockReturnValue({data:{...bill,status:'CLOSED',closedAt:closedSession.closed_at},loading:false,error:null});
  await render({initialSessions:[closedSession],listStatus:'CLOSED'});await click('In lại');expect(window.print).toHaveBeenCalledOnce();expect(fetchMock).not.toHaveBeenCalled();
  mocks.bill.mockReturnValue({data:{...bill,status:'CLOSED',closedAt:closedSession.closed_at,totalAmount:200},loading:false,error:null});
  await render({initialSessions:[{...closedSession,total_amount:200}],listStatus:'CLOSED'});await click('In lại');expect(window.print).toHaveBeenCalledOnce();
 });
 it('admin cancelling a prepared item must supply a reason and exact expected state',async()=>{
  await render();await act(async()=>host.querySelector<HTMLButtonElement>('button[title^="Admin hủy món"]')!.click());
  const submit=()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await act(async()=>submit());expect(mocks.run).not.toHaveBeenCalled();
  const input=host.querySelector<HTMLInputElement>('input[maxlength="500"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Khách báo món không đạt');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>submit());expect(mocks.run).toHaveBeenCalledWith({action:'CANCEL',reason:'Khách báo món không đạt',items:[{id:served.id,sessionId,expectedStatus:'SERVED',expectedQuantity:served.quantity}]});
 });
 it('recovers an uncertain close through GET without issuing a second payment action',async()=>{
  localStorage.setItem('123dzo-pending-session:staff:user_admin',JSON.stringify({operationId,action:'CLOSE',input:{sessionId,paymentMethod:'CASH',expectedTotal:100,confirmedReceived:true}}));
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:closed})));await render();expect(button('Xác nhận thu tiền').disabled).toBe(true);
  await click('Kiểm tra thao tác bàn vừa gửi');expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][1].method).toBeUndefined();expect(mocks.refresh).toHaveBeenCalledOnce();
 });
 it('invalidates payment confirmation when a refreshed bill has a new amount',async()=>{
  await render();await check();expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  mocks.bill.mockReturnValue({data:{...bill,totalAmount:200,items:[{...served,quantity:2}]},loading:false,error:null});await render();
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);await click('Xác nhận thu tiền');expect(fetchMock).not.toHaveBeenCalled();
 });
 it('never prints invented store contact information',async()=>{
  vi.stubEnv('NEXT_PUBLIC_STORE_INFO_VERIFIED','false');await render();expect(host.querySelector('#k80-thermal-receipt')?.textContent).not.toContain('0909.123.456');
 });
 it('prints only configured and verified contact details',async()=>{
  vi.stubEnv('NEXT_PUBLIC_STORE_NAME','Quán fixture');vi.stubEnv('NEXT_PUBLIC_STORE_ADDRESS','Địa chỉ fixture');vi.stubEnv('NEXT_PUBLIC_STORE_PHONE','0912345678');vi.stubEnv('NEXT_PUBLIC_STORE_HOURS','17:00–23:00');vi.stubEnv('NEXT_PUBLIC_STORE_INFO_VERIFIED','true');
  await render();expect(host.querySelector('#k80-thermal-receipt')?.textContent).toContain('Quán fixtureĐịa chỉ fixture • 0912345678');
 });
 it('requires a new received-payment confirmation after changing payment method',async()=>{
  await render();await check();await click('VietQR');expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);await click('Xác nhận thu tiền');expect(fetchMock).not.toHaveBeenCalled();
 });
 it('uses server pagination when changing the history tab',async()=>{
  await render({remoteList:true});await click('Lịch sử đã đóng');expect(mocks.push).toHaveBeenCalledWith('/admin/bills?status=CLOSED');
 });
});
