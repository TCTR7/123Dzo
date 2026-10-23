// @vitest-environment node
import { createECDH } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth/staff-guard',()=>({requireStaffApi:mocks.guard}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
import {POST,DELETE} from '@/app/api/push/subscribe/route';
import {POST as retry} from '@/app/api/admin/notification-jobs/route';
import {POST as manual} from '@/app/api/push/notify/route';
import {parseNotificationStatus} from '@/lib/notifications/contracts';
const key=createECDH('prime256v1');key.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/unit',keys:{auth:Buffer.alloc(16,1).toString('base64url'),p256dh:key.getPublicKey().toString('base64url')}};
const id='40000000-0000-4000-8000-000000000001';
function request(body:unknown,method='POST',origin='http://localhost'){return new Request('http://localhost/api/push/subscribe',{method,headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});}
describe('Notification route boundaries',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue({staff:{userId:'user_self'}});mocks.client.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:null,error:null});});
  it.each([POST,DELETE,retry])('denies before DB when guard rejects',async(handler)=>{mocks.guard.mockResolvedValue({response:new Response('',{status:403})});expect((await handler(request({subscription}))).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();});
  it.each([POST,DELETE,retry])('rejects cross-origin mutations',async(handler)=>{expect((await handler(request({subscription},'POST','https://evil.test'))).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();});
  it('accepts a validated subscription for the current actor only',async()=>{expect((await POST(request({subscription}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('fn_set_push_subscription',{p_actor_id:'user_self',p_subscription:subscription,p_expected_endpoint:null});});
  it('requires the expected endpoint for unsubscribe',async()=>{
    expect((await DELETE(request({},'DELETE'))).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();
    expect((await DELETE(request({endpoint:subscription.endpoint},'DELETE'))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('fn_set_push_subscription',{p_actor_id:'user_self',p_subscription:null,p_expected_endpoint:subscription.endpoint});
  });
  it('rejects spoofed identity, unsafe endpoint, invalid keys and oversized input before DB',async()=>{
    for(const body of [{staffId:'victim',subscription},{subscription:{...subscription,endpoint:'http://localhost'}},{subscription:{...subscription,keys:{auth:'bad',p256dh:'bad'}}},{subscription,note:'x'.repeat(5000)}]) expect([400,403,413]).toContain((await POST(request(body))).status);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('maps DB role revocation to403 without private errors',async()=>{mocks.rpc.mockResolvedValue({error:{code:'42501',message:'private-role-details'}});const response=await POST(request({subscription}));expect(response.status).toBe(403);expect(await response.text()).not.toContain('private-role-details');});
  it('retires manual delivery even with a forged fallback/recipient/body',async()=>{expect((await manual(request({staffId:'victim',isFallbackZoneBroadcast:true,title:'spam'}))).status).toBe(410);expect(mocks.client).not.toHaveBeenCalled();});
  it('retries a failed job by expected attempts through the admin-only RPC',async()=>{mocks.rpc.mockResolvedValue({data:{pending:1,failed:0,jobs:[]},error:null});const response=await retry(request({id,expectedAttempts:8}));expect(response.status).toBe(200);expect(mocks.guard).toHaveBeenCalledWith(['admin']);expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_notification_jobs',{p_actor_id:'user_self',p_retry_id:id,p_expected_attempts:8});});
  it('maps stale retry to409 and refuses arbitrary payloads',async()=>{mocks.rpc.mockResolvedValue({error:{code:'40001'}});expect((await retry(request({id,expectedAttempts:8}))).status).toBe(409);mocks.client.mockClear();expect((await retry(request({id,expectedAttempts:8,title:'spam'}))).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();});
  it('projects safe status fields without subscription or payload secrets',()=>{
    const status=parseNotificationStatus({pending:0,failed:1,jobs:[{id,kind:'ORDER_READY',attempts:8,available_at:'2026-10-22T00:00:00Z',locked_until:null,failed_at:'2026-10-22T00:00:00Z',outcome:'FAILED',last_error:'PUSH_TRANSIENT',subscription:'private',payload:{token:'secret'}}]});
    expect(status?.jobs).toHaveLength(1);expect(JSON.stringify(status)).not.toContain('private');expect(JSON.stringify(status)).not.toContain('secret');
  });
  it('rejects invalid counters and unbounded status lists',()=>{expect(parseNotificationStatus({pending:-1,failed:0,jobs:[]})).toBeNull();expect(parseNotificationStatus({pending:26,failed:0,jobs:Array(26).fill({})})).toBeNull();});
});
