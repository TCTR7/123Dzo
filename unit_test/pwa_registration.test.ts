import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
describe('PWA registration lifecycle', () => {
  let registration: typeof import('@/lib/pwa/registration');
  const register = vi.fn();
  beforeEach(async () => { vi.resetModules(); vi.useFakeTimers(); register.mockReset(); vi.stubGlobal('isSecureContext', true); Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } }); registration = await import('@/lib/pwa/registration'); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });
  it('deduplicates concurrent registration and requests uncached root scope', async () => {
    const reg = { active: {} }; register.mockResolvedValue(reg);
    const [first, second] = await Promise.all([registration.registerPwa(), registration.registerPwa()]);
    expect(first).toBe(reg); expect(second).toBe(reg); expect(register).toHaveBeenCalledOnce(); expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });
  it('permits explicit retry after rejected registration', async () => {
    register.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ active: {} }); await expect(registration.registerPwa()).rejects.toThrow('offline'); await registration.registerPwa(); expect(register).toHaveBeenCalledTimes(2);
  });
  it('bounds stalled registration at twelve seconds', async () => {
    register.mockReturnValue(new Promise(() => {})); const pending = registration.registerPwa(); const assertion = expect(pending).rejects.toThrow('PWA_REGISTRATION_TIMEOUT'); await vi.advanceTimersByTimeAsync(12000); await assertion;
  });
  it('waits for activation, removes listeners and clears timeout', async () => {
    const worker = new EventTarget(), reg: { active: unknown; installing: EventTarget } = { active: null, installing: worker }; register.mockResolvedValue(reg);
    const pending = registration.activeRegistration(); await vi.advanceTimersByTimeAsync(0); reg.active = {}; worker.dispatchEvent(new Event('statechange')); expect(await pending).toBe(reg); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects insecure contexts without invoking service worker registration', async () => {
    vi.stubGlobal('isSecureContext', false); await expect(registration.registerPwa()).rejects.toThrow('PWA_UNSUPPORTED'); expect(register).not.toHaveBeenCalled();
  });
});
