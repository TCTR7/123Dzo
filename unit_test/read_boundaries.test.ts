// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { result as order, sessionId, line } from './order_fixtures';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn(), guard: vi.fn(), analytics: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
vi.mock('@/lib/auth/staff-guard', () => ({ requireStaffApi: mocks.guard }));
vi.mock('@/lib/data/analytics', () => ({ readAdminAnalytics: mocks.analytics }));
import { parseDineInSnapshot } from '@/lib/data/read-contracts';
import { readDineInSnapshot } from '@/lib/data/dine-in-snapshot';
import { GET } from '@/app/api/customer/snapshot/route';
import { GET as analytics } from '@/app/api/admin/analytics/route';

const token = 'test-capability';
export const snapshotFixture = () => ({ session: { id: sessionId, status: 'ACTIVE', payment_method: null, customer_phone: 'private' },
  table: { table_number: 'A1', current_session_id: 'private' }, zone: { name: 'Garden', internal: 'private' },
  menu: [{ id: line.menu_item_id, name: 'Food', category: 'FOOD', station: 'KITCHEN', price: 100, cost_price: 40, linked_ingredient_id: 'private', prep_time_minutes: 10, image_url: null, is_available: true }],
  items: order.items.map(item => ({ ...item, unit_cost_price: 40, served_by_staff_id: 'private' })),
  queuePositions: Object.fromEntries(order.items.map(item => [item.id, 3])), private: 'secret' });

describe('Read boundaries', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.client.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: snapshotFixture(), error: null }); mocks.guard.mockResolvedValue({ staff: { userId: 'admin' } }); });
  it('projects untrusted RPC JSON and only own queue keys', () => {
    const value = snapshotFixture(); value.queuePositions.other = 999;
    const parsed = parseDineInSnapshot(value, token)!;
    expect(parsed.session.session_token).toBe(token); expect(parsed.queuePositions).not.toHaveProperty('other');
    for (const key of ['cost_price','unit_cost_price','linked_ingredient_id','customer_phone','current_session_id','served_by_staff_id','private']) expect(JSON.stringify(parsed)).not.toContain(key);
  });
  it.each(['CLOSED', 'PENDING_PAYMENT'])('rejects %s snapshots', status => { const value = snapshotFixture(); value.session.status = status; expect(parseDineInSnapshot(value, token)).toBeNull(); });
  it('rejects other-session items and missing queue positions instead of guessing', () => {
    const value = snapshotFixture(); value.items[0].session_id = '10000000-0000-4000-8000-000000000002'; expect(parseDineInSnapshot(value, token)).toBeNull();
    const other = snapshotFixture(); other.queuePositions = {}; expect(parseDineInSnapshot(other, token)).toBeNull();
  });
  it('uses only the supplied token in the service-only RPC', async () => { await readDineInSnapshot(token); expect(mocks.rpc).toHaveBeenCalledWith('fn_get_dine_in_snapshot', { p_token: token }); });
  it('returns no-store JSON with a safe projection', async () => {
    const response = await GET(new Request('http://localhost/api/customer/snapshot', { headers: { 'x-session-token': token } }));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store'); expect(JSON.stringify(await response.json())).not.toContain('cost_price');
  });
  it('rejects query-only tokens before creating the service client', async () => { const response = await GET(new Request('http://localhost/api/customer/snapshot?token=secret')); expect(response.status).toBe(404); expect(mocks.client).not.toHaveBeenCalled(); });
  it('maps expired capabilities to 404, DB/config failures to 503 without private details', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'P0002' } }); expect((await GET(new Request('http://localhost', { headers: { 'x-session-token': token } }))).status).toBe(404);
    mocks.rpc.mockRejectedValueOnce(new Error('private-connection')); const response = await GET(new Request('http://localhost', { headers: { 'x-session-token': token } })); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-connection');
  });
  it('guards analytics before reading any KPI data', async () => { mocks.guard.mockResolvedValue({ response: new Response('', { status: 403 }) }); expect((await analytics(new Request('http://localhost'))).status).toBe(403); expect(mocks.guard).toHaveBeenCalledWith(['admin']); expect(mocks.analytics).not.toHaveBeenCalled(); });
  it.each(['?start=bad&end=2026-10-22', '?start=2026-10-23&end=2026-10-22','?start=2026-10-22','?actor=admin'])('rejects invalid analytics range %s', async query => { expect((await analytics(new Request('http://localhost'+query))).status).toBe(400); expect(mocks.analytics).not.toHaveBeenCalled(); });
  it('runs analytics server-side and returns a failure rather than fake zeros', async () => { mocks.analytics.mockRejectedValue(new Error('private-SQL')); const response = await analytics(new Request('http://localhost')); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-SQL'); });
});
