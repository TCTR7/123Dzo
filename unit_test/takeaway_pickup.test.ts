import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {operationId,sessionId,result as created} from './takeaway_fixtures';
const mocks=vi.hoisted(()=>({refresh:vi.fn()}));vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
import {TakeawayPickups} from '@/components/staff/TakeawayPickups';
const pickup={operationId,sessionId,closedAt:'2026-10-22T11:00:00Z',handedOverBy:'user_staff'};
const row={sessionId,paymentCode:created.paymentCode,customerName:'Test customer',totalAmount:100};
describe('Staff explicit handover waits for all-ready list and persists recovery',()=>{
 let host:HTMLDivElement,root:Root;const fetchMock=vi.fn(),mutation=vi.fn();
 beforeEach(()=>{vi.clearAllMocks();fetchMock.mockReset();mutation.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
  fetchMock.mockImplementation((url:string,init:RequestInit)=>url.includes('?page=')?Promise.resolve(new Response(JSON.stringify({data:{rows:[row],hasMore:false}}))):mutation(url,init));host=document.createElement('div');document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
 const render=async()=>act(async()=>root.render(createElement(TakeawayPickups,{actorId:'user_staff'})));
 const button=(text:string)=>{const node=[...host.querySelectorAll('button')].find(row=>row.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;};
 const click=async(text:string)=>act(async()=>button(text).click());
 it('only hands over after a second explicit confirmation, locks double clicks',async()=>{
  let done!:(response:Response)=>void;mutation.mockReturnValue(new Promise<Response>(resolve=>{done=resolve;}));await render();await click('Xác nhận giao đủ');expect(mutation).not.toHaveBeenCalled();await act(async()=>{button('Tôi đã giao đủ').click();button('Tôi đã giao đủ').click();});expect(mutation).toHaveBeenCalledOnce();expect(JSON.parse(mutation.mock.calls[0][1].body)).toEqual({operationId,sessionId});
  await act(async()=>done(new Response(JSON.stringify({data:pickup}))));expect(mocks.refresh).toHaveBeenCalledOnce();expect(localStorage.getItem('123dzo-pending-pickup:user_staff')).toBeNull();
 });
 it('ambiguous delivery keeps the journal and is recovered by GET only',async()=>{
  mutation.mockRejectedValueOnce(new Error('lost response'));await render();await click('Xác nhận giao đủ');await click('Tôi đã giao đủ');expect(localStorage.getItem('123dzo-pending-pickup:user_staff')).not.toBeNull();await act(async()=>host.querySelector<HTMLButtonElement>('dialog button[aria-label=Đóng]')!.click());
  mutation.mockResolvedValue(new Response(JSON.stringify({data:pickup})));await click('Kiểm tra lượt giao');expect(mutation).toHaveBeenCalledTimes(2);expect(mutation.mock.calls[1][1].method).toBeUndefined();
 });
 it('a stale not-ready rejection is visible and never closes the order optimistically',async()=>{
  mutation.mockResolvedValue(new Response(JSON.stringify({error:{code:'PICKUP_NOT_READY',message:'Chưa đủ món'}}),{status:409}));await render();await click('Xác nhận giao đủ');await click('Tôi đã giao đủ');expect(host.textContent).toContain('Chưa đủ món');expect(mocks.refresh).not.toHaveBeenCalled();expect(localStorage.getItem('123dzo-pending-pickup:user_staff')).toBeNull();
 });
 it('rejects a recovery result belonging to another actor',async()=>{
  localStorage.setItem('123dzo-pending-pickup:user_staff',JSON.stringify({operationId,sessionId}));mutation.mockResolvedValue(new Response(JSON.stringify({data:{...pickup,handedOverBy:'other'}})));await render();await click('Kiểm tra lượt giao');expect(localStorage.getItem('123dzo-pending-pickup:user_staff')).not.toBeNull();expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it('list errors disable actions and do not show an empty successful list',async()=>{
  fetchMock.mockRejectedValue(new Error('offline'));await render();expect(host.textContent).toContain('Chưa tải được đơn');expect(host.textContent).not.toContain('Chưa có đơn chờ giao');
 });
 it('pauses reads offline and refreshes on return to network',async()=>{
  const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);await render();expect(fetchMock).not.toHaveBeenCalled();expect(host.textContent).toContain('tạm dừng');online.mockReturnValue(true);await act(async()=>window.dispatchEvent(new Event('online')));expect(fetchMock).toHaveBeenCalledOnce();expect(host.textContent).toContain(created.paymentCode);
 });
 it('aborts active reads while hidden and refetches on visibility return',async()=>{
  const visible=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');await render();const signal=fetchMock.mock.calls[0][1].signal as AbortSignal;visible.mockReturnValue('hidden');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(signal.aborted).toBe(true);expect(fetchMock).toHaveBeenCalledOnce();visible.mockReturnValue('visible');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(fetchMock).toHaveBeenCalledTimes(2);
 });
});
