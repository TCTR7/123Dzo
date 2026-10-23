// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {status} from './manual_payment_fixtures';
const mocks=vi.hoisted(()=>({guard:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/auth/staff-guard',()=>({requireStaffPage:mocks.guard}));vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));vi.mock('@/components/staff/ManualPayments',()=>({ManualPayments:()=>null}));vi.mock('@/components/staff/TakeawayPickups',()=>({TakeawayPickups:()=>null}));
import AdminPage from '@/app/(auth-protected)/admin/payments/page';
import StaffPage from '@/app/(auth-protected)/staff/payments/page';
describe('Manual receipt SSR guards, paging and no fake empty history',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue({userId:'user_staff'});mocks.client.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:status,error:null});});
 it.each([AdminPage,StaffPage])('reads a validated paged projection with server actor',async page=>{
  const result=await page({searchParams:Promise.resolve({pendingPage:'2',historyPage:'3'})});expect(mocks.rpc).toHaveBeenCalledWith('fn_manual_payment_status',{p_actor_id:'user_staff',p_pending_page:2,p_history_page:3});expect(result.props.children[0].props.status).toEqual(status);
 });
 it.each([{pendingPage:['1','2']},{historyPage:'0'},{pendingPage:'10001'}])('rejects invalid query before data client',async search=>{
  await expect(StaffPage({searchParams:Promise.resolve(search)})).rejects.toThrow('không hợp lệ');expect(mocks.client).not.toHaveBeenCalled();
 });
 it('dependency failures remain explicit instead of successful empty counts',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'42501'}});await expect(StaffPage({})).rejects.toThrow('Chưa tải được');
  mocks.rpc.mockResolvedValueOnce({data:{...status,history:[{...status.history[0],amount:'wrong'}]},error:null});await expect(AdminPage({})).rejects.toThrow('Chưa tải được');
 });
});
