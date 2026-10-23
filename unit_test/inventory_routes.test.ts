// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { input, journal, operationId, result } from './inventory_fixtures';
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
import { POST, GET } from '@/app/api/admin/inventory/route';
function post(value: unknown = journal, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/inventory', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
function get() { return new Request(`http://localhost/api/admin/inventory?operationId=${operationId}`); }
describe('Inventory admin boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_admin', role: 'admin', isActive: true } });
    mocks.client.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: result, error: null });
  });
  it('takes actor from guard and returns a projected noncached DTO', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, stock_quantity: 999, privateNote: 'private' }, error: null });
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: result });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_record_inventory', { p_actor_id: 'user_admin', p_operation_id: operationId, p_input: input });
  });
  it.each([
    [{ status: 'unauthenticated' }, 401], [{ status: 'unavailable' }, 503], [{ status: 'forbidden' }, 403],
    [{ status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true } }, 403],
    [{ status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } }, 403],
  ])('denies unauthorized POST and lookup', async (access, status) => {
    mocks.access.mockResolvedValue(access);
    expect((await POST(post())).status).toBe(status);
    expect((await GET(get())).status).toBe(status);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([
    { ...journal, actorId: 'user_admin' }, { ...journal, input: { ...input, stock_quantity: 100 } },
    { ...journal, input: { ...input, total_cost: 1 } }, { ...journal, input: { ...input, type: 'EXPORT_SALE' } },
    { ...journal, input: { ...input, type: 'RETURN_BEER' } }, { ...journal, input: { ...input, quantity: 0 } },
    { ...journal, input: { ...input, quantity: 0.0001 } }, { ...journal, input: { ...input, unitCost: 0.001 } },
    { ...journal, input: { ...input, type: 'WASTAGE', unitCost: null, note: ' ' } },
  ])('rejects forged or invalid input before DB', async (body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('WASTAGE carries no client price', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, quantityChange: -1 }, error: null });
    expect((await POST(post({ operationId, input: { ...input, type: 'WASTAGE', unitCost: null, note: ' broken ' } }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_record_inventory', expect.objectContaining({ p_input: expect.objectContaining({ unitCost: null, note: 'broken' }) }));
  });
  it('rejects cross-origin, invalid JSON and >8KiB bodies', async () => {
    expect((await POST(post(journal, { origin: 'https://attacker.test' }))).status).toBe(403);
    expect((await POST(new Request('http://localhost/api/admin/inventory', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await POST(post({ padding: 'x'.repeat(8192) }))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lookup can only read current actor scope, never creates a movement', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await (await GET(get())).json()).toEqual({ data: null });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_get_inventory_operation', { p_actor_id: 'user_admin', p_operation_id: operationId });
    expect((await GET(new Request('http://localhost/api/admin/inventory?operationId=bad'))).status).toBe(400);
  });
  it.each([
    ['42501', 403, 'FORBIDDEN'], ['P0002', 404, 'INGREDIENT_NOT_FOUND'], ['P1004', 409, 'OUT_OF_STOCK'],
    ['P1102', 409, 'INVENTORY_INVALID'], ['22000', 409, 'OPERATION_CONFLICT'], ['22023', 400, 'INVALID_INVENTORY'],
    ['55P03', 503, 'INVENTORY_UNAVAILABLE'],
  ])('maps SQL errors safely: %s', async (code, status, name) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL detail' } });
    const response = await POST(post());
    expect(response.status).toBe(status);
    const data = await response.json();
    expect(data.error.code).toBe(name);
    expect(JSON.stringify(data)).not.toContain('private SQL');
  });
  it('rejects a mismatching result without clearing an unknown commit', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, quantityChange: -1 }, error: null });
    expect((await POST(post())).status).toBe(503);
  });
});
