import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { isLoaded: true, user: { id: 'one' } as { id: string } | null }, register: vi.fn(), reconcile: vi.fn(), dispose: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useUser: () => mocks.user }));
vi.mock('@/lib/pwa/registration', () => ({ registerPwa: mocks.register }));
vi.mock('@/lib/pwa/push-device', () => ({ reconcilePushOwner: mocks.reconcile }));
vi.mock('@/lib/audio/notifications', () => ({ disposeSound: mocks.dispose }));
import { PwaRuntime } from '@/components/ui/PwaRuntime';
describe('Root PWA runtime account lifecycle', () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { vi.clearAllMocks(); mocks.user.isLoaded = true; mocks.user.user = { id: 'one' }; mocks.register.mockResolvedValue({}); mocks.reconcile.mockResolvedValue(undefined); vi.stubGlobal('isSecureContext', true); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });
  it('registers without permission prompts and reconciles only after Clerk has loaded', async () => {
    mocks.user.isLoaded = false; await act(async () => root.render(createElement(PwaRuntime))); expect(mocks.register).toHaveBeenCalledOnce(); expect(mocks.reconcile).not.toHaveBeenCalled();
    mocks.user.isLoaded = true; await act(async () => root.render(createElement(PwaRuntime))); expect(mocks.reconcile).toHaveBeenCalledWith('one');
  });
  it('reconciles account changes and sign-out while disposing prior audio', async () => {
    await act(async () => root.render(createElement(PwaRuntime))); mocks.dispose.mockClear(); mocks.user.user = { id: 'two' };
    await act(async () => root.render(createElement(PwaRuntime))); expect(mocks.reconcile).toHaveBeenLastCalledWith('two'); expect(mocks.dispose).toHaveBeenCalled();
    mocks.user.user = null; await act(async () => root.render(createElement(PwaRuntime))); expect(mocks.reconcile).toHaveBeenLastCalledWith(null);
  });
  it('shows an actionable warning if the previous account subscription cannot be detached', async () => {
    mocks.reconcile.mockRejectedValue(new Error('storage-disabled')); await act(async () => root.render(createElement(PwaRuntime))); expect(host.textContent).toContain('tắt thông báo của trang');
  });
});
