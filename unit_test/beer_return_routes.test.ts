// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draft, journal, operationId, sessionId, result } from './beer_return_fixtures';
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
import { POST, GET } from '@/app/api/staff/returns/route';
function post(body: unknown = journal, origin = 'http://localhost') {
  return new Request('http://localhost/api/staff/returns', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function lookup() { return new Request(`http://localhost/api/staff/returns?sessionId=${sessionId}&operationId=${operationId}`); }
describe('Beer return API boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true } });
    mocks.client.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: result, error: null });
  });
  it('takes actor from guard and projects the immutable result', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, stock_export_log_id: 'private' }, error: null });
    const response = await POST(post());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: result });
    const { sessionId: _session, ...input } = draft;
    expect(mocks.rpc).toHaveBeenCalledWith('fn_return_beer', { p_actor_id: 'user_staff', p_session_id: sessionId, p_operation_id: operationId, p_input: input });
  });
  it.each([
    [{ status: 'unauthenticated' }, 401], [{ status: 'forbidden' }, 403], [{ status: 'unavailable' }, 503],
    [{ status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } }, 403],
  ])('rejects unauthorized writes and recovery', async (access, status) => {
    mocks.access.mockResolvedValue(access); expect((await POST(post())).status).toBe(status); expect((await GET(lookup())).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...journal, actorId: 'user_admin' }, { ...journal, ingredientId: sessionId }, { ...journal, unitCost: 1 },
    { ...journal, status: 'CANCELLED' }, { ...journal, confirmedUnused: false }, { ...journal, quantity: 1.1 },
    { ...journal, quantity: 4 }, { ...journal, quantity: 0 }, { ...journal, expectedQuantity: 100 },
  ])('rejects forged fields, missing confirmation or invalid quantities', async (body) => {
    expect((await POST(post(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects Origin and oversized body', async () => {
    expect((await POST(post(journal, 'https://attacker.test'))).status).toBe(403);
    expect((await POST(post({ padding: 'x'.repeat(8192) }))).status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lookup only reads current actor and session scope', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await (await GET(lookup())).json()).toEqual({ data: null });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_get_beer_return_operation', { p_actor_id: 'user_staff', p_session_id: sessionId, p_operation_id: operationId });
  });
  it.each([
    ['P1201', 409, 'RETURN_CHANGED'], ['P1202', 409, 'RETURN_NOT_ALLOWED'], ['P1203', 409, 'RETURN_PROVENANCE_MISSING'],
    ['P1001', 409, 'SESSION_NOT_ACTIVE'], ['P1102', 409, 'INVENTORY_INVALID'], ['22000', 409, 'OPERATION_CONFLICT'],
    ['42501', 403, 'FORBIDDEN'], ['55P03', 503, 'RETURN_UNAVAILABLE'],
  ])('maps database error %s without SQL leakage', async (code, status, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL detail' } });
    const response = await POST(post()); expect(response.status).toBe(status);
    const body = await response.json(); expect(body.error.code).toBe(expected); expect(JSON.stringify(body)).not.toContain('private SQL');
  });
  it('rejects dependency results for a different item', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, orderItemId: operationId }, error: null }); expect((await POST(post())).status).toBe(503);
  });
});
