// @vitest-environment node
import { createECDH } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { parsePushSubscription, validPushEndpoint } from '@/lib/notifications/subscription';
import { createPushTransport } from '@/lib/notifications/transport';
const server=createECDH('prime256v1');server.generateKeys();const device=createECDH('prime256v1');device.generateKeys();
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/unit-only',keys:{auth:Buffer.alloc(16,1).toString('base64url'),p256dh:device.getPublicKey().toString('base64url')}};
describe('Push transport validates addresses and real Web Push encryption',()=>{
  const fetchMock=vi.fn();
  beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset().mockResolvedValue(new Response(null,{status:201}));vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY',server.getPublicKey().toString('base64url'));vi.stubEnv('VAPID_PRIVATE_KEY',server.getPrivateKey().toString('base64url'));vi.stubEnv('VAPID_SUBJECT','mailto:unit@restaurant.test');});
  it.each(['http://127.0.0.1/admin','https://localhost','https://169.254.169.254/','https://fcm.googleapis.com.attacker.test/','https://fcm.googleapis.com:444/','https://user:pw@fcm.googleapis.com/','https://fcm.googleapis.com/#fragment','https://other.example.test/'])('rejects SSRF endpoint %s',url=>{expect(validPushEndpoint(url)).toBe(false);expect(parsePushSubscription({...sub,endpoint:url})).toBeNull();});
  it.each(['https://fcm.googleapis.com/a','https://updates.push.services.mozilla.com/a','https://web.push.apple.com/a','https://wns2.notify.windows.com/a'])('accepts provider %s',url=>expect(validPushEndpoint(url)).toBe(true));
  it('validates actual P-256 keys and strips unexpected fields',()=>{
    expect(parsePushSubscription({...sub,private:'ignored'})).toEqual(sub);expect(parsePushSubscription({...sub,keys:{...sub.keys,auth:'bad'}})).toBeNull();
    expect(parsePushSubscription({...sub,keys:{...sub.keys,p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url')}})).toBeNull();
  });
  it('uses encrypted payload, stable tag, no redirects and a whole-request timeout',async()=>{
    expect(await createPushTransport()(sub,'ORDER_READY','notification-test')).toBe(201); const [url,init]=fetchMock.mock.calls[0];
    expect(url).toBe(sub.endpoint);expect(init.redirect).toBe('error');expect(init.signal).toBeInstanceOf(AbortSignal);expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(init.body).toString()).not.toContain('Mở ứng dụng');expect(init.headers['Content-Encoding']).toBe('aes128gcm');
  });
  it('fails before network when VAPID keys do not match',()=>{vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY',device.getPublicKey().toString('base64url'));expect(()=>createPushTransport()).toThrow('VAPID_CONFIGURATION_INVALID');expect(fetchMock).not.toHaveBeenCalled();});
});
