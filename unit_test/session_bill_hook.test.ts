import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionBill } from '@/lib/sessions/use-session-bill';
import { result } from './order_fixtures';
const first = { sessionId: result.sessionId, status: 'ACTIVE', totalAmount: 100, closedAt: null, items: result.items };
function Probe({ id }: { id: string }) { const state = useSessionBill(id, 'stable'); return createElement('output', null, JSON.stringify(state)); }
describe('Bill read request lifecycle', () => {
  let root: Root, container: HTMLDivElement;
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch',fetchMock); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); container = document.createElement('div'); document.body.append(container); root=createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('ignores an old response after switching session and aborts its request', async () => {
    let resolveFirst!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((done) => { resolveFirst=done; }));
    await act(async () => root.render(createElement(Probe,{id:first.sessionId})));
    const secondId='10000000-0000-4000-8000-000000000002';
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{...first,sessionId:secondId,items:[],totalAmount:0}})));
    await act(async () => root.render(createElement(Probe,{id:secondId})));
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolveFirst(new Response(JSON.stringify({data:first}))));
    expect(container.textContent).toContain(secondId); expect(container.textContent).not.toContain(first.sessionId);
  });
  it('timeout produces an error instead of a fake empty successful bill', async () => {
    vi.useFakeTimers(); fetchMock.mockImplementation((_url: string,init: RequestInit) => new Promise((_resolve,reject) => init.signal?.addEventListener('abort',()=>reject(new Error('Abort')))));
    await act(async () => root.render(createElement(Probe,{id:first.sessionId})));
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    const state=JSON.parse(container.textContent!); expect(state.data).toBeNull(); expect(state.error).toContain('Chưa tải đủ'); expect(state.loading).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
});
