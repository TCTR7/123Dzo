import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {TableRow,TableSessionRow} from '@/types/database.types';
import {operationId,sessionId,tableId} from './session_action_fixtures';
const mocks=vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('@clerk/nextjs',()=>({UserButton:()=>null}));
vi.mock('@/lib/data/use-server-refresh',()=>({useServerRefresh:()=>{}}));
vi.mock('@/lib/data/use-snapshot-sound',()=>({useSnapshotSound:()=>{}}));
vi.mock('@/components/ui/SoundControls',()=>({SoundControls:()=>null}));
vi.mock('@/components/ui/PushControls',()=>({PushControls:()=>null}));
import {StaffDashboard} from '@/components/staff/StaffDashboard';
const zoneId='80000000-0000-4000-8000-000000000001',targetId='70000000-0000-4000-8000-000000000002';
const session:TableSessionRow={id:sessionId,session_token:'test-only-capability',session_type:'DINE_IN',status:'ACTIVE',table_id:tableId,assigned_staff_id:'user_staff',customer_name:null,customer_phone:null,payment_method:null,payment_code:null,total_amount:0,activated_at:null,opened_at:'2026-10-22T02:00:00Z',closed_at:null};
const table:TableRow={id:tableId,table_number:'Bàn 1',zone_id:zoneId,status:'OCCUPIED',current_session_id:sessionId};
const target:TableRow={...table,id:targetId,table_number:'Bàn 2',status:'AVAILABLE',current_session_id:null};
const staff={id:'user_staff',full_name:'Staff one',role:'staff' as const,is_active:true,assigned_zone_id:zoneId};
describe('Staff table lifecycle uses protected commands and persistent identities',()=>{
 let host:HTMLDivElement,root:Root;const mutation=vi.fn(),fetchMock=vi.fn();
 beforeEach(()=>{vi.clearAllMocks();mutation.mockReset();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
  fetchMock.mockImplementation((url:string,init:RequestInit)=>url.startsWith('/api/staff/bill?')?Promise.resolve(new Response(JSON.stringify({data:{sessionId,status:'ACTIVE',totalAmount:0,closedAt:null,items:[]}}))):mutation(url,init));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
 });
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
 const render=async(overrides:Partial<Parameters<typeof StaffDashboard>[0]>={})=>act(async()=>root.render(createElement(StaffDashboard,{initialZones:[{id:zoneId,name:'Garden',created_at:session.opened_at}],initialTables:[table,target],initialSessions:[session],initialOrderItems:[],menuItems:[],staffProfiles:[staff,{...staff,id:'user_next',full_name:'Next staff'},{...staff,id:'user_inactive',full_name:'Inactive',is_active:false},{...staff,id:'user_kitchen',full_name:'Kitchen',role:'kitchen'}],currentStaffId:'user_staff',currentStaffRole:'staff',...overrides})));
 function button(text:string){const node=[...host.querySelectorAll('button')].find(row=>row.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;}
 const click=async(text:string)=>act(async()=>button(text).click());
 const submit=()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 const result=(action:string,id=tableId)=>({operationId,action,sessionId,tableId:id,status:'ACTIVE',totalAmount:0});
 it('opens an available table once and waits for server refresh to obtain its QR',async()=>{
  mutation.mockResolvedValue(new Response(JSON.stringify({data:result('OPEN')})));
  await render({initialSessions:[],initialTables:[{...table,status:'AVAILABLE',current_session_id:null}]});await click('Mở bàn & Tạo QR');
  expect(mutation).toHaveBeenCalledOnce();expect(JSON.parse(mutation.mock.calls[0][1].body)).toEqual({operationId,action:'OPEN',input:{tableId}});expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(host.querySelector('svg[role=img]')).toBeNull();expect(localStorage.getItem('123dzo-pending-session:staff:user_staff')).toBeNull();
 });
 it('transfers with expected source and target without generating another capability',async()=>{
  mutation.mockResolvedValue(new Response(JSON.stringify({data:result('TRANSFER',targetId)})));
  await render();await click('Chi tiết');await click('Chuyển bàn');await act(async()=>submit());
  expect(JSON.parse(mutation.mock.calls[0][1].body)).toEqual({operationId,action:'TRANSFER',input:{sessionId,expectedTableId:tableId,targetTableId:targetId}});
  expect(mutation.mock.calls[0][1].body).not.toContain('test-only-capability');expect(mocks.refresh).toHaveBeenCalledOnce();
 });
 it('never offers occupied targets and cannot submit without a free table',async()=>{
  await render({initialTables:[table]});await click('Chi tiết');await click('Chuyển bàn');expect(button('Xác nhận chuyển bàn').disabled).toBe(true);await act(async()=>submit());expect(mutation).not.toHaveBeenCalled();
 });
 it('hands over only to an active serving role and locks a double submit',async()=>{
  let done!:(response:Response)=>void;mutation.mockReturnValue(new Promise<Response>(resolve=>{done=resolve;}));
  await render();await click('Chi tiết');await click('Bàn giao bàn');
  const select=host.querySelector<HTMLSelectElement>('form select')!;expect([...select.options].map(option=>option.value)).toEqual(['user_staff','user_next']);
  await act(async()=>{select.value='user_next';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{submit();submit();});expect(mutation).toHaveBeenCalledOnce();
  expect(JSON.parse(mutation.mock.calls[0][1].body)).toEqual({operationId,action:'HANDOVER',input:{sessionId,expectedAssignedStaffId:'user_staff',assignedStaffId:'user_next'}});
  await act(async()=>done(new Response(JSON.stringify({data:result('HANDOVER')}))));expect(mocks.refresh).toHaveBeenCalledOnce();
 });
 it('a stale transfer rejection preserves the table view and shows the actual failure',async()=>{
  mutation.mockResolvedValue(new Response(JSON.stringify({error:{code:'TABLE_OCCUPIED',message:'Bàn đích vừa được mở'}}),{status:409}));
  await render();await click('Chi tiết');await click('Chuyển bàn');await act(async()=>submit());expect(host.textContent).toContain('Bàn đích vừa được mở');expect(host.textContent).toContain('Bàn 1');expect(localStorage.getItem('123dzo-pending-session:staff:user_staff')).toBeNull();
 });
 it('recovers a response-lost handover by GET before permitting any new action',async()=>{
  localStorage.setItem('123dzo-pending-session:staff:user_staff',JSON.stringify({operationId,action:'HANDOVER',input:{sessionId,expectedAssignedStaffId:'user_staff',assignedStaffId:'user_next'}}));
  mutation.mockResolvedValue(new Response(JSON.stringify({data:result('HANDOVER')})));await render();await click('Kiểm tra thao tác bàn vừa gửi');
  expect(mutation).toHaveBeenCalledOnce();expect(mutation.mock.calls[0][1].method).toBeUndefined();expect(mocks.refresh).toHaveBeenCalledOnce();
 });
});
