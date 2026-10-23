import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { operationId, sessionId, tableId } from './session_action_fixtures';
import { result as orderResult, menuId } from './order_fixtures';
import type { MenuItemRow, TableSessionRow } from '@/types/database.types';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));
const db = { from: mocks.from, channel: mocks.channel, removeChannel: mocks.removeChannel };
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@clerk/nextjs', () => ({ UserButton: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => db }));
import { StaffDashboard } from '@/components/staff/StaffDashboard';
const zoneId = '80000000-0000-4000-8000-000000000001';
const session: TableSessionRow = { id: sessionId, session_token: 'test-only-token', session_type: 'DINE_IN', status: 'ACTIVE',
  table_id: tableId, assigned_staff_id: 'user_staff', customer_name: null, customer_phone: null, payment_method: null,
  payment_code: 'TEST', total_amount: 100, activated_at: null, opened_at: '2026-10-22T02:00:00Z', closed_at: null };
const menu: MenuItemRow = { id: menuId, name: 'Món kiểm thử', category: 'FOOD', station: 'KITCHEN', price: 100, cost_price: 40,
  prep_time_minutes: 10, image_url: null, is_available: true, linked_ingredient_id: null };
const bill = { sessionId, status: 'ACTIVE', totalAmount: 100, closedAt: null, items: [{ ...orderResult.items[0], status: 'SERVED' }] };
describe('Staff close UI uses complete bill and explicit payment confirmation', () => {
  let container: HTMLDivElement, root: Root;
  const postMock = vi.fn(); const fetchMock = vi.fn();
  function button(text: string) { const item = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(text)); if (!item) throw new Error(`Missing ${text}`); return item; }
  async function render(sessions:TableSessionRow[]=[session]) {
    await act(async () => root.render(createElement(StaffDashboard, {
      initialZones: [{ id: zoneId, name: 'Khu kiểm thử', created_at: session.opened_at }],
      initialTables: [{ id: tableId, table_number: 'Bàn kiểm thử', zone_id: zoneId, status: 'OCCUPIED', current_session_id: sessionId }],
      initialSessions: sessions, initialOrderItems: [], menuItems: [menu], initialIngredients: [], staffProfiles: [], currentStaffId: 'user_staff', currentStaffRole: 'staff',
    })));
  }
  async function mount() {
    await render();await act(async () => button('Chi tiết').click());
    act(() => button('Chốt & Đóng bill').click());
  }
  function submit() { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
  beforeEach(() => {
    vi.clearAllMocks(); postMock.mockReset(); fetchMock.mockReset();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock); vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId);
    mocks.channel.mockImplementation(() => { const channel = { on: vi.fn(), subscribe: vi.fn() }; channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel); return channel; });
    fetchMock.mockImplementation((url: string, init: RequestInit) => url.startsWith('/api/staff/bill?') ? Promise.resolve(new Response(JSON.stringify({ data: bill }))) : postMock(url,init));
    container=document.createElement('div'); document.body.append(container); root=createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('loads the full session detail and does not close without payment confirmation', async () => {
    await mount(); await act(async () => submit());
    expect(fetchMock.mock.calls[0][0]).toContain('/api/staff/bill?'); expect(container.textContent).toContain('Món kiểm thử');
    expect(postMock).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('double submit sends one CLOSE and never writes tables directly', async () => {
    let resolve!: (response: Response) => void; postMock.mockReturnValue(new Promise<Response>((done) => { resolve=done; }));
    await mount(); act(() => container.querySelector<HTMLInputElement>('form input[type="checkbox"]')!.click());
    act(() => { submit(); submit(); }); expect(postMock).toHaveBeenCalledOnce();
    expect(JSON.parse(postMock.mock.calls[0][1].body)).toMatchObject({ operationId, action: 'CLOSE', input: { sessionId, expectedTotal: 100, confirmedReceived: true } });
    await act(async () => resolve(new Response(JSON.stringify({ data: { operationId, action: 'CLOSE', sessionId, tableId, status: 'CLOSED', totalAmount: 100 } }))));
    expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.from).not.toHaveBeenCalled(); expect(localStorage.getItem('123dzo-pending-session:staff:user_staff')).toBeNull();
  });
  it('price/quantity conflict shows the DB total and requires confirmation again', async () => {
    postMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BILL_CHANGED', message: 'Kiểm tra tổng mới', totalAmount: 200 } }), { status: 409 }));
    await mount(); act(() => container.querySelector<HTMLInputElement>('form input[type="checkbox"]')!.click()); await act(async () => submit());
    expect(container.querySelector<HTMLInputElement>('form input[type="checkbox"]')?.checked).toBe(false);
    await act(async () => submit()); expect(postMock).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Kiểm tra tổng mới');
  });
  it('requires reconfirmation when another device updates the bill while checkout is open',async()=>{
    await mount();act(()=>container.querySelector<HTMLInputElement>('form input[type=checkbox]')!.click());
    await render([{...session,total_amount:200}]);
    expect(container.querySelector<HTMLInputElement>('form input[type=checkbox]')!.checked).toBe(false);
    await act(async()=>submit());expect(postMock).not.toHaveBeenCalled();
  });
  it('requires reconfirmation when switching from cash to bank transfer',async()=>{
    await mount();act(()=>container.querySelector<HTMLInputElement>('form input[type=checkbox]')!.click());
    await act(async()=>{const node=[...container.querySelectorAll('form button')].find(row=>row.textContent?.includes('VIETQR'));(node as HTMLButtonElement).click();});
    expect(container.querySelector<HTMLInputElement>('form input[type=checkbox]')!.checked).toBe(false);
    await act(async()=>submit());expect(postMock).not.toHaveBeenCalled();
  });
});
