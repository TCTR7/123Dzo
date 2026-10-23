import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { journal, operationId, sessionId, result as returnResult } from './beer_return_fixtures';
import { result as orderResult, menuId } from './order_fixtures';
import type { MenuItemRow, TableSessionRow } from '@/types/database.types';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));
const db = { from: mocks.from, channel: mocks.channel, removeChannel: mocks.removeChannel };
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/sessions/use-session-bill', () => ({ useSessionBill: () => ({ data: null, error: null, loading: false }) }));
vi.mock('@clerk/nextjs', () => ({ UserButton: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => db }));
import { StaffDashboard } from '@/components/staff/StaffDashboard';
const tableId = '70000000-0000-4000-8000-000000000001';
const zoneId = '80000000-0000-4000-8000-000000000001';
const session: TableSessionRow = { id: sessionId, session_token: 'test-only-token', session_type: 'DINE_IN', status: 'ACTIVE',
  table_id: tableId, assigned_staff_id: 'user_staff', customer_name: null, customer_phone: null, payment_method: null,
  payment_code: 'TEST', total_amount: 60, activated_at: null, opened_at: '2026-10-22T02:00:00Z', closed_at: null };
const menu: MenuItemRow = { id: menuId, name: 'Bia kiểm thử', category: 'BEER', station: 'BAR_INSTANT', price: 20, cost_price: 13,
  prep_time_minutes: 0, image_url: null, is_available: true, linked_ingredient_id: null };
describe('Staff beer-return flow through production journal/API', () => {
  let container: HTMLDivElement, root: Root;
  const fetchMock = vi.fn();
  async function mount(quantity = 3, role: 'staff' | 'admin' = 'staff') {
    await act(async () => root.render(createElement(StaffDashboard, {
      key: String(quantity), initialZones: [{ id: zoneId, name: 'Khu kiểm thử', created_at: session.opened_at }],
      initialTables: [{ id: tableId, table_number: 'Bàn kiểm thử', zone_id: zoneId, status: 'OCCUPIED', current_session_id: sessionId }],
      initialSessions: [session], initialOrderItems: [{ ...orderResult.items[0], quantity, station: 'BAR_INSTANT', status: 'READY', unit_price: 20, ready_at: session.opened_at }],
      menuItems: [menu], initialIngredients: [], staffProfiles: [], currentStaffId: 'user_staff', currentStaffRole: role,
    })));
  }
  function button(text: string) {
    const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
    if (!found) throw new Error(`Missing button ${text}`); return found;
  }
  async function openReturn() {
    act(() => button('Chi tiết').click()); act(() => button('Trả bia thừa').click());
  }
  function confirmUnused() { act(() => container.querySelector<HTMLInputElement>('form input[type="checkbox"]')!.click()); }
  function submit() { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
  beforeEach(() => {
    fetchMock.mockReset(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId);
    mocks.channel.mockImplementation(() => { const channel = { on: vi.fn(), subscribe: vi.fn() }; channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel); return channel; });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('requires explicit unused confirmation before contacting the server', async () => {
    await mount(); await openReturn(); await act(async () => submit());
    expect(fetchMock).not.toHaveBeenCalled(); expect(container.textContent).toContain('xác nhận hàng còn nguyên');
  });
  it('locks a double submit and refreshes current server rows after confirmation', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    await mount(); await openReturn(); confirmUnused(); act(() => { submit(); submit(); });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => resolve(new Response(JSON.stringify({ data: returnResult }))));
    expect(mocks.refresh).toHaveBeenCalledOnce(); expect(localStorage.getItem('123dzo-pending-return:user_staff')).toBeNull();
    expect(container.textContent).toContain('Đã xác nhận trả bia');
  });
  it('recovers after response loss through GET and never mutates browser stock or order rows', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost')); await mount(); await openReturn(); confirmUnused(); await act(async () => submit());
    expect(container.querySelector('form')).toBeNull(); expect(JSON.parse(localStorage.getItem('123dzo-pending-return:user_staff')!)).toEqual(journal);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: returnResult })));
    await act(async () => button('Kiểm tra lượt trả bia vừa gửi').click());
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined(); expect(fetchMock.mock.calls[1][0]).toContain('/api/staff/returns?');
    expect(mocks.from).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('retains a fully returned row in history but cannot serve or return it again', async () => {
    await mount(0); act(() => button('Chi tiết').click());
    expect(container.textContent).toContain('Đã trả hết');
    expect([...container.querySelectorAll('button')].some((item) => item.textContent?.includes('Bưng ngay'))).toBe(false);
    act(() => button('Trả bia thừa').click()); expect(container.textContent).toContain('chưa có dòng bia');
    expect(container.querySelector('form')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('serves through the guarded transition API and prevents duplicate clicks', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((done)=>{resolve=done;}));
    await mount();act(()=>{button('Đã bưng lên bàn').click();button('Đã bưng lên bàn').click();});
    expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][0]).toBe('/api/staff/item-actions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({operationId,action:'SERVE',items:[{id:journal.orderItemId,expectedStatus:'READY',expectedQuantity:3}]});
    await act(async()=>resolve(new Response(JSON.stringify({data:{operationId,action:'SERVE',batchId:null,items:[{id:journal.orderItemId,sessionId,fromStatus:'READY',status:'SERVED'}]}}))));
    expect(mocks.from).not.toHaveBeenCalled();expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('requires an explicit reason before admin cancels a ready item', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,action:'CANCEL',batchId:null,items:[{id:journal.orderItemId,sessionId,fromStatus:'READY',status:'CANCELLED'}]}})));
    await mount(3,'admin');act(()=>button('Chi tiết').click());
    act(()=>container.querySelector<HTMLButtonElement>('button[title="Hủy món (cần lý do)"]')!.click());
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(fetchMock).not.toHaveBeenCalled();
    const textarea=container.querySelector('textarea')!;
    act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'  Khách báo không dùng  ');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(fetchMock).toHaveBeenCalledOnce();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({action:'CANCEL',reason:'Khách báo không dùng',items:[{expectedStatus:'READY',expectedQuantity:3}]});
    expect(mocks.from).not.toHaveBeenCalled();expect(container.querySelector('textarea')).toBeNull();
  });
});
