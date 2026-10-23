import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), existing: vi.fn(), upsert: vi.fn(), saved: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: async () => ({ users: { getUserList: m.list, createUser: m.create, updateUser: m.update, deleteUser: m.remove } }) }));
vi.mock('@/lib/auth/roles', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/auth/roles')>(), getCurrentStaffProfile: m.actor }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.existing }) }), upsert: m.upsert }) }) }));
import { POST } from '@/app/api/accounts/provision/route';

const request = (input: Record<string, unknown> = {}) => new Request('https://pub.example/api/accounts/provision', { method: 'POST', body: JSON.stringify({ fullName: 'Nhân viên', username: 'nhanvien', password: 'initial123', role: 'staff', ...input }) });
beforeEach(() => {
  vi.stubEnv('OPERATOR_EMAILS', ''); vi.stubEnv('OPERATOR_CLERK_USER_IDS', ''); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pub.example');
  m.actor.mockResolvedValue({ id: 'actor', role: 'admin' });
  m.list.mockResolvedValue({ data: [] });
  m.create.mockResolvedValue({ id: 'user_new' }); m.update.mockResolvedValue({ id: 'user_existing' });
  m.remove.mockResolvedValue({}); m.existing.mockResolvedValue({ data: null, error: null });
  m.upsert.mockReturnValue({ select: () => ({ single: m.saved }) });
  m.saved.mockResolvedValue({ data: { id: 'user_new', role: 'staff' }, error: null });
});
describe('Account provisioning', () => {
  it.each(['staff', 'kitchen', null])('rejects a non-manager caller (%s)', async (role) => {
    m.actor.mockResolvedValue(role ? { id: 'actor', role } : null);
    expect((await POST(request())).status).toBe(403); expect(m.create).not.toHaveBeenCalled();
  });
  it.each(['admin', 'operator'])('prevents admin from granting %s', async (role) => {
    expect((await POST(request({ role }))).status).toBe(403); expect(m.list).not.toHaveBeenCalled();
  });
  it('prevents admin provisioning a reserved operator email', async () => {
    vi.stubEnv('OPERATOR_EMAILS', 'deploy@example.com');
    expect((await POST(request({ emailAddress: 'deploy@example.com' }))).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('creates a login, synchronizes the profile and returns usable credentials', async () => {
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ username: 'nhanvien', password: 'initial123' }));
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'user_new', role: 'staff', is_active: true, assigned_zone_id: null }), { onConflict: 'id' });
    expect(body.credentials).toEqual({ loginIdentifier: 'nhanvien', password: 'initial123', loginUrl: 'https://pub.example/staff' });
  });
  it('allows an operator to create an admin', async () => {
    m.actor.mockResolvedValue({ id: 'actor', role: 'operator' });
    expect((await POST(request({ role: 'admin' }))).status).toBe(200);
  });
  it('does not reset an existing higher-privilege account password', async () => {
    m.list.mockResolvedValue({ data: [{ id: 'user_existing', username: 'nhanvien', emailAddresses: [] }] });
    m.existing.mockResolvedValue({ data: { role: 'operator' }, error: null });
    expect((await POST(request())).status).toBe(403); expect(m.update).not.toHaveBeenCalled();
  });
  it('reuses an existing manageable Clerk user', async () => {
    m.list.mockResolvedValue({ data: [{ id: 'user_existing', username: 'nhanvien', emailAddresses: [] }] });
    m.existing.mockResolvedValue({ data: { role: 'staff' }, error: null });
    expect((await POST(request())).status).toBe(200); expect(m.create).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith('user_existing', expect.objectContaining({ password: 'initial123' }));
  });
  it('removes a new Clerk login when profile synchronization fails', async () => {
    m.saved.mockResolvedValue({ error: { message: 'offline' }, data: null });
    expect((await POST(request())).status).toBe(502); expect(m.remove).toHaveBeenCalledWith('user_new');
  });
});
