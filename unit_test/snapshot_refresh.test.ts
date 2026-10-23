import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { result as order, sessionId, line } from './order_fixtures';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), router: { refresh: vi.fn() }, live: vi.fn(), stopLive: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/realtime/invalidation', () => ({ subscribeInvalidations: mocks.live }));
import { useDineInSnapshot } from '@/lib/data/use-dine-in-snapshot';
import { useServerRefresh } from '@/lib/data/use-server-refresh';

const value = { session: { id: sessionId, status: 'ACTIVE', payment_method: null }, table: null, zone: null,
  menu: [{ id: line.menu_item_id, name: 'Food', category: 'FOOD', station: 'KITCHEN', price: 100, prep_time_minutes: 10, image_url: null, is_available: true }],
  items: order.items, queuePositions: Object.fromEntries(order.items.map(item => [item.id, 2])) };

describe('Protected snapshot refresh lifecycle', () => {
  let root: Root, host: HTMLDivElement;
  const fetchMock = vi.fn(), received = vi.fn();
  let visible = true, online = true;
  function Guest() { const state = useDineInSnapshot('capability', received); return createElement('p', null, `${state.unavailable}:${state.expired}`); }
  function Staff() { useServerRefresh(); return null; }
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); fetchMock.mockReset(); visible = true; online = true;
    mocks.live.mockReturnValue(mocks.stopLive);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  it('never overlaps guest reads and aborts the request on unmount', async () => {
    fetchMock.mockReturnValue(new Promise(() => {})); await act(async () => root.render(createElement(Guest)));
    await tick(10000); await tick(10000); expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ 'x-session-token': 'capability' }); expect(init.cache).toBe('no-store');
    await act(async () => root.render(null)); expect(init.signal?.aborted).toBe(true); await tick(30000); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('pauses hidden/offline guest reads and refreshes on reconnect', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: value })));
    await act(async () => root.render(createElement(Guest))); visible = false; await tick(10000); expect(fetchMock).not.toHaveBeenCalled();
    visible = true; online = false; await tick(10000); expect(fetchMock).not.toHaveBeenCalled();
    online = true; await act(async () => window.dispatchEvent(new Event('online'))); expect(fetchMock).toHaveBeenCalledOnce(); expect(received).toHaveBeenCalledOnce();
  });
  it('marks network failure explicitly and recovers only with a valid snapshot', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')); await act(async () => root.render(createElement(Guest))); await tick(10000);
    expect(host.textContent).toBe('true:false'); expect(received).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: value }))); await tick(10000);
    expect(host.textContent).toBe('false:false'); expect(received).toHaveBeenCalledOnce();
  });
  it('treats a revoked token as expired and stops further reads', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 })); await act(async () => root.render(createElement(Guest))); await tick(10000);
    expect(host.textContent).toBe('false:true'); await tick(30000); expect(fetchMock).toHaveBeenCalledOnce(); expect(received).not.toHaveBeenCalled();
  });
  it('aborts stalled reads at 12 seconds and reports unavailable', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('abort')))));
    await act(async () => root.render(createElement(Guest))); await tick(22000); expect(host.textContent).toBe('true:false');
  });
  it('shows offline immediately without discarding the previous snapshot', async () => {
    online = false; await act(async () => root.render(createElement(Guest))); expect(host.textContent).toBe('true:false'); expect(received).not.toHaveBeenCalled();
  });
  it('refreshes guarded SSR only while visible/online and cleans up all triggers', async () => {
    await act(async () => root.render(createElement(Staff))); await tick(15000); expect(mocks.router.refresh).toHaveBeenCalledOnce();
    visible = false; await tick(15000); expect(mocks.router.refresh).toHaveBeenCalledOnce();
    visible = true; online = false; await tick(15000); expect(mocks.router.refresh).toHaveBeenCalledOnce();
    online = true; await act(async () => window.dispatchEvent(new Event('online'))); expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null)); await tick(30000); await act(async () => window.dispatchEvent(new Event('focus'))); expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
  });
  it('refetches again after an invalidation during an in-flight read; never overlaps', async () => {
    let done!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { done = resolve; })).mockResolvedValue(new Response(JSON.stringify({data:value})));
    await act(async () => root.render(createElement(Guest)));
    const invalidate = mocks.live.mock.calls[0][1] as () => void;
    await act(async () => invalidate()); await act(async () => { invalidate(); invalidate(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => done(new Response(JSON.stringify({data:value}))));
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(received).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null)); expect(mocks.stopLive).toHaveBeenCalledOnce();
  });
});
