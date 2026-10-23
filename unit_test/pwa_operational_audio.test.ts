import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemRow, TableSessionRow } from '@/types/database.types';
import type { DisplayOrderItem } from '@/lib/orders/contracts';
import { result } from './order_fixtures';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@clerk/nextjs', () => ({ UserButton: () => null }));
vi.mock('@/lib/sessions/use-session-bill', () => ({ useSessionBill: () => ({ data: null, error: null, loading: false }) }));
import { KitchenKdsBoard } from '@/components/kitchen/KitchenKdsBoard';
import { StaffDashboard } from '@/components/staff/StaffDashboard';
import { disposeSound } from '@/lib/audio/notifications';
const row = result.items[0];
const session: TableSessionRow = { id: row.session_id, session_token: 'unit-only-token', session_type: 'DINE_IN', table_id: null, assigned_staff_id: 'user_staff', customer_name: null, customer_phone: null, status: 'ACTIVE', payment_method: null, payment_code: null, total_amount: 100, activated_at: null, opened_at: row.created_at, closed_at: null };
const menu: MenuItemRow = { id: row.menu_item_id, name: 'Unit Food', category: 'FOOD', station: 'KITCHEN', price: 100, cost_price: 40, prep_time_minutes: 10, image_url: null, is_available: true, linked_ingredient_id: null };
describe('Operational audio comes only from actionable work', () => {
  let root: Root, host: HTMLDivElement; const play = vi.fn();
  beforeEach(() => {
    disposeSound(); vi.clearAllMocks(); play.mockResolvedValue(undefined);
    vi.stubGlobal('Audio', vi.fn(function AudioMock() { return { play, pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }; }));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); disposeSound(); host.remove(); vi.unstubAllGlobals(); });
  async function unlock() { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Bật âm thanh')!.click()); expect(play).toHaveBeenCalledOnce(); }
  async function kitchen(rows: DisplayOrderItem[], current: TableSessionRow) {
    await act(async () => root.render(createElement(KitchenKdsBoard, { initialKitchenOrders: rows, initialActiveSessions: [current], initialMenuItems: [menu], tables: [], currentStaffId: 'user_kitchen' })));
  }
  async function staff(rows: DisplayOrderItem[], current: TableSessionRow) {
    await act(async () => root.render(createElement(StaffDashboard, { initialZones: [], initialTables: [], initialSessions: [current], initialOrderItems: rows, menuItems: [menu], staffProfiles: [], currentStaffId: 'user_staff', currentStaffRole: 'staff' })));
  }
  it('KDS is silent for unpaid/zero rows and sounds once when a new live session activates', async () => {
    await kitchen([], session); await unlock();
    await kitchen([row], { ...session, status: 'PENDING_PAYMENT' }); expect(play).toHaveBeenCalledOnce();
    await kitchen([row], session); expect(play).toHaveBeenCalledTimes(2);
    await kitchen([row, { ...row, id: '50000000-0000-4000-8000-000000000099', quantity: 0 }], session); expect(play).toHaveBeenCalledTimes(2);
    await kitchen([row], session); expect(play).toHaveBeenCalledTimes(2);
  });
  it('Staff sounds for assigned live READY work, not unpaid or another assignee', async () => {
    const ready = { ...row, station: 'BAR_INSTANT' as const, status: 'READY' as const, ready_at: row.created_at };
    await staff([], session); await unlock();
    await staff([ready], { ...session, status: 'PENDING_PAYMENT' }); expect(play).toHaveBeenCalledOnce();
    await staff([ready], { ...session, assigned_staff_id: 'someone_else' }); expect(play).toHaveBeenCalledOnce();
    await staff([ready], session); expect(play).toHaveBeenCalledTimes(2);
    await staff([ready, { ...ready, id: '50000000-0000-4000-8000-000000000099', quantity: 0 }], session); expect(play).toHaveBeenCalledTimes(2);
  });
});
