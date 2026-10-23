// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {command,result,journal,token,operationId,snapshot} from './takeaway_fixtures';
const mocks=vi.hoisted(()=>({client:vi.fn(),rpc:vi.fn(),config:vi.fn(),identity:vi.fn(),gate:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));vi.mock('@/lib/takeaway/config',()=>({takeawaySettings:mocks.config}));
vi.mock('@/lib/takeaway/request-limit',()=>({takeawayRequestIdentity:mocks.identity,claimTakeawayRequest:mocks.gate}));
import {GET,POST} from '@/app/api/customer/takeaway/route';
const request=(data:unknown={operationId,command},cap=token,origin='http://localhost')=>new Request('http://localhost/api/customer/takeaway',{method:'POST',headers:{origin,'content-type':'application/json','x-takeaway-token':cap},body:JSON.stringify(data)});
describe('Public takeaway API has capability-only safe reads and fail-closed create',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.client.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:result,error:null});mocks.config.mockReturnValue({enabled:true});mocks.identity.mockReturnValue({p_fingerprint:'a'.repeat(64)});mocks.gate.mockResolvedValue({allowed:true,retryAfter:0});});
 it('creates only with validated fields and returns a safe projection',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({data:result});expect(mocks.rpc).toHaveBeenCalledWith('fn_create_takeaway',{p_token:token,p_operation_id:operationId,p_command:command});expect(response.headers.get('cache-control')).toContain('no-store');
 });
 it('never creates if merchant configuration is missing',async()=>{mocks.config.mockReturnValue({enabled:false});expect((await POST(request())).status).toBe(503);expect(mocks.client).not.toHaveBeenCalled();});
 it.each([request(undefined,'bad'),request(undefined,token,'http://evil'),request({...journal,actor:'spoof'})])('rejects invalid capability, Origin and privileged body',async req=>{expect((await POST(req)).status).toBeGreaterThanOrEqual(400);expect(mocks.client).not.toHaveBeenCalled();});
 it('recovery reads are allowed while new orders disabled and do not create',async()=>{
  mocks.config.mockReturnValue({enabled:false});mocks.rpc.mockResolvedValue({data:null,error:null});const response=await GET(new Request('http://localhost/api/customer/takeaway?operationId='+operationId,{headers:{'x-takeaway-token':token}}));expect(await response.json()).toEqual({data:null});expect(mocks.rpc).toHaveBeenCalledWith('fn_get_takeaway_create',{p_token:token,p_operation_id:operationId});
 });
 it('snapshot strips customer contact, bank references, costs and staff audit',async()=>{
  mocks.rpc.mockResolvedValue({data:{...snapshot,customerPhone:'private',confirmedBy:'private',items:snapshot.items.map(row=>({...row,unit_cost_price:40}))},error:null});const response=await GET(new Request('http://localhost/api/customer/takeaway',{headers:{'x-takeaway-token':token}}));expect(await response.json()).toEqual({data:snapshot});
 });
 it.each(['?token=secret','?phone=0912345678','?operationId=bad',`?operationId=${operationId}&operationId=${operationId}`])('rejects invalid query %s',async query=>{expect((await GET(new Request('http://localhost/api/customer/takeaway'+query,{headers:{'x-takeaway-token':token}}))).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();});
 it.each([['P1504',429],['P1002',409],['P1003',409],['P1005',409],['P0002',404],['22023',400],['22000',409],['secret',503]])('maps %s without raw DB text',async(code,status)=>{mocks.rpc.mockResolvedValue({data:null,error:{code,message:'private'}});const response=await POST(request());expect(response.status).toBe(status);expect(await response.text()).not.toContain('private');});
 it('invalid response and malformed JSON never report success',async()=>{
  mocks.rpc.mockResolvedValue({data:{...result,operationId:'b0000000-0000-4000-8000-000000000002'},error:null});expect((await POST(request())).status).toBe(503);
  const req=new Request('http://localhost/api/customer/takeaway',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-takeaway-token':token},body:'{'});expect((await POST(req)).status).toBe(400);
 });
 it('denies before create and supplies a distinct error/Retry-After when durable budget is exhausted',async()=>{mocks.gate.mockResolvedValue({allowed:false,retryAfter:42});const response=await POST(request());expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('42');expect((await response.json()).error.code).toBe('TAKEAWAY_REQUEST_RATE_LIMIT');expect(mocks.rpc).not.toHaveBeenCalled();});
 it.each(['source','database'])('fails closed on %s gate errors without a business mutation',async source=>{if(source==='source')mocks.identity.mockImplementation(()=>{throw new Error('private ip secret');});else mocks.gate.mockRejectedValue(new Error('private database detail'));const response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('private');expect(mocks.rpc).not.toHaveBeenCalled();});
 it('operation recovery is never gated or automatically posted',async()=>{mocks.identity.mockImplementation(()=>{throw new Error('gate off');});mocks.rpc.mockResolvedValue({data:result,error:null});expect((await GET(new Request('http://localhost/api/customer/takeaway?operationId='+operationId,{headers:{'x-takeaway-token':token}}))).status).toBe(200);expect(mocks.gate).not.toHaveBeenCalled();expect(mocks.identity).not.toHaveBeenCalled();});
});
