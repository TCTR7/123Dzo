import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ sound: vi.fn() }));
vi.mock('@/lib/utils', () => ({ playNotificationSound: m.sound }));
import { useAppEvents } from '@/lib/use-app-events';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  send(alerts: { id: string; message: string }[]) { this.onmessage?.({ data: JSON.stringify({ alerts, orders: [], sessions: [], menu: [], queue: [], tables: [], ingredients: [] }) }); }
}
let root: Root; let container: HTMLDivElement;
const receive = vi.fn();
function View({ token }: { token?: string }) {
  const live = useAppEvents(receive, { token, sound: true });
  return createElement('p', {}, `${live.connected}:${live.alerts.length}`);
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = []; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('In-app SSE client', () => {
  it('updates the UI, reconnects without duplicate bells, then closes on unmount', async () => {
    await act(() => root.render(createElement(View)));
    const source = FakeEventSource.instances[0];
    await act(() => source.send([{ id: 'item:ready', message: 'Ready' }]));
    expect(container.textContent).toBe('true:1'); expect(m.sound).toHaveBeenCalledTimes(1);
    await act(() => source.onerror?.()); expect(container.textContent).toBe('false:1');
    await act(() => source.send([{ id: 'item:ready', message: 'Ready' }]));
    expect(m.sound).toHaveBeenCalledTimes(1);
    await act(() => source.send([{ id: 'item:overdue', message: 'Overdue' }]));
    expect(m.sound).toHaveBeenCalledTimes(2);
    await act(() => root.render(null)); expect(source.close).toHaveBeenCalledOnce();
  });
  it('closes the old customer stream and uses only the new token when switching sessions', async () => {
    await act(() => root.render(createElement(View, { token: 'first-token' })));
    const source = FakeEventSource.instances[0];
    await act(() => root.render(createElement(View, { token: 'second-token' })));
    expect(source.close).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances[1].url).toBe('/api/events?token=second-token');
  });
});
