import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {journal,result,status,operationId} from './manual_payment_fixtures';
const mocks=vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('next/link',()=>({default:({children,...props}:{children:unknown})=>createElement('a',props,children as string)}));
vi.mock('@/lib/data/use-server-refresh',()=>({useServerRefresh:()=>{}}));
import {ManualPayments} from '@/components/staff/ManualPayments';
describe('Manual receipt UI checks evidence and keeps an immutable actor audit',()=>{
 let host:HTMLDivElement,root:Root;const fetchMock=vi.fn();
 beforeEach(()=>{vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
 const render=async(value=status)=>act(async()=>root.render(createElement(ManualPayments,{status:value,actorId:'user_staff',path:'/staff/payments'})));
 const button=(text:string)=>{const node=[...host.querySelectorAll('button')].find(row=>row.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;};
 const open=async()=>act(async()=>button('Đối chiếu và xác nhận').click());
 const reference=async(value:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>('dialog input[type=text],dialog input:not([type])')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
 const check=async()=>act(async()=>host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!.click());
 const submit=()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 it('shows original actor/time/reference and has no edit/delete audit controls',async()=>{
  await render();expect(host.textContent).toContain('Original staff (user_staff)');expect(host.textContent).toContain('TCB-123');expect(host.textContent).toContain('Thời điểm:');expect([...host.querySelectorAll('button')].some(row=>/Sửa|Xóa/.test(row.textContent??''))).toBe(false);
 });
 it('requires bank reference and actual receipt confirmation, and locks double submit',async()=>{
  let done!:(response:Response)=>void;fetchMock.mockReturnValue(new Promise<Response>(resolve=>{done=resolve;}));await render();await open();
  expect(button('Xác nhận đã nhận đủ tiền').disabled).toBe(true);await act(async()=>submit());expect(fetchMock).not.toHaveBeenCalled();await reference('TCB-123');await check();
  await act(async()=>{submit();submit();});expect(fetchMock).toHaveBeenCalledOnce();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(journal);expect(host.querySelector<HTMLButtonElement>('dialog button[aria-label=Đóng]')?.disabled).toBe(true);
  await act(async()=>done(new Response(JSON.stringify({data:result}))));expect(mocks.refresh).toHaveBeenCalledOnce();expect(host.querySelector('dialog')).toBeNull();expect(localStorage.getItem('123dzo-pending-payment:user_staff')).toBeNull();
 });
 it('invalidates confirmation when the amount or transfer reference changes',async()=>{
  await render();await open();await reference('TCB-123');await check();await reference('TCB-124');expect(host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!.checked).toBe(false);
  await check();await render({...status,pending:status.pending.map(row=>({...row,amount:200}))});expect(host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!.checked).toBe(false);expect(fetchMock).not.toHaveBeenCalled();
 });
 it('network ambiguity retains the journal and recovery GET never reconfirms a second receipt',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('lost'));await render();await open();await reference('TCB-123');await check();await act(async()=>submit());expect(localStorage.getItem('123dzo-pending-payment:user_staff')).not.toBeNull();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:result})));await act(async()=>host.querySelector<HTMLButtonElement>('dialog button[aria-label=Đóng]')!.click());await act(async()=>button('Kiểm tra xác nhận vừa gửi').click());expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
 });
 it('cash has no bank reference but still requires explicit receipt acknowledgment',async()=>{
  await render();await open();await reference('TCB-123');await check();const select=host.querySelector('select')!;await act(async()=>{select.value='CASH';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host.querySelector<HTMLInputElement>('dialog input[type=checkbox]')!.checked).toBe(false);expect(button('Xác nhận đã nhận đủ tiền').disabled).toBe(true);
 });
});
