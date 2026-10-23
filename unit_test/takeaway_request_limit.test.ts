// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/server';
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:vi.fn()}));
import {claimTakeawayRequest,takeawayRequestIdentity,takeawayRequestGateConfigured} from '@/lib/takeaway/request-limit';
const hashSecret='fixture-hash-secret-32-characters-minimum',proxySecret='fixture-proxy-secret-32-characters-minimum';
const req=(ip='192.0.2.1',headers:Record<string,string>={})=>new Request('https://fixture.invalid/api/customer/takeaway',{headers:{'x-dzo-proxy-secret':proxySecret,'x-dzo-client-ip':ip,...headers}});
describe('Trusted request identity and bounded durable gate',()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));vi.stubEnv('TAKEAWAY_REQUEST_SOURCE','proxy');vi.stubEnv('TAKEAWAY_RATE_LIMIT_SECRET',hashSecret);vi.stubEnv('TAKEAWAY_PROXY_SECRET',proxySecret);for(const k of ['NETWORK_MINUTE','NETWORK_HOUR','GLOBAL_MINUTE','GLOBAL_HOUR'])vi.stubEnv('TAKEAWAY_RATE_'+k,'');});
 afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.resetAllMocks();});
 it('uses a secret daily fingerprint and never returns the IP or secret',()=>{
  const identity=takeawayRequestIdentity(req());expect(identity).toEqual({p_fingerprint:createHmac('sha256',hashSecret).update('takeaway:2026-10-23:192.0.2.1').digest('hex'),p_network_minute:10,p_network_hour:120,p_global_minute:60,p_global_hour:600});expect(JSON.stringify(identity)).not.toContain('192.0.2.1');expect(JSON.stringify(identity)).not.toContain(hashSecret);vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));expect(takeawayRequestIdentity(req()).p_fingerprint).not.toBe(identity.p_fingerprint);
 });
 it('ignores arbitrary forwarded headers and unifies mapped IPv4/IPv6 notation',()=>{
  const expected=takeawayRequestIdentity(req()).p_fingerprint;expect(takeawayRequestIdentity(req('192.0.2.1',{'x-forwarded-for':'10.2.3.4','forwarded':'for=spoof'})).p_fingerprint).toBe(expected);expect(takeawayRequestIdentity(req('::ffff:192.0.2.1')).p_fingerprint).toBe(expected);expect(takeawayRequestIdentity(req('::ffff:c000:201')).p_fingerprint).toBe(expected);
 });
 it('normalizes equivalent IPv6 addresses and groups /64, not an entire ISP',()=>{
  const a=takeawayRequestIdentity(req('2001:db8:1:2::1')).p_fingerprint;expect(takeawayRequestIdentity(req('2001:0DB8:0001:0002:0000:0000:1234:abcd')).p_fingerprint).toBe(a);expect(takeawayRequestIdentity(req('2001:db8:1:3::1')).p_fingerprint).not.toBe(a);
 });
 it.each(['','192.0.2.1, 192.0.2.2','192.0.2.1:80','unknown','fe80::1%eth0','not-an-ip'])('rejects missing or ambiguous IP %s',ip=>expect(()=>takeawayRequestIdentity(req(ip))).toThrow('unavailable'));
 it.each(['','short','x'.repeat(257)])('requires bounded server secrets and a verified ingress credential',value=>{expect(()=>takeawayRequestIdentity(req('192.0.2.1',{'x-dzo-proxy-secret':value}))).toThrow('unavailable');vi.stubEnv('TAKEAWAY_RATE_LIMIT_SECRET',value);expect(takeawayRequestGateConfigured()).toBe(false);});
 it('trusts the Vercel header only with explicit platform configuration',()=>{
  vi.stubEnv('TAKEAWAY_REQUEST_SOURCE','vercel');vi.stubEnv('VERCEL','');expect(takeawayRequestGateConfigured()).toBe(false);expect(()=>takeawayRequestIdentity(req())).toThrow();vi.stubEnv('VERCEL','1');expect(takeawayRequestGateConfigured()).toBe(true);expect(()=>takeawayRequestIdentity(req())).toThrow();expect(takeawayRequestIdentity(req('',{'x-vercel-forwarded-for':'192.0.2.1','x-forwarded-for':'spoof'})).p_fingerprint).toBe(takeawayRequestIdentity(req('',{'x-vercel-forwarded-for':'192.0.2.1'})).p_fingerprint);vi.stubEnv('TAKEAWAY_REQUEST_SOURCE','arbitrary-header');expect(takeawayRequestGateConfigured()).toBe(false);
 });
 it.each(['0','-1','1.5','100001','NaN','01',' 10'])('invalid configured quotas fail closed (%s)',value=>{vi.stubEnv('TAKEAWAY_RATE_GLOBAL_MINUTE',value);expect(takeawayRequestGateConfigured()).toBe(false);expect(()=>takeawayRequestIdentity(req())).toThrow();});
 it('passes exact validated limits to the typed service RPC',async()=>{
  vi.stubEnv('TAKEAWAY_RATE_NETWORK_MINUTE','20');const identity=takeawayRequestIdentity(req()),rpc=vi.fn().mockResolvedValue({data:{allowed:false,retryAfter:27},error:null});vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({rpc} as unknown as ReturnType<typeof createSupabaseServiceRoleClient>);
  expect(await claimTakeawayRequest(createSupabaseServiceRoleClient(),identity)).toEqual({allowed:false,retryAfter:27});expect(rpc).toHaveBeenCalledWith('fn_takeaway_request_gate',identity);
 });
 it.each([{allowed:true,retryAfter:0},{allowed:false,retryAfter:3600}])('accepts a bounded committed gate result',async data=>{
  const rpc=vi.fn().mockResolvedValue({data,error:null});vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({rpc} as unknown as ReturnType<typeof createSupabaseServiceRoleClient>);expect(await claimTakeawayRequest(createSupabaseServiceRoleClient(),takeawayRequestIdentity(req()))).toEqual(data);
 });
 it.each([null,{}, {allowed:1,retryAfter:2},{allowed:false,retryAfter:0},{allowed:true,retryAfter:2},{allowed:false,retryAfter:1.5},{allowed:false,retryAfter:3601}])('does not treat malformed budget responses as permission',async data=>{
  const rpc=vi.fn().mockResolvedValue({data,error:null});vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({rpc} as unknown as ReturnType<typeof createSupabaseServiceRoleClient>);await expect(claimTakeawayRequest(createSupabaseServiceRoleClient(),takeawayRequestIdentity(req()))).rejects.toThrow('unavailable');
 });
 it('propagates gate unavailability without exposing raw database details',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message:'private details'}});vi.mocked(createSupabaseServiceRoleClient).mockReturnValue({rpc} as unknown as ReturnType<typeof createSupabaseServiceRoleClient>);await expect(claimTakeawayRequest(createSupabaseServiceRoleClient(),takeawayRequestIdentity(req()))).rejects.toThrow('Request gate unavailable');
 });
});
