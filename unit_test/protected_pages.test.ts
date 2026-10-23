// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/staff-guard', () => ({ requireStaffPage: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
vi.mock('@/components/admin/AdminKpiDashboard', () => ({ AdminKpiDashboard: vi.fn() }));
vi.mock('@/components/admin/BillsManager', () => ({ BillsManager: vi.fn() }));
vi.mock('@/components/admin/InventoryManager', () => ({ InventoryManager: vi.fn() }));
vi.mock('@/components/admin/MenuManager', () => ({ MenuManager: vi.fn() }));
vi.mock('@/components/admin/StaffAndTableManager', () => ({ StaffAndTableManager: vi.fn() }));
vi.mock('@/components/kitchen/KitchenKdsBoard', () => ({ KitchenKdsBoard: vi.fn() }));
vi.mock('@/components/staff/StaffDashboard', () => ({ StaffDashboard: vi.fn() }));

import NotificationsPage from '@/app/(auth-protected)/admin/notifications/page';
import ReleasePage from '@/app/(auth-protected)/admin/release/page';
import AdminPayments from '@/app/(auth-protected)/admin/payments/page';
import StaffPayments from '@/app/(auth-protected)/staff/payments/page';
import AdminPage from '@/app/(auth-protected)/admin/page';
import BillsPage from '@/app/(auth-protected)/admin/bills/page';
import InventoryPage from '@/app/(auth-protected)/admin/inventory/page';
import MenuPage from '@/app/(auth-protected)/admin/menu/page';
import StaffAdminPage from '@/app/(auth-protected)/admin/staff/page';
import StaffPage from '@/app/(auth-protected)/staff/page';
import KitchenPage from '@/app/(auth-protected)/kitchen/page';

describe('Every protected page checks access before fetching business data', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockRejectedValue(new Error('denied-before-data'));
  });

  it.each([
    { name: 'notifications', page: NotificationsPage, roles: ['admin'] },
    { name: 'admin receipts', page: AdminPayments, roles: ['admin'] },
    { name: 'staff receipts', page: StaffPayments, roles: ['staff','admin'] },
    { name: 'release reconciliation', page: ReleasePage, roles: ['admin'] },
    { name: 'admin', page: AdminPage, roles: ['admin'] },
    { name: 'bills', page: BillsPage, roles: ['admin'] },
    { name: 'inventory', page: InventoryPage, roles: ['admin'] },
    { name: 'menu', page: MenuPage, roles: ['admin'] },
    { name: 'staff administration', page: StaffAdminPage, roles: ['admin'] },
    { name: 'staff', page: StaffPage, roles: ['staff', 'admin'] },
    { name: 'kitchen', page: KitchenPage, roles: ['kitchen', 'admin'] },
  ])('$name denies before creating its data client', async ({ page, roles }) => {
    await expect(page({})).rejects.toThrow('denied-before-data');
    expect(mocks.guard).toHaveBeenCalledWith(roles);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
