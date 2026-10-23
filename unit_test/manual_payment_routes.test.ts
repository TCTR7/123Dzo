// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {journal,result,status,operationId} from './manual_payment_fixtures';
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/auth/staff-guard',()=>({requireStaffApi:mocks.guard}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
import {GET,POST} from '@/app/api/staff/payments/route';
const request=(data:unknown=journal,origin='http://localhost')=>new Request('http://localhost/api/staff/payments',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
describe('Manual payment API role, evidence and safe results',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue({staff:{userId:'user_staff'}});mocks.client.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:result,error:null});});
 it.each([GET,POST])('denies before creating a data client',async handle=>{
  mocks.guard.mockResolvedValue({response:new Response('',{status:403})});expect((await handle(request())).status).toBe(403);expect(mocks.client).not.toHaveBeenCalled();expect(mocks.guard).toHaveBeenCalledWith(['staff','admin']);
 });
 it('passes only server actor and a normalized command; successful receipt is no-store',async()=>{
  const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(mocks.rpc).toHaveBeenCalledWith('fn_confirm_manual_payment',{p_actor_id:'user_staff',p_operation_id:operationId,p_command:journal.command});
 });
 it.each([request(journal,'http://evil.test'),request({...journal,actorId:'user_admin'}),request({...journal,command:{...journal.command,confirmedReceived:false}})])('rejects bad Origin/spoofed actor/missing confirmation',async req=>{expect((await POST(req)).status).toBeGreaterThanOrEqual(400);expect(mocks.client).not.toHaveBeenCalled();});
 it('reads only the current actor operation; missing result stays null',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:null});const response=await GET(new Request('http://localhost/api/staff/payments?operationId='+operationId));expect(await response.json()).toEqual({data:null});expect(mocks.rpc).toHaveBeenCalledWith('fn_get_manual_payment_operation',{p_actor_id:'user_staff',p_operation_id:operationId});
 });
 it('returns paged pending/history with validation and no raw extra fields',async()=>{
  mocks.rpc.mockResolvedValue({data:{...status,secret:'private'},error:null});const response=await GET(new Request('http://localhost/api/staff/payments?pendingPage=2&historyPage=3'));expect(await response.json()).toEqual({data:status});expect(mocks.rpc).toHaveBeenCalledWith('fn_manual_payment_status',{p_actor_id:'user_staff',p_pending_page:2,p_history_page:3});
 });
 it.each(['?pendingPage=0','?pendingPage=2&pendingPage=3','?actor=admin','?operationId=bad',`?operationId=${operationId}&historyPage=1`])('rejects invalid read query %s',async query=>{expect((await GET(new Request('http://localhost/api/staff/payments'+query))).status).toBe(400);expect(mocks.client).not.toHaveBeenCalled();});
 it.each([['P1004',409],['P1306',409],['P1501',409],['P1503',409],['23505',409],['42501',403],['P0002',404],['22000',409],['22023',400],['private-error',503]])('maps DB code %s without exposing private details',async(code,statusCode)=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code,message:'secret account data'}});const response=await POST(request());expect(response.status).toBe(statusCode);expect(await response.text()).not.toContain('secret account data');
 });
 it('retains uncertainty when the DB result belongs to another actor',async()=>{
  mocks.rpc.mockResolvedValue({data:{...result,confirmedBy:'user_admin'},error:null});expect((await POST(request())).status).toBe(503);
 });
 it('handles malformed JSON and oversized requests before any RPC',async()=>{
  const bad=new Request('http://localhost/api/staff/payments',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:'{'});expect((await POST(bad)).status).toBe(400);
  expect((await POST(request({payload:'x'.repeat(4200)}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
