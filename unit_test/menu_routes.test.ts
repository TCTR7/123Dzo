// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { journal, operationId, item, result, menu } from './menu_fixtures';
import { menuFields, parseMenuRequest } from '@/lib/menu/contracts';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/sync-staff', () => ({ getCurrentStaffAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
import { POST, GET } from '@/app/api/staff/menu-actions/route';
function post(body: unknown = journal, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/staff/menu-actions', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function lookup() { return new Request(`http://localhost/api/staff/menu-actions?operationId=${operationId}`); }
const create = { ...journal, action: 'CREATE', item, expected: null };
describe('Menu API and strict contracts', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_kitchen', role: 'kitchen', isActive: true } }); mocks.rpc.mockResolvedValue({ data: result, error: null }); });
  it('uses guard identity, narrow availability command and projected no-store result', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result, cost_price: 10, actor: 'secret' }, error: null });
    const response = await POST(post()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.json()).toEqual({ data: result });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_menu_action', { p_actor_id: 'user_kitchen', p_operation_id: operationId, p_command: { action: journal.action, id: journal.id, item: journal.item, expected: journal.expected } });
  });
  it('admin can submit full metadata while kitchen cannot', async () => {
    expect((await POST(post(create))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ status: 'authorized', staff: { userId: 'user_admin', role: 'admin', isActive: true } });
    mocks.rpc.mockResolvedValue({ data: { ...result, action: 'CREATE' }, error: null }); expect((await POST(post(create))).status).toBe(200);
  });
  it.each([[{ status: 'unauthenticated' }, 401], [{ status: 'forbidden' }, 403], [{ status: 'unavailable' }, 503],
    [{ status: 'authorized', staff: { userId: 'user_staff', role: 'staff', isActive: true } }, 403]])('denies missing/forbidden/unavailable or staff access', async (access, status) => {
    mocks.access.mockResolvedValue(access); expect((await POST(post())).status).toBe(status); expect((await GET(lookup())).status).toBe(status); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...journal, actorId: 'user_admin' }, { ...journal, id: 'invalid' }, { ...journal, expected: {} },
    { ...journal, item: { is_available: false, price: 0 } }, { ...journal, action: 'DELETE', item: null, expected: null },
    { ...create, item: { ...item, served_at: 'spoof' } }, { ...create, expected: item }])('rejects unknown fields, action payloads and forged actor', async (body) => {
    expect((await POST(post(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ price: -1 }, { price: 1.001 }, { cost_price: Infinity }, { price: 1e13 }, { name: ' ' }, { name: 'x'.repeat(121) },
    { category: 'UNKNOWN' }, { station: 'BAR' }, { prep_time_minutes: 0.5 }, { prep_time_minutes: 1441 }, { is_available: 1 },
    { image_url: 'javascript:alert(1)' }, { image_url: 'https://bad url' }, { linked_ingredient_id: menu.id }])('bounds metadata %#', (change) => {
    expect(menuFields({ ...item, ...change })).toBeNull();
  });
  it('accepts decimal money and one-unit non-food inventory mapping', () => {
    const payload = { ...item, price: 100.10, category: 'BEER', station: 'BAR_INSTANT', linked_ingredient_id: menu.id, image_url: 'https://example.test/menu.webp' };
    expect(menuFields(payload)).toEqual(payload);
    expect(parseMenuRequest({ ...create, id: menu.id.toUpperCase(), item: payload })).toMatchObject({ id: menu.id });
  });
  it('rejects cross-Origin and bounds actual body bytes before DB', async () => {
    expect((await POST(post(journal, { origin: 'https://attacker.test' }))).status).toBe(403);
    expect((await POST(post({ padding: 'x'.repeat(16384) }))).status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([['42501', 403, 'FORBIDDEN'], ['P1501', 409, 'MENU_NOT_FOUND'], ['P1502', 409, 'MENU_CHANGED'], ['P1503', 409, 'MENU_HISTORY'],
    ['23503', 409, 'INVALID_MENU_REFERENCE'], ['23505', 409, 'MENU_EXISTS'], ['P1703', 409, 'MENU_IMAGE_NOT_READY'], ['22023', 400, 'INVALID_MENU_ACTION'],
    ['22000', 409, 'OPERATION_CONFLICT'], ['55P03', 503, 'MENU_ACTION_UNAVAILABLE']])('maps SQL %s without leaking internals', async (code, status, name) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private SQL' } }); const response = await POST(post()); expect(response.status).toBe(status);
    const body = await response.json(); expect(body.error.code).toBe(name); expect(JSON.stringify(body)).not.toContain('private SQL');
  });
  it('lookup is actor scoped and does not create an operation', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await (await GET(lookup())).json()).toEqual({ data: null });
    expect(mocks.rpc).toHaveBeenCalledWith('fn_get_menu_action_operation', { p_actor_id: 'user_kitchen', p_operation_id: operationId });
  });
  it('retains ambiguity for wrong IDs or action returned by dependency', async () => {
    for (const data of [{ ...result, menuItemId: operationId }, { ...result, action: 'CREATE' }, {}, { ...result, operationId: menu.id }]) {
      mocks.rpc.mockResolvedValue({ data, error: null }); expect((await POST(post())).status).toBe(503);
    }
  });
});
