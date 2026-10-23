// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
const client=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:client}));
import {POST} from '@/app/api/webhooks/payment/route';
describe('Payment entry remains closed until provider implementation',()=>{
 afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
 it.each(['development','test','production'])('cannot accept unsigned payment in %s',async(mode)=>{
  vi.stubEnv('NODE_ENV',mode);vi.stubEnv('PAYOS_CHECKSUM_KEY',undefined);vi.stubEnv('SEPAY_WEBHOOK_SECRET',undefined);
  const response=await POST(new Request('http://app/api/webhooks/payment',{method:'POST',body:'invalid or forged payment'}));
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'PAYMENT_NOT_CONFIGURED'}});expect(client).not.toHaveBeenCalled();
 });
 it('credentials alone cannot activate a provider without transactional receipts',async()=>{
  vi.stubEnv('SEPAY_WEBHOOK_SECRET','unit-only');const response=await POST(new Request('http://app/api/webhooks/payment',{method:'POST',headers:{authorization:'Apikey unit-only'},body:'{}'}));
  expect(response.status).toBe(503);expect(client).not.toHaveBeenCalled();
 });
});
