import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {command,result,token,snapshot,journal,operationId} from './takeaway_fixtures';
import {useTakeawayCartStore} from '@/lib/store/useCartStore';
import {takeawaySettings} from '@/lib/takeaway/config';
vi.mock('next/link',()=>({default:({children,...props}:{children:unknown})=>createElement('a',props,children as string)}));
vi.mock('server-only',()=>({}));
const navigation=vi.hoisted(()=>({refresh:vi.fn()}));vi.mock('next/navigation',()=>({useRouter:()=>navigation}));
import {TakeawayFlow} from '@/components/customer/TakeawayFlow';
import {PaymentInstructions} from '@/components/customer/PaymentInstructions';
const store={name:'Nhỏ Út',address:'Điện Bàn Bắc – Đà Nẵng',phone:'0905729459',hours:'10:00–23:30',verified:true};
const settings={enabled:true,bank:{bankId:'970407',accountNo:'1234567890',accountName:'FIXTURE ONLY'}};
const menu={id:command.lines[0].menu_item_id,name:'Food',category:'FOOD' as const,station:'KITCHEN' as const,price:100,prep_time_minutes:10,image_url:null,is_available:true};
describe('Customer manual takeaway actual UI',()=>{
 let host:HTMLDivElement,root:Root;const fetchMock=vi.fn();
 beforeEach(()=>{vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);useTakeawayCartStore.setState({items:[],acceptedOperationIds:[],sessionToken:null});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 const render=async()=>act(async()=>root.render(createElement(TakeawayFlow,{menu:[menu],store,settings})));
 function button(text:string){const node=[...host.querySelectorAll('button')].find(row=>row.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;}
 const click=async(text:string)=>act(async()=>button(text).click());
 const fill=async(node:HTMLInputElement,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});
 async function review(){await render();await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Thêm Food"]')!.click());await click('Xem giỏ mang về');await click('Xem lại và thông tin nhận');
  const fields=host.querySelectorAll<HTMLInputElement>('dialog input');await fill(fields[0],command.customerName);await fill(fields[1],command.customerPhone);await click('Tiếp tục xác nhận đơn');}
 it('never posts before explicit final confirmation, then accepts once and reads server state',async()=>{
  let complete!:(response:Response)=>void;fetchMock.mockImplementation((url:string,init:RequestInit)=>init.method==='POST'?new Promise<Response>(resolve=>{complete=resolve;}):Promise.resolve(new Response(JSON.stringify({data:snapshot}))));
  await review();expect(fetchMock).not.toHaveBeenCalled();expect(useTakeawayCartStore.getState().items).toHaveLength(1);
  await act(async()=>{button('Xác nhận gửi đơn mang về').click();button('Xác nhận gửi đơn mang về').click();});expect(fetchMock).toHaveBeenCalledOnce();expect(useTakeawayCartStore.getState().items).toHaveLength(1);
  await act(async()=>complete(new Response(JSON.stringify({data:result}))));expect(useTakeawayCartStore.getState().items).toHaveLength(0);expect(host.textContent).toContain('Chờ xác nhận thanh toán');expect(host.textContent).toContain('Sao chép số tài khoản');expect(host.textContent).not.toContain('Original staff');expect(host.querySelectorAll('main')).toHaveLength(1);
 });
 it('retains cart and identity after response loss and explicitly recovers without another POST',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('response lost'));await review();await click('Xác nhận gửi đơn mang về');expect(useTakeawayCartStore.getState().items).toHaveLength(1);expect(host.textContent).toContain('Chưa xác nhận');
  await act(async()=>host.querySelector<HTMLButtonElement>('dialog button[aria-label=Đóng]')!.click());
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:result}))).mockResolvedValue(new Response(JSON.stringify({data:snapshot})));
  await click('Kiểm tra lượt đặt mang về vừa gửi');expect(fetchMock.mock.calls.filter(call=>call[1].method==='POST')).toHaveLength(1);expect(useTakeawayCartStore.getState().items).toHaveLength(0);
 });
 it('stored capability reopens current server state, never trusts a local paid flag',async()=>{
  localStorage.setItem('123dzo-takeaway-capabilities-v1',JSON.stringify([token]));fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{...snapshot,status:'ACTIVE',activatedAt:result.openedAt,items:[{...snapshot.items[0],status:'COOKING'}]}})));
  await render();await click('Mở đơn đã lưu');expect(host.textContent).toContain('Quán đang chuẩn bị đơn');expect(host.textContent).not.toContain('Sao chép số tài khoản');expect(fetchMock.mock.calls[0][1].headers['x-takeaway-token']).toBe(token);
 });
 it('a local removal requires confirmation and does not cancel or refund the order',async()=>{
  localStorage.setItem('123dzo-takeaway-capabilities-v1',JSON.stringify([token]));fetchMock.mockResolvedValue(new Response(JSON.stringify({data:snapshot})));await render();await click('Mở đơn đã lưu');await click('Xóa lối mở');expect(host.querySelector('dialog')?.textContent).toContain('không hủy đơn');await click('Xác nhận xóa khỏi máy');expect(localStorage.getItem('123dzo-takeaway-capabilities-v1')).toBe('[]');expect(fetchMock.mock.calls.every(call=>!call[1].method)).toBe(true);
 });
 it('read failure keeps explicit uncertainty and no fabricated payment success',async()=>{
  localStorage.setItem('123dzo-takeaway-capabilities-v1',JSON.stringify([token]));fetchMock.mockRejectedValue(new Error('offline'));await render();await click('Mở đơn đã lưu');expect(host.textContent).toContain('Chưa cập nhật được trạng thái');expect(host.textContent).not.toContain('Đơn đã hoàn tất');
 });
 it('price rejection keeps the cart and refreshes the menu without another order',async()=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'PRICE_CHANGED',message:'Giá món đã đổi'}}),{status:409}));await review();await click('Xác nhận gửi đơn mang về');expect(useTakeawayCartStore.getState().items).toHaveLength(1);expect(navigation.refresh).toHaveBeenCalledOnce();expect(host.querySelector('dialog[open]')).toBeNull();expect(localStorage.getItem('123dzo-pending-takeaway-v1')).toBeNull();
 });
 it('shows the exact changed price and requires consent before updating the cart',async()=>{
  await act(async()=>useTakeawayCartStore.getState().addItem({menu_item_id:menu.id,name:menu.name,category:menu.category,station:menu.station,unit_price:50,image_url:null}));await render();expect(host.textContent).toContain('50');expect(host.textContent).toContain('100');expect(useTakeawayCartStore.getState().items[0].unit_price).toBe(50);await click('Đồng ý cập nhật giá');expect(useTakeawayCartStore.getState().items[0].unit_price).toBe(100);expect(fetchMock).not.toHaveBeenCalled();
 });
 it.each([['CLOSED',200],['PENDING_PAYMENT',404]])('stops polling terminal state %s / HTTP%s',async(status,http)=>{
  vi.useFakeTimers();try{localStorage.setItem('123dzo-takeaway-capabilities-v1',JSON.stringify([token]));fetchMock.mockResolvedValue(new Response(JSON.stringify(http===200?{data:{...snapshot,status,closedAt:result.openedAt}}:{error:{code:'ORDER_NOT_FOUND',message:'Missing'}}),{status:http}));await render();await click('Mở đơn đã lưu');await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(fetchMock).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}
 });
 it('unmount aborts an in-flight snapshot request and removes listeners',async()=>{
  localStorage.setItem('123dzo-takeaway-capabilities-v1',JSON.stringify([token]));fetchMock.mockReturnValue(new Promise(()=>{}));await render();await click('Mở đơn đã lưu');const signal=fetchMock.mock.calls[0][1].signal;await act(async()=>root.render(null));expect(signal.aborted).toBe(true);
 });
 it('copy failure offers a readable fallback without fake success',async()=>{
  Object.defineProperty(navigator,'clipboard',{value:{writeText:vi.fn().mockRejectedValue(new Error('denied'))},configurable:true});
  await act(async()=>root.render(createElement(PaymentInstructions,{bank:settings.bank,amount:100,code:result.paymentCode})));await click('Sao chép số tài khoản');expect(host.textContent).toContain('Chưa sao chép được');expect(host.textContent).toContain(settings.bank.accountNo);
 });
});
describe('Verified manual checkout configuration',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('requires verified merchant/account and explicit enable, never just a supplied account',()=>{
  for(const [name,value] of Object.entries({NEXT_PUBLIC_STORE_NAME:store.name,NEXT_PUBLIC_STORE_ADDRESS:store.address,NEXT_PUBLIC_STORE_PHONE:store.phone,NEXT_PUBLIC_STORE_HOURS:store.hours,NEXT_PUBLIC_STORE_INFO_VERIFIED:'true',NEXT_PUBLIC_BANK_INFO_VERIFIED:'true',NEXT_PUBLIC_VIETQR_BANK_ID:'970407',NEXT_PUBLIC_VIETQR_ACCOUNT_NO:'1234567890',NEXT_PUBLIC_VIETQR_ACCOUNT_NAME:'FIXTURE ONLY',NEXT_PUBLIC_MANUAL_TAKEAWAY_ENABLED:'false'}))vi.stubEnv(name,value);
  expect(takeawaySettings().enabled).toBe(false);vi.stubEnv('NEXT_PUBLIC_MANUAL_TAKEAWAY_ENABLED','true');expect(takeawaySettings().enabled).toBe(false);vi.stubEnv('TAKEAWAY_REQUEST_SOURCE','proxy');vi.stubEnv('TAKEAWAY_RATE_LIMIT_SECRET','fixture-hash-secret-32-characters-minimum');vi.stubEnv('TAKEAWAY_PROXY_SECRET','fixture-proxy-secret-32-characters-minimum');expect(takeawaySettings().enabled).toBe(true);vi.stubEnv('NEXT_PUBLIC_BANK_INFO_VERIFIED','false');expect(takeawaySettings()).toEqual({enabled:false,bank:null});
 });
});
