import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}})}));
vi.mock('@/lib/data/use-dine-in-snapshot',()=>({useDineInSnapshot:()=>({unavailable:false,expired:false})}));
import {DineInOrderView} from '@/components/customer/DineInOrderView';
import {useCartStore} from '@/lib/store/useCartStore';
import {sessionId,operationId,result,line} from './order_fixtures';
const session={id:sessionId,session_token:'test-capability',status:'ACTIVE' as const,payment_method:null};
const menu={id:line.menu_item_id,name:'Food',category:'FOOD' as const,station:'KITCHEN' as const,price:100,prep_time_minutes:10,image_url:null,is_available:true};
describe('Whole-table bill confirmation protects unsent cart',()=>{
 let root:Root,host:HTMLDivElement;const request=vi.fn();
 beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',request);request.mockReset();vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
  useCartStore.setState({items:[],sessionToken:session.session_token,acceptedOperationIds:[],submissionTimestamps:[]});
  useCartStore.getState().addItem({menu_item_id:menu.id,name:'Food',category:'FOOD',station:'KITCHEN',unit_price:100,image_url:null});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(createElement(DineInOrderView,{initialSession:session,table:null,zone:null,initialMenuItems:[menu],initialSessionOrders:result.items,initialQueuePositions:{}})));
 });
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
 const button=(text:string)=>{const node=[...host.querySelectorAll('button')].find(n=>n.textContent===text||n.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;};
 const open=async()=>{await act(async()=>button('Hóa đơn').click());await act(async()=>button('Bấm Gọi Tính Tiền').click());};
 const discard=async()=>{const checkbox=host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!;await act(async()=>checkbox.click());};
 it('opening and cancelling confirmation never submits or clears the cart',async()=>{
  await open();expect(request).not.toHaveBeenCalled();expect(button('Xác nhận gọi tính tiền').disabled).toBe(true);
  expect(host.querySelector('dialog')?.textContent).toContain('tạm dừng gọi thêm món');await act(async()=>host.querySelector<HTMLButtonElement>('dialog button[aria-label="Đóng"]')!.click());
  expect(useCartStore.getState().items).toHaveLength(1);expect(request).not.toHaveBeenCalled();
 });
 it('only clears unsent items after server confirms, with a single submit',async()=>{
  await open();await discard();let complete!:(response:Response)=>void;request.mockReturnValue(new Promise<Response>(resolve=>complete=resolve));
  act(()=>{button('Xác nhận gọi tính tiền').click();button('Xác nhận gọi tính tiền').click();});expect(request).toHaveBeenCalledOnce();expect(useCartStore.getState().items).toHaveLength(1);
  await act(async()=>complete(new Response(JSON.stringify({data:{action:'REQUEST_BILL',operationId,sessionId,tableId:null,status:'REQUEST_BILL',totalAmount:100}}))));
  expect(useCartStore.getState().items).toHaveLength(0);expect(host.textContent).toContain('Quán đã ghi nhận yêu cầu tính tiền');
 });
 it('a network failure preserves the cart and the operation for reconciliation',async()=>{
  request.mockRejectedValue(new Error('lost response'));await open();await discard();await act(async()=>button('Xác nhận gọi tính tiền').click());
  expect(useCartStore.getState().items).toHaveLength(1);expect(host.textContent).toContain('chưa xác nhận');expect(request).toHaveBeenCalledOnce();
 });
});
