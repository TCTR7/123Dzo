// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { result as order } from './order_fixtures';
import { parseSessionBill } from '@/lib/sessions/bill-contract';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
import { GET } from '@/app/api/staff/bill/route';
const bill = { sessionId: order.sessionId, status: 'ACTIVE', totalAmount: 100, closedAt: null, items: order.items };
function request(id = order.sessionId) { return new Request(`http://localhost/api/staff/bill?sessionId=${id}`); }
describe('Full bill DTO and guarded read', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true } }); mocks.rpc.mockResolvedValue({ data: bill, error: null }); });
  it('projects all 510 rows without internal fields and accepts quantity0 history', () => {
    const items = Array.from({ length: 510 }, (_, i) => ({ ...order.items[0], id: `50000000-0000-4000-8000-${String(i).padStart(12,'0')}`, quantity: i === 0 ? 0 : 1, unit_cost_price: 40, stock_export_log_id: 'private' }));
    const parsed = parseSessionBill({ ...bill, items });
    expect(parsed?.items).toHaveLength(510); expect(parsed?.items[0].quantity).toBe(0); expect(JSON.stringify(parsed)).not.toContain('unit_cost_price'); expect(JSON.stringify(parsed)).not.toContain('stock_export_log_id');
    expect(parseSessionBill({ ...bill, items: [items[0],items[0]] })).toBeNull();
  });
  it('does not allow a cross-session item in a bill result', () => { expect(parseSessionBill({ ...bill, items: [{ ...order.items[0], session_id: 'other' }] })).toBeNull(); });
  it('uses actor from guard and no-store', async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('fn_get_session_bill', { p_actor_id: 'user_staff', p_session_id: order.sessionId }); expect(await response.json()).toEqual({ data: bill });
  });
  it('invalid UUID does not reach DB', async () => { expect((await GET(request('bad'))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each([[{ status: 'unauthenticated' },401],[{ status: 'unavailable' },503],[{ status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } },403]])('denies unavailable or unauthorized identity', async (access,status) => {
    mocks.access.mockResolvedValue(access); expect((await GET(request())).status).toBe(status); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('fails closed for wrong session or database errors', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...bill, sessionId: '10000000-0000-4000-8000-000000000002' }, error: null }); expect((await GET(request())).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private SQL' } }); const response = await GET(request()); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private SQL');
  });
});
