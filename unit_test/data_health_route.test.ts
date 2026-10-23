// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/auth/staff-guard',()=>({requireStaffApi:m.guard}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:m.client}));
import {GET} from '@/app/api/admin/data-health/route';
describe('Read-only diagnostic route',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.guard.mockResolvedValue({staff:{userId:'user_admin'},response:null});m.client.mockReturnValue({rpc:m.rpc});});
 it('guards before creating the privileged client',async()=>{m.guard.mockResolvedValue({response:new Response('',{status:403})});expect((await GET()).status).toBe(403);expect(m.client).not.toHaveBeenCalled();});
 it('passes only verified actor and returns no-store counters',async()=>{m.rpc.mockResolvedValue({data:{checks:[{code:'BILL_TOTAL_MISMATCH',count:1}]},error:null});const response=await GET();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');expect(m.rpc).toHaveBeenCalledWith('fn_admin_data_health',{p_actor_id:'user_admin'});});
 it('does not fake clean counters or expose SQL failures',async()=>{m.rpc.mockResolvedValue({data:null,error:{message:'private SQL'}});const response=await GET();expect(response.status).toBe(503);expect(await response.text()).not.toContain('private SQL');});
});
