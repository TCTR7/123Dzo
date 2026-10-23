// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {operationId,sessionId,result as created} from './takeaway_fixtures';
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn(),rpc:vi.fn()}));vi.mock('server-only',()=>({}));vi.mock('@/lib/auth/staff-guard',()=>({requireStaffApi:mocks.guard}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
import {GET,POST} from '@/app/api/staff/takeaway/route';
const result={operationId,sessionId,closedAt:'2026-10-22T11:00:00Z',handedOverBy:'user_staff'};
const req=(data:unknown={operationId,sessionId},origin='http://localhost')=>new Request('http://localhost/api/staff/takeaway',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
describe('Pickup server guard, scope and outcome',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue({staff:{userId:'user_staff'}});mocks.client.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:result,error:null});});
 it('guards before reads/writes and supplies actor only from identity',async()=>{
  const response=await POST(req());expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('fn_pickup_takeaway',{p_actor_id:'user_staff',p_operation_id:operationId,p_session_id:sessionId});mocks.guard.mockResolvedValue({response:new Response('',{status:403})});mocks.client.mockClear();expect((await GET(new Request('http://localhost'))).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();
 });
 it.each([req(undefined,'http://evil'),req({operationId,sessionId,actorId:'spoof'}),req({operationId:'bad',sessionId})])('rejects invalid Origin/privileged fields/UUID before data client',async request=>{expect((await POST(request)).status).toBeGreaterThanOrEqual(400);expect(mocks.client).not.toHaveBeenCalled();});
 it('returns a projected list and never raw contact or capability',async()=>{
  const row={sessionId,paymentCode:created.paymentCode,customerName:'Fixture',totalAmount:100};mocks.rpc.mockResolvedValue({data:{rows:[{...row,session_token:'private'}],hasMore:false},error:null});expect(await (await GET(new Request('http://localhost/api/staff/takeaway?page=2'))).json()).toEqual({data:{rows:[row],hasMore:false}});expect(mocks.rpc).toHaveBeenCalledWith('fn_takeaway_pickup_list',{p_actor_id:'user_staff',p_page:2});
 });
 it.each(['?page=0','?page=1&page=2','?operationId=bad','?operationId='+operationId+'&actor=x'])('rejects invalid query %s',async query=>{expect((await GET(new Request('http://localhost'+query))).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();});
 it('missing committed operation returns null, no implicit handover',async()=>{mocks.rpc.mockResolvedValue({data:null,error:null});const response=await GET(new Request('http://localhost?operationId='+operationId));expect(await response.json()).toEqual({data:null});expect(mocks.rpc).toHaveBeenCalledWith('fn_get_takeaway_pickup',{p_actor_id:'user_staff',p_operation_id:operationId});});
 it.each([['P1501',409],['P1305',409],['42501',403],['P0002',404],['22023',400],['unknown',503]])('maps %s safely',async(code,status)=>{mocks.rpc.mockResolvedValue({data:null,error:{code,message:'private'}});const response=await POST(req());expect(response.status).toBe(status);expect(await response.text()).not.toContain('private');});
 it('wrong receipt actor never reports success',async()=>{mocks.rpc.mockResolvedValue({data:{...result,handedOverBy:'other'},error:null});expect((await POST(req())).status).toBe(503);});
 it('normalizes UUID casing before matching the committed result',async()=>{expect((await POST(req({operationId:operationId.toUpperCase(),sessionId:sessionId.toUpperCase()}))).status).toBe(200);});
});
