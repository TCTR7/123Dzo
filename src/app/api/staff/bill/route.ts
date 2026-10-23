import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/orders/contracts';
import { parseSessionBill } from '@/lib/sessions/bill-contract';
function failure(status: number, message: string) { return NextResponse.json({ error: { code: 'BILL_READ_FAILED', message } }, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function GET(req: Request) {
  const access = await requireStaffApi(['staff', 'admin']);
  if (access.response) return access.response;
  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId || !UUID.test(sessionId)) return failure(400, 'Mã phiên không hợp lệ.');
  try {
    const { data, error } = await createSupabaseServiceRoleClient().rpc('fn_get_session_bill', { p_actor_id: access.staff.userId, p_session_id: sessionId.toLowerCase() });
    if (error) return failure(error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 503, 'Chưa tải được chi tiết bill. Vui lòng thử lại.');
    const bill = parseSessionBill(data);
    if (!bill || bill.sessionId !== sessionId.toLowerCase()) return failure(503, 'Chưa xác minh được dữ liệu bill.');
    return NextResponse.json({ data: bill }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return failure(503, 'Chưa tải được chi tiết bill. Vui lòng thử lại.'); }
}
