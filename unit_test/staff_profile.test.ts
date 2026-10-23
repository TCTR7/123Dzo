// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editableStaffProfile, parseSaveStaffRequest, parseStaffProfile, saveStaffProfile, type StaffProfileEditable } from '@/lib/auth/staff-profile';

const profile: StaffProfileEditable = { id: 'user_staff', full_name: 'Test staff', role: 'staff', assigned_zone_id: null, is_active: true };

describe('Staff profile validation and browser API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trims desired names but preserves the exact expected snapshot', () => {
    const spaced = { ...profile, full_name: ' Test staff ' };
    expect(parseSaveStaffRequest({ action: 'update', profile: spaced, expected: spaced })).toEqual({
      action: 'update', profile, expected: spaced,
    });
  });

  it.each(['', 'not-a-clerk-id', 'user_!'])('rejects invalid Clerk ID %s', (id) => {
    expect(parseStaffProfile({ ...profile, id })).toBeNull();
  });

  it.each(['', ' '.repeat(3), 'a'.repeat(121)])('rejects invalid names', (full_name) => {
    expect(parseStaffProfile({ ...profile, full_name })).toBeNull();
  });

  it('projects only editable fields for both desired and expected, never subscription keys', async () => {
    const withSecret = { ...profile, push_subscription: { keys: { auth: 'test-private-key' } } };
    expect(editableStaffProfile(withSecret)).toEqual(profile);
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: profile })));
    vi.stubGlobal('fetch', mockFetch);
    expect(await saveStaffProfile(withSecret, withSecret)).toEqual(profile);
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ action: 'update', profile, expected: profile });
    expect(init.body).not.toContain('test-private-key');
  });

  it('reports a server conflict rather than returning a fabricated saved profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Profile changed' } }), { status: 409 })));
    await expect(saveStaffProfile(profile, profile)).rejects.toThrow('Profile changed');
  });

  it('rejects a malformed success response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'user_staff' } }))));
    await expect(saveStaffProfile(profile, profile)).rejects.toThrow();
  });

  it('propagates unknown network outcome without automatically resubmitting', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);
    await expect(saveStaffProfile(profile, null)).rejects.toThrow('Chưa xác nhận được kết quả');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
