import { NextResponse } from 'next/server';
import { getCurrentStaffProfile } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { ApiError, assertAllowed, objectBody } from '@/lib/services/errors';
import { changeStock, getSession, ownsSession, recalculateTotal } from '@/lib/services/orders';

export async function POST(req: Request) {
  try {
    const actor = await getCurrentStaffProfile(); assertAllowed(actor?.is_active && actor.role !== 'kitchen', 'Không có quyền trả bia.', 403);
    const body = objectBody(await req.json());
    assertAllowed(typeof body.orderItemId === 'string' && Number.isInteger(body.quantity) && Number(body.quantity) > 0, 'Số lượng trả không hợp lệ.', 400);
    const db = createSupabaseServiceRoleClient();
    const selected = await db.from('order_items').select('*').eq('id', body.orderItemId).single();
    assertAllowed(!selected.error && selected.data, 'Không tìm thấy món.', 404);
    const item = selected.data; const quantity = Number(body.quantity);
    const session = await getSession(item.session_id);
    assertAllowed(ownsSession(actor, session) && ['ACTIVE', 'REQUEST_BILL'].includes(session.status));
    const menu = await db.from('menu_items').select('*').eq('id', item.menu_item_id).single();
    assertAllowed(menu.data && ['BEER', 'DRINK'].includes(menu.data.category) && item.station === 'BAR_INSTANT' && ['READY', 'SERVED'].includes(item.status) && quantity <= item.quantity, 'Chỉ trả đồ uống chưa sử dụng trong hóa đơn đang mở.', 400);
    const remaining = item.quantity - quantity;
    const saved = await db.from('order_items').update(remaining ? { quantity: remaining } : { status: 'CANCELLED', cancelled_at: new Date().toISOString(), cancelled_by: actor.id, cancel_reason: `Trả toàn bộ ${quantity} đồ uống chưa dùng` }).eq('id', item.id).eq('quantity', item.quantity).eq('status', item.status).select('*').maybeSingle();
    assertAllowed(!saved.error && saved.data, 'Món vừa thay đổi, tải lại trước khi trả.', 409);
    if (menu.data.linked_ingredient_id) await changeStock(menu.data.linked_ingredient_id, quantity, actor.id, 'RETURN_BEER', `Trả ${quantity} ${menu.data.name} từ phiên ${session.id}`);
    await recalculateTotal(session.id);
    return NextResponse.json({ order: saved.data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Không trả được bia.' }, { status: error instanceof ApiError ? error.status : 500 }); }
}
