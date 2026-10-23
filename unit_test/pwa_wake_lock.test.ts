import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenWakeLock } from '@/lib/pwa/use-wake-lock';
describe('KDS wake lock lifecycle', () => {
  let root: Root, host: HTMLDivElement, visible: boolean;
  const request = vi.fn();
  const sentinel = () => { const lock = new EventTarget() as EventTarget & { released: boolean; release: ReturnType<typeof vi.fn<() => Promise<void>>> }; lock.released = false; lock.release = vi.fn(async () => { lock.released = true; lock.dispatchEvent(new Event('release')); }); return lock; };
  function Probe() { const active = useScreenWakeLock(); return createElement('p', null, String(active)); }
  beforeEach(() => { visible = true; request.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden'); Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'wakeLock'); });
  it('holds one lock across duplicate visible events, releases on hide and reacquires on return', async () => {
    const first = sentinel(), second = sentinel(); request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await act(async () => root.render(createElement(Probe))); expect(host.textContent).toBe('true');
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(request).toHaveBeenCalledOnce();
    visible = false; await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(first.release).toHaveBeenCalledOnce(); expect(host.textContent).toBe('false');
    visible = true; await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(request).toHaveBeenCalledTimes(2); expect(host.textContent).toBe('true');
    await act(async () => root.render(null)); expect(second.release).toHaveBeenCalledOnce();
  });
  it('releases a late request after unmount without leaking a sentinel', async () => {
    let resolve!: (value: unknown) => void; request.mockReturnValue(new Promise(done => { resolve = done; }));
    await act(async () => root.render(createElement(Probe))); await act(async () => root.render(null)); const late = sentinel(); await act(async () => resolve(late)); expect(late.release).toHaveBeenCalledOnce();
  });
  it('does not overlap pending requests and releases a resolution while hidden', async () => {
    let resolve!: (value: unknown) => void; request.mockReturnValue(new Promise(done => { resolve = done; }));
    await act(async () => root.render(createElement(Probe))); await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(request).toHaveBeenCalledOnce();
    visible = false; const late = sentinel(); await act(async () => resolve(late)); expect(late.release).toHaveBeenCalledOnce(); expect(host.textContent).toBe('false');
  });
  it('reflects OS release and reacquires on the next visible event', async () => {
    const first = sentinel(); request.mockResolvedValue(first); await act(async () => root.render(createElement(Probe))); await act(async () => first.release()); expect(host.textContent).toBe('false');
    request.mockResolvedValue(sentinel()); await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(host.textContent).toBe('true');
  });
  it('unsupported or rejected wake lock is nonfatal', async () => {
    request.mockRejectedValue(new Error('NotAllowedError')); await act(async () => root.render(createElement(Probe))); expect(host.textContent).toBe('false');
    await act(async () => root.render(null)); Reflect.deleteProperty(navigator, 'wakeLock'); await act(async () => root.render(createElement(Probe))); expect(host.textContent).toBe('false');
  });
});
