import { requireStaffPage } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { isRecord } from '@/lib/orders/contracts';
import Link from 'next/link';
export const dynamic='force-dynamic';
export default async function ReleasePage(){
 const actor=await requireStaffPage(['admin']);
 const {data,error}=await createSupabaseServiceRoleClient().rpc('fn_admin_data_health',{p_actor_id:actor.userId});
 if(error||!isRecord(data)||!Array.isArray(data.checks))throw new Error('Không tải được kết quả đối soát.');
 const labels:Record<string,string>={DUPLICATE_LIVE_TABLE:'Bàn có nhiều phiên đang mở',TABLE_POINTER_MISMATCH:'Liên kết bàn và phiên chưa khớp',BILL_TOTAL_MISMATCH:'Tổng hóa đơn lệch chi tiết',NEGATIVE_STOCK:'Tồn kho âm',MISSING_KPI_TIMESTAMPS:'Thiếu hoặc sai thời gian KPI',UNVERIFIED_TAKEAWAY_ACTIVATION:'Mang về thiếu mốc thanh toán xác minh',MISSING_EXPORT_PROVENANCE:'Món thiếu chứng từ xuất kho gốc'};
 return <section className="space-y-4"><h1 className="text-2xl font-bold">Đối soát trước vận hành</h1><p>Chỉ kiểm tra, không tự sửa dữ liệu lịch sử. Số liệu sạch chưa thay thế nghiệm thu thanh toán, phân quyền và thiết bị.</p>
 <ul className="space-y-3">{data.checks.map((row,index)=>isRecord(row)&&typeof row.code==='string'&&typeof row.count==='number'?<li key={row.code} className={`rounded-xl border p-4 ${row.count>0?'border-amber-500 text-amber-200':'border-zinc-700'}`}>{labels[row.code]??row.code}: <strong>{row.count}</strong></li>:<li key={index} role="alert">Kết quả kiểm tra chưa hợp lệ.</li>)}</ul>
 <Link href="/admin/release" className="inline-flex min-h-12 items-center border rounded-xl px-4">Kiểm tra lại</Link><p>Đối soát sai lệch với quản lý trước khi áp migration hoặc mở bán. Không sửa tổng bill/kho bằng suy đoán.</p></section>;
}
