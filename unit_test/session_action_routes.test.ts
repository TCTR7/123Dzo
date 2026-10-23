// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open, bill, sessionId, operationId, result } from './session_action_fixtures';
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
import { POST as staffPOST, GET as staffGET } from '@/app/api/staff/sessions/route';
import { POST as billPOST, GET as billGET } from '@/app/api/customer/bill/route';
function post(body: unknown = open, headers: Record<string, string> = {}) { return new Request('http://localhost/api/staff/sessions', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-session-token': 'test-token', ...headers }, body: JSON.stringify(body) }); }
describe('Session action API identity and transaction boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true } });
    mocks.client.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: result, error: null });
  });
  it('OPEN actor comes from guard, with no token/cost leakage', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, session_token: 'private' }, error: null });
    const response = await staffPOST(post()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: result });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_session_action', { p_actor_id: 'user_staff', p_session_token: null, p_operation_id: operationId, p_action: 'OPEN', p_input: open.input });
  });
  it('guest bill capability does not depend on Clerk; guest cannot open or close tables', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, action: 'REQUEST_BILL', status: 'REQUEST_BILL' }, error: null });
    expect((await billPOST(post(bill))).status).toBe(200); expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('fn_session_action', expect.objectContaining({ p_actor_id: null, p_session_token: 'test-token' }));
    expect((await billPOST(post(open))).status).toBe(400);
    expect((await billPOST(post(bill, { 'x-session-token': '' }))).status).toBe(403);
  });
  it.each([
    [{ status: 'unauthenticated' }, 401], [{ status: 'unavailable' }, 503], [{ status: 'forbidden' }, 403],
    [{ status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } }, 403],
  ])('denies unauthorized staff', async (access, status) => {
    mocks.access.mockResolvedValue(access); expect((await staffPOST(post())).status).toBe(status);
    expect((await staffGET(new Request(`http://localhost/api/staff/sessions?operationId=${operationId}`))).status).toBe(status);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...open, actor: 'user_admin' }, { ...open, input: { ...open.input, session_token: 'fake' } },
    { operationId, action: 'CLOSE', input: { sessionId, paymentMethod: 'CASH', expectedTotal: 100, confirmedReceived: false } },
    { operationId, action: 'TRANSFER', input: { sessionId, targetTableId: sessionId } },
  ])('rejects forged or missing fields', async (body) => { expect((await staffPOST(post(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('rejects cross Origin and >8KiB bodies before DB', async () => {
    expect((await staffPOST(post(open, { origin: 'https://attacker.test' }))).status).toBe(403);
    expect((await staffPOST(post({ padding: 'x'.repeat(8192) }))).status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lookup returns saved data only in validated current identity scope', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await (await staffGET(new Request(`http://localhost/api/staff/sessions?operationId=${operationId}`))).json()).toEqual({ data: null });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_get_session_action_operation', { p_actor_id: 'user_staff', p_session_token: null, p_session_id: null, p_operation_id: operationId });
    expect((await billGET(new Request(`http://localhost/api/customer/bill?sessionId=${sessionId}&operationId=${operationId}`, { headers: { 'x-session-token': 'test-token' } }))).status).toBe(200);
  });
  it.each([['P1301', 'TABLE_OCCUPIED'], ['P1302', 'SESSION_CHANGED'], ['P1303', 'ASSIGNEE_UNAVAILABLE'], ['P1304', 'BILL_ALREADY_REQUESTED'], ['P1305', 'UNRESOLVED_ITEMS'], ['22000', 'OPERATION_CONFLICT']])('maps business %s without SQL detail', async (code, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL' } }); const response = await staffPOST(post());
    expect(response.status).toBe(409); const body = await response.json(); expect(body.error.code).toBe(expected); expect(JSON.stringify(body)).not.toContain('private SQL');
  });
  it('exposes only a finite total quote for deliberate reconfirmation', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P1306', details: '{"totalAmount":51000,"private":"hidden"}' } });
    expect(await (await staffPOST(post())).json()).toMatchObject({ error: { code: 'BILL_CHANGED', totalAmount: 51000 } });
  });
});
