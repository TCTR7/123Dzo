import 'server-only';
import {createSupabaseServiceRoleClient} from '@/lib/supabase/server';
import {parseManualPaymentStatus} from './contracts';
export async function readManualPayments(actorId:string,pendingPage=1,historyPage=1){
 const {data,error}=await createSupabaseServiceRoleClient().rpc('fn_manual_payment_status',{p_actor_id:actorId,p_pending_page:pendingPage,p_history_page:historyPage});
 const result=!error?parseManualPaymentStatus(data):null;
 if(!result)throw new Error('Chưa tải được danh sách thu tiền. Vui lòng thử lại.');
 return result;
}
