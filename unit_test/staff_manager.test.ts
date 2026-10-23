import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfileRow } from '@/types/database.types';

vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { StaffAndTableManager } from '@/components/admin/StaffAndTableManager';

const staff: StaffProfileRow = { id: 'user_admin', full_name: 'Test admin', role: 'admin', is_active: true, assigned_zone_id: null, push_subscription: null };

describe('Staff manager behavior through the production API client', () => {
  let container: HTMLDivElement;
  let root: Root;
  const mockFetch = vi.fn();

  beforeEach(async () => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(StaffAndTableManager, {
        initialZones: [], initialTables: [], initialActiveSessions: [], initialStaff: [staff],
      }));
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function activeButton(): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Đang làm việc'));
    if (!button) throw new Error('Active staff control not found');
    return button;
  }
  function button(text:string){const node=[...container.querySelectorAll('button')].find(row=>row.textContent?.includes(text));if(!node)throw new Error('Missing '+text);return node;}
  function input(node:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));}
  const submit=()=>container.querySelectorAll('form')[1].dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));

  it('new staff defaults to serving role and does not submit missing identity/name',async()=>{
    await act(async()=>button('Thêm Hồ sơ Nhân sự').click());await act(async()=>submit());expect(mockFetch).not.toHaveBeenCalled();
    const form=container.querySelectorAll('form')[1],fields=form.querySelectorAll('input[type=text]');
    await act(async()=>{input(fields[0] as HTMLInputElement,'user_new');input(fields[1] as HTMLInputElement,'New worker');});
    const saved={id:'user_new',full_name:'New worker',role:'staff',assigned_zone_id:null,is_active:true};mockFetch.mockResolvedValue(new Response(JSON.stringify({data:saved})));
    await act(async()=>submit());expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({action:'create',profile:saved,expected:null});expect(container.textContent).toContain('New worker');expect(container.querySelectorAll('form')).toHaveLength(1);
  });
  it('editing staff keeps its immutable Clerk ID and sends the old role/active snapshot',async()=>{
    await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="Sửa hồ sơ Test admin"]')!.click());
    const form=container.querySelectorAll('form')[1],fields=form.querySelectorAll('input[type=text]');expect((fields[0] as HTMLInputElement).disabled).toBe(true);
    await act(async()=>input(fields[1] as HTMLInputElement,'Renamed admin'));
    const saved={id:staff.id,full_name:'Renamed admin',role:staff.role,assigned_zone_id:null,is_active:true};mockFetch.mockResolvedValue(new Response(JSON.stringify({data:saved})));
    await act(async()=>submit());expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({action:'update',profile:saved,expected:{id:staff.id,full_name:staff.full_name,role:'admin',is_active:true}});expect(container.textContent).toContain('Renamed admin');
  });

  it('blocks a double click and updates active state only after server confirmation', async () => {
    let resolve!: (value: Response) => void;
    mockFetch.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const button = activeButton();
    act(() => { button.click(); button.click(); });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Đang làm việc');
    await act(async () => { resolve(new Response(JSON.stringify({ data: { ...staff, push_subscription: undefined, is_active: false } }))); });
    expect(container.textContent).toContain('Tạm nghỉ');
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body).expected).toEqual({ id: staff.id, full_name: staff.full_name, role: staff.role, assigned_zone_id: null, is_active: true });
  });

  it('keeps the active profile and shows last-admin conflict when the server rejects', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'LAST_ADMIN', message: 'Phải giữ ít nhất một quản trị viên đang hoạt động.' } }), { status: 409 }));
    await act(async () => activeButton().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Phải giữ ít nhất');
    expect(activeButton().disabled).toBe(false);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('does not automatically repeat an unknown network outcome', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));
    await act(async () => activeButton().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Chưa xác nhận được kết quả');
    expect(activeButton().disabled).toBe(false);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('disables assigning an unopened table and explains where default zones are edited', async () => {
    await act(async () => {
      root.render(createElement(StaffAndTableManager, {
        key: 'unopened-table-scenario',
        initialZones: [], initialActiveSessions: [], initialStaff: [staff],
        initialTables: [{ id: 'table_1', table_number: 'Bàn 1', zone_id: 'zone_1', status: 'AVAILABLE', current_session_id: null }],
      }));
    });
    const control = container.querySelector<HTMLSelectElement>('select[aria-label="Nhân viên phụ trách Bàn 1"]');
    expect(control?.disabled).toBe(true);
    expect(container.textContent).toContain('Mở bàn để phân công');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('assigns an open table through HANDOVER with an expected snapshot and blocks a double change', async () => {
    const tableId='70000000-0000-4000-8000-000000000001',sessionId='10000000-0000-4000-8000-000000000001';
    const operationId='90000000-0000-4000-8000-000000000001';
    vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
    let resolve!: (response: Response) => void;
    mockFetch.mockReturnValue(new Promise<Response>((done)=>{resolve=done;}));
    await act(async()=>root.render(createElement(StaffAndTableManager,{
      key:'assigned-table',currentAdminId:'user_admin',initialZones:[],
      initialTables:[{id:tableId,table_number:'Bàn 1',zone_id:'zone_1',status:'OCCUPIED',current_session_id:sessionId}],
      initialStaff:[staff,{...staff,id:'user_worker',role:'staff'}],
      initialActiveSessions:[{id:sessionId,session_token:'test-only-token',session_type:'DINE_IN',status:'ACTIVE',table_id:tableId,
        assigned_staff_id:'user_admin',customer_name:null,customer_phone:null,payment_method:null,payment_code:'TEST',total_amount:0,activated_at: null, opened_at:'2026-10-22T02:00:00Z',closed_at:null}],
    })));
    const control=container.querySelector<HTMLSelectElement>('select[aria-label="Nhân viên phụ trách Bàn 1"]')!;
    act(()=>{control.value='user_worker';control.dispatchEvent(new Event('change',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toBe('/api/staff/sessions');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({operationId,action:'HANDOVER',input:{sessionId,expectedAssignedStaffId:'user_admin',assignedStaffId:'user_worker'}});
    await act(async()=>resolve(new Response(JSON.stringify({data:{operationId,action:'HANDOVER',sessionId,tableId,status:'ACTIVE',totalAmount:0}}))));
    expect(localStorage.getItem('123dzo-pending-session:staff:user_admin')).toBeNull();
  });
});
