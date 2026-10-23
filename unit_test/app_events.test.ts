import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDatabase } from './helpers/memory-db';

const m = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), snapshot: vi.fn(), db: { current: null as unknown } }));
vi.mock('@clerk/nextjs/server', () => ({ auth: m.auth }));
vi.mock('@/lib/auth/roles', () => ({ resolveStaffProfile: m.profile }));
vi.mock('@/lib/services/snapshots', () => ({ readSnapshot: m.snapshot }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => m.db.current }));
import { GET } from '@/app/api/events/route';

beforeEach(() => {
  vi.useFakeTimers(); m.auth.mockResolvedValue({ userId: 'user_staff' });
  m.profile.mockResolvedValue({ id: 'user_staff', role: 'staff', is_active: true });
  m.snapshot.mockResolvedValue({ orders: [], alerts: [] });
  m.db.current = memoryDatabase({ staff_profiles: [{ id: 'user_staff', role: 'staff', is_active: true }] });
});
afterEach(() => { vi.useRealTimers(); });

describe('Backend -> frontend SSE', () => {
  it('denies a caller without a profile or customer token', async () => {
    m.auth.mockResolvedValue({ userId: null });
    expect((await GET(new Request('https://pub.example/api/events'))).status).toBe(401);
    expect(m.snapshot).not.toHaveBeenCalled();
  });
  it('pushes snapshots, detects updates and clears the timer when cancelled', async () => {
    const response = await GET(new Request('https://pub.example/api/events'));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader(); const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('data:');
    m.snapshot.mockResolvedValue({ orders: [{ id: 'ready' }], alerts: [{ id: 'ready' }] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(decoder.decode((await reader.read()).value)).toContain('ready');
    await reader.cancel(); const calls = m.snapshot.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000); expect(m.snapshot).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps token-scoped reads scoped even when an admin is signed in', async () => {
    const response = await GET(new Request('https://pub.example/api/events?token=customer-secret'));
    expect(m.profile).not.toHaveBeenCalled(); expect(m.snapshot).toHaveBeenCalledWith(null, 'customer-secret', undefined);
    await response.body!.cancel();
  });
  it('closes an active stream after a staff account is disabled', async () => {
    const db = memoryDatabase({ staff_profiles: [{ id: 'user_staff', is_active: true }] }); m.db.current = db;
    const response = await GET(new Request('https://pub.example/api/events')); const reader = response.body!.getReader();
    await reader.read(); db.data.staff_profiles[0].is_active = false;
    await vi.advanceTimersByTimeAsync(3000); expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ends connections before the serverless duration limit without leaving a timer', async () => {
    const response = await GET(new Request('https://pub.example/api/events')); const reader = response.body!.getReader(); await reader.read();
    await vi.advanceTimersByTimeAsync(25000);
    while (!(await reader.read()).done) { /* drain heartbeats */ }
    expect(vi.getTimerCount()).toBe(0);
  });
});
