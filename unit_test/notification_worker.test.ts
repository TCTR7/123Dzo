// @vitest-environment node
import { createECDH } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), transport: vi.fn(), send: vi.fn(), prepare: vi.fn(), finish: vi.fn(), claim: vi.fn(), ack: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: mocks.client }));
vi.mock('@/lib/notifications/transport', () => ({ createPushTransport: mocks.transport }));
import { runNotificationWorker } from '@/lib/notifications/worker';
import { POST } from '@/app/api/cron/notifications/route';
const id='40000000-0000-4000-8000-000000000001', lease='50000000-0000-4000-8000-000000000001';
const key=createECDH('prime256v1'); key.generateKeys();
const subscription={ endpoint:'https://fcm.googleapis.com/fcm/send/unit-only',keys:{auth:Buffer.alloc(16,1).toString('base64url'),p256dh:key.getPublicKey().toString('base64url')} };
const job={id,leaseToken:lease,kind:'ORDER_READY'};
const prepared={kind:job.kind,tag:`notification-${id}`,target:{staffId:'user_staff',subscriptionHash:'a'.repeat(64),subscription}};
const empty={data:{...prepared,target:null},error:null};

describe('Durable notification worker orchestration',()=>{
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
  beforeEach(()=>{
    vi.resetAllMocks(); mocks.client.mockReturnValue({rpc:mocks.rpc}); mocks.transport.mockReturnValue(mocks.send); mocks.send.mockResolvedValue(201);
    mocks.claim.mockResolvedValue({data:null,error:null}).mockResolvedValueOnce({data:job,error:null});
    mocks.prepare.mockResolvedValue(empty).mockResolvedValueOnce({data:prepared,error:null}); mocks.ack.mockResolvedValue({error:null}); mocks.finish.mockResolvedValue({data:'SENT',error:null});
    mocks.rpc.mockImplementation((name:string,...args:unknown[])=>({fn_claim_notification_job:mocks.claim,fn_prepare_notification_job:mocks.prepare,fn_ack_notification_recipient:mocks.ack,fn_finish_notification_job:mocks.finish}[name] ?? vi.fn())(...args));
    vi.stubEnv('NOTIFICATION_WORKER_SECRET','unit-only-notification-secret-at-least-32');
  });
  it('validates config before DB and does not claim when VAPID is missing',async()=>{
    mocks.transport.mockImplementation(()=>{throw new Error('private-config');}); await expect(runNotificationWorker()).rejects.toThrow(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it('acknowledges only accepted push, then finishes with the same lease',async()=>{
    expect(await runNotificationWorker()).toMatchObject({processed:1,accepted:1});
    expect(mocks.send).toHaveBeenCalledWith(subscription,'ORDER_READY',`notification-${id}`);
    expect(mocks.ack).toHaveBeenCalledWith({p_id:id,p_lease:lease,p_staff_id:'user_staff',p_hash:'a'.repeat(64),p_expired:false});
    expect(mocks.finish).toHaveBeenCalledWith({p_id:id,p_lease:lease,p_retry:false,p_error:null});
  });
  it('does not call transport for stale/served/unpaid jobs without a current target',async()=>{
    mocks.prepare.mockReset().mockResolvedValue(empty); await runNotificationWorker(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.ack).not.toHaveBeenCalled();
  });
  it.each([429,500,503,404])('retries provider %i without a receipt',async(status)=>{
    mocks.send.mockResolvedValue(status); mocks.finish.mockResolvedValue({data:'RETRY',error:null}); expect(await runNotificationWorker()).toMatchObject({accepted:0,retrying:1});
    expect(mocks.ack).not.toHaveBeenCalled(); expect(mocks.finish.mock.calls[0][0]).toMatchObject({p_retry:true,p_error:status===404?'PUSH_REJECTED':'PUSH_TRANSIENT'});
  });
  it('clears410 by subscription hash without marking accepted delivery',async()=>{
    mocks.send.mockResolvedValue(410); expect(await runNotificationWorker()).toMatchObject({accepted:0}); expect(mocks.ack.mock.calls[0][0]).toMatchObject({p_expired:true,p_hash:'a'.repeat(64)});
  });
  it('rejects legacy malicious endpoints before any outbound request',async()=>{
    mocks.prepare.mockReset().mockResolvedValue(empty).mockResolvedValueOnce({data:{...prepared,target:{...prepared.target,subscription:{...subscription,endpoint:'http://127.0.0.1/private'}}},error:null});
    await runNotificationWorker(); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.ack.mock.calls[0][0]).toMatchObject({p_expired:true});
  });
  it('keeps a retryable job on receipt failure after provider acceptance',async()=>{
    mocks.ack.mockResolvedValue({error:{message:'private-SQL'}}); await runNotificationWorker(); expect(mocks.finish.mock.calls[0][0]).toMatchObject({p_retry:true,p_error:'DELIVERY_UNCERTAIN'});
  });
  it('does not persist network error details or endpoint secrets',async()=>{
    mocks.send.mockRejectedValue(new Error('secret-endpoint-credentials')); await runNotificationWorker(); expect(mocks.finish.mock.calls[0][0]).toMatchObject({p_retry:true,p_error:'WORKER_ERROR'}); expect(JSON.stringify(mocks.finish.mock.calls)).not.toContain('secret-endpoint');
  });
  it('limits a large zone to three recipients per lease',async()=>{
    mocks.prepare.mockReset().mockResolvedValue({data:prepared,error:null}); mocks.finish.mockResolvedValue({data:'RETRY',error:null});
    await runNotificationWorker(); expect(mocks.send).toHaveBeenCalledTimes(3); expect(mocks.finish).toHaveBeenCalledOnce();
  });
  it('bounds batches to five jobs even with a permanent backlog',async()=>{
    mocks.claim.mockReset().mockResolvedValue({data:job,error:null}); mocks.prepare.mockReset().mockResolvedValue(empty); await runNotificationWorker(); expect(mocks.claim).toHaveBeenCalledTimes(5);
  });
  it('bounds the whole batch to eight recipient attempts',async()=>{
    mocks.claim.mockReset().mockResolvedValue({data:job,error:null});mocks.prepare.mockReset().mockResolvedValue({data:prepared,error:null});
    await runNotificationWorker();expect(mocks.send).toHaveBeenCalledTimes(8);expect(mocks.claim).toHaveBeenCalledTimes(3);
  });
  it('does not claim new work after the invocation time budget',async()=>{
    vi.spyOn(Date,'now').mockReturnValueOnce(0).mockReturnValue(20001);expect(await runNotificationWorker()).toMatchObject({processed:0});expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('stops on a lost lease instead of reporting success',async()=>{
    mocks.prepare.mockReset().mockResolvedValue({data:null,error:{code:'40001'}}); mocks.finish.mockResolvedValue({error:{code:'40001'}}); await expect(runNotificationWorker()).rejects.toThrow('WORKER_UNAVAILABLE'); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(['','Bearer incorrect'])('denies scheduler secret %s before DB or transport',async(auth)=>{
    const response=await POST(new Request('http://localhost/api/cron/notifications',{method:'POST',headers:{authorization:auth}})); expect(response.status).toBe(401); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('returns503 when scheduler config is missing',async()=>{
    vi.stubEnv('NOTIFICATION_WORKER_SECRET',''); expect((await POST(new Request('http://localhost',{method:'POST'}))).status).toBe(503); expect(mocks.client).not.toHaveBeenCalled();
  });
  it('allows the dedicated bearer and returns only safe counters',async()=>{
    const response=await POST(new Request('http://localhost',{method:'POST',headers:{authorization:'Bearer unit-only-notification-secret-at-least-32'}})); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); const data=await response.json(); expect(data.accepted).toBe(1); expect(JSON.stringify(data)).not.toContain('subscription');
  });
});
