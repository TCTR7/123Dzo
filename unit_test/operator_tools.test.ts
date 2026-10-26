import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ actor: vi.fn(), from: vi.fn(), zones: vi.fn(), tableCount: vi.fn(), menuCount: vi.fn(), insertZones: vi.fn(), insertTables: vi.fn(), insertMenu: vi.fn(), deleteSessions: vi.fn(), updateTables: vi.fn(), availableTables: vi.fn() }));
vi.mock('@/lib/auth/roles', () => ({ getCurrentStaffProfile: m.actor }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => ({ from: m.from }) }));
import { POST } from '@/app/api/operator/tools/route';
const request = (action: string, confirmation?: string) => new Request('https://pub.example/api/operator/tools', { method: 'POST', body: JSON.stringify({ action, confirmation }) });

beforeEach(() => {
  m.actor.mockResolvedValue({ role: 'operator' });
  m.zones.mockResolvedValue({ data: [], error: null });
  m.tableCount.mockResolvedValue({ count: 0, error: null }); m.menuCount.mockResolvedValue({ count: 0, error: null });
  m.insertZones.mockReturnValue({ select: async () => ({ data: [{ id: 'zone1' }, { id: 'zone2' }], error: null }) });
  m.insertTables.mockReturnValue({ select: async () => ({ data: [{ id: 'table1' }], error: null }) });
  m.insertMenu.mockResolvedValue({ error: null }); m.deleteSessions.mockResolvedValue({ error: null });
  m.availableTables.mockResolvedValue({ error: null }); m.updateTables.mockReturnValue({ not: m.availableTables });
  m.from.mockImplementation((table: string) => {
    if (table === 'zones') return { select: m.zones, insert: m.insertZones };
    if (table === 'tables') return { select: m.tableCount, insert: m.insertTables, update: m.updateTables };
    if (table === 'menu_items') return { select: m.menuCount, insert: m.insertMenu };
    if (table === 'table_sessions') return { delete: () => ({ not: m.deleteSessions }) };
    throw new Error(`Unexpected table: ${table}`);
  });
});
describe('Operator handover tools', () => {
  it.each(['admin', 'staff', 'kitchen', null])('blocks non-operator %s before touching data', async (role) => {
    m.actor.mockResolvedValue(role ? { role } : null);
    expect((await POST(request('reset', 'XOA HOA DON TEST'))).status).toBe(403);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('requires explicit reset confirmation', async () => {
    expect((await POST(request('reset'))).status).toBe(400); expect(m.deleteSessions).not.toHaveBeenCalled();
  });
  it('deletes sessions with database cascade and frees tables without touching inventory', async () => {
    expect((await POST(request('reset', 'XOA HOA DON TEST'))).status).toBe(200);
    expect(m.deleteSessions).toHaveBeenCalled();
    expect(m.updateTables).toHaveBeenCalledWith({ status: 'AVAILABLE', current_session_id: null });
    expect(m.from.mock.calls.map(([table]) => table)).toEqual(['table_sessions', 'tables']);
  });
  it('does not free tables if deletion failed', async () => {
    m.deleteSessions.mockResolvedValue({ error: { message: 'offline' } });
    expect((await POST(request('reset', 'XOA HOA DON TEST'))).status).toBe(500);
    expect(m.updateTables).not.toHaveBeenCalled();
  });
  it('creates one hidden compatibility zone, six tables and six menu items for an empty shop', async () => {
    expect((await POST(request('seed'))).status).toBe(200);
    expect(m.insertZones.mock.calls[0][0]).toHaveLength(1);
    expect(m.insertTables.mock.calls[0][0]).toHaveLength(6);
    expect(m.insertMenu.mock.calls[0][0]).toHaveLength(6);
  });
  it('does not duplicate or overwrite existing sample/business data', async () => {
    m.tableCount.mockResolvedValue({ count: 6, error: null });
    expect((await POST(request('seed'))).status).toBe(409);
    expect(m.insertZones).not.toHaveBeenCalled(); expect(m.insertTables).not.toHaveBeenCalled(); expect(m.insertMenu).not.toHaveBeenCalled();
  });
});
