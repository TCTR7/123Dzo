import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { ApiError, assertAllowed, objectBody } from '@/lib/services/errors';
import { recalculateTotal } from '@/lib/services/orders';
import { publicSession, readSnapshot, sessionByToken } from '@/lib/services/snapshots';

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get('token') || '';
    assertAllowed(token, 'Thiếu mã phiên.', 401);
    return NextResponse.json(await readSnapshot(null, token), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const body = objectBody(await req.json());
    const session = await sessionByToken(typeof body.token === 'string' ? body.token : '');
    assertAllowed(session.session_type === 'DINE_IN' && session.status === 'ACTIVE', 'Phiên bàn không nhận yêu cầu tính tiền.', 409);
    assertAllowed(body.paymentMethod === 'CASH' || body.paymentMethod === 'VIETQR', 'Phương thức thanh toán không hợp lệ.', 400);
    const total = await recalculateTotal(session.id);
    const result = await createSupabaseServiceRoleClient().from('table_sessions').update({ status: 'REQUEST_BILL', payment_method: body.paymentMethod, total_amount: total }).eq('id', session.id).eq('status', 'ACTIVE').select('*').single();
    assertAllowed(!result.error && result.data, 'Phiên bàn vừa thay đổi. Vui lòng tải lại.', 409);
    return NextResponse.json({ session: publicSession(result.data) });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Không đọc được phiên bàn.' }, { status: error instanceof ApiError ? error.status : 500 }); }
