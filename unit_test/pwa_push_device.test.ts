import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createECDH } from 'node:crypto';
const mocks = vi.hoisted(() => ({ active: vi.fn(), register: vi.fn() }));
vi.mock('@/lib/pwa/registration', () => ({ activeRegistration: mocks.active, registerPwa: mocks.register }));
const key = createECDH('prime256v1'); key.generateKeys();
const vapid = key.getPublicKey().toString('base64url');
describe('Device push opt-in and account isolation', () => {
  let device: typeof import('@/lib/pwa/push-device'), existing: ReturnType<typeof subscription> | null;
  const fetchMock = vi.fn(), requestPermission = vi.fn(), subscribe = vi.fn(), getSubscription = vi.fn(), close = vi.fn();
  function subscription() { return { endpoint: 'https://fcm.googleapis.com/fcm/send/device', options: { applicationServerKey: Uint8Array.from(key.getPublicKey()).buffer },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/device', keys: { auth: 'unit', p256dh: 'unit' } }), unsubscribe: vi.fn(async () => { existing = null; return true; }) }; }
  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); existing = null;
    vi.stubGlobal('isSecureContext', true); vi.stubGlobal('PushManager', function () {});
    vi.stubGlobal('Notification', { permission: 'default', requestPermission }); vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
    requestPermission.mockReset().mockResolvedValue('granted'); fetchMock.mockReset().mockResolvedValue(new Response('{}'));
    subscribe.mockReset().mockImplementation(async () => { existing = subscription(); return existing; });
    getSubscription.mockReset().mockImplementation(async () => existing);
    const reg = { pushManager: { getSubscription, subscribe }, getNotifications: vi.fn(async () => [{ close }]) };
    mocks.active.mockReset().mockResolvedValue(reg); mocks.register.mockReset().mockResolvedValue(reg);
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', vapid);
    device = await import('@/lib/pwa/push-device');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); Reflect.deleteProperty(navigator, 'serviceWorker'); });
  it('requests permission directly from enable, never on initialization/reconcile', async () => {
    await device.reconcilePushOwner('user_one'); expect(requestPermission).not.toHaveBeenCalled();
    const pending = device.enableDevicePush('user_one'); expect(requestPermission).toHaveBeenCalledOnce(); await pending;
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ staffId: 'user_one', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/device' } });
    expect(localStorage.getItem('123dzo-push-owner')).toBe('user_one');
    expect(vi.mocked(localStorage.setItem).mock.calls.some(([name]) => name.includes('subscription'))).toBe(false);
  });
  it('denied permission never subscribes or writes server state', async () => {
    requestPermission.mockResolvedValue('denied'); await expect(device.enableDevicePush('user_one')).rejects.toThrow('Chưa được cấp quyền'); expect(subscribe).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not prompt when VAPID is missing or insecure', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', ''); await expect(device.enableDevicePush('user_one')).rejects.toThrow('cấu hình');
    vi.stubGlobal('isSecureContext', false); await expect(device.enableDevicePush('user_one')).rejects.toThrow('chưa hỗ trợ'); expect(requestPermission).not.toHaveBeenCalled();
  });
  it('reuses and explicitly re-registers an owned subscription', async () => {
    existing = subscription(); existing.options.applicationServerKey = Uint8Array.from(key.getPublicKey()).buffer;
    localStorage.setItem('123dzo-push-owner', 'user_one'); await device.enableDevicePush('user_one'); expect(subscribe).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('never reports a failed server confirmation as enabled', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 })); await expect(device.enableDevicePush('user_one')).rejects.toThrow('Chưa xác nhận'); expect(localStorage.getItem('123dzo-push-owner')).toBe('user_one');
  });
  it('unsubscribes locally first and retries uncertain server removal', async () => {
    existing = subscription(); const old = existing; localStorage.setItem('123dzo-push-owner', 'user_one');
    fetchMock.mockImplementationOnce(async () => { expect(old.unsubscribe).toHaveBeenCalledOnce(); throw new Error('offline'); });
    expect(await device.disableDevicePush('user_one')).toBe(false); expect(localStorage.getItem('123dzo-push-owner')).toBeNull(); expect(close).toHaveBeenCalled();
    expect(await device.disableDevicePush('user_one')).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ staffId: 'user_one', endpoint: old.endpoint });
  });
  it('detaches mismatched subscriptions and displayed notifications on account change', async () => {
    existing = subscription(); const old = existing; localStorage.setItem('123dzo-push-owner', 'old_user');
    await device.reconcilePushOwner('new_user'); expect(old.unsubscribe).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('detaches on sign-out but keeps an owned device silent on ordinary login', async () => {
    existing = subscription(); const old = existing; localStorage.setItem('123dzo-push-owner', 'user_one');
    await device.reconcilePushOwner('user_one'); expect(old.unsubscribe).not.toHaveBeenCalled(); await device.reconcilePushOwner(null); expect(old.unsubscribe).toHaveBeenCalledOnce(); expect(requestPermission).not.toHaveBeenCalled();
  });
  it('does not save an in-flight opt-in after the account changes', async () => {
    let resolve!: (value: NotificationPermission) => void; requestPermission.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await device.reconcilePushOwner('user_one'); const pending = device.enableDevicePush('user_one'); const assertion = expect(pending).rejects.toThrow('Tài khoản đã thay đổi');
    await device.reconcilePushOwner('user_two'); resolve('granted'); await assertion; expect(fetchMock).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('does not replace a device whose local unsubscribe failed', async () => {
    existing = subscription(); existing.unsubscribe.mockResolvedValue(false); localStorage.setItem('123dzo-push-owner', 'old_user');
    await expect(device.enableDevicePush('user_one')).rejects.toThrow('Chưa gỡ'); expect(fetchMock).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('detaches a late subscription created after a concurrent sign-out', async () => {
    let resolve!: (value: ReturnType<typeof subscription>) => void;
    subscribe.mockReturnValue(new Promise(done => { resolve = done; })); await device.reconcilePushOwner('user_one');
    const pending = device.enableDevicePush('user_one'); const assertion = expect(pending).rejects.toThrow('Tài khoản đã thay đổi');
    for (let n = 0; n < 8; n++) await Promise.resolve(); expect(subscribe).toHaveBeenCalledOnce();
    await device.reconcilePushOwner(null); const late = subscription(); resolve(late); await assertion; expect(late.unsubscribe).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
  });
});
