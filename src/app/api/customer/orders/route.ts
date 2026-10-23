import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { addOrderItems, parseCart } from '@/lib/services/orders';
import { ApiError, assertAllowed, objectBody } from '@/lib/services/errors';
import { publicOrder, publicSession, sessionByToken } from '@/lib/services/snapshots';

export async function POST(req: Request) {
  try {
    const body = objectBody(await req.json());
    if (typeof body.token === 'string') {
      const session = await sessionByToken(body.token);
      assertAllowed(session.session_type === 'DINE_IN', 'Chỉ gọi thêm món tại bàn.', 403);
      const orders = await addOrderItems(session, body.items);
      return NextResponse.json({ orders: orders.map(publicOrder) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const cart = parseCart(body.items);
    const name = typeof body.customerName === 'string' ? body.customerName.trim() : '';
    const phone = typeof body.customerPhone === 'string' ? body.customerPhone.replace(/\s/g, '') : '';
    assertAllowed(name.length > 0 && name.length <= 100 && /^\d{9,12}$/.test(phone), 'Tên hoặc số điện thoại không hợp lệ.', 400);
    const db = createSupabaseServiceRoleClient();
    const created = await db.from('table_sessions').insert({ session_type: 'TAKEAWAY', status: 'PENDING_PAYMENT', session_token: crypto.randomUUID(), payment_code: `DZO${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`, customer_name: name, customer_phone: phone, payment_method: 'VIETQR', total_amount: 0 }).select('*').single();
    if (created.error || !created.data) throw new ApiError('Không tạo được đơn mang về.', 502);
    try {
      const orders = await addOrderItems(created.data, cart, true);
      const latest = await sessionByToken(created.data.session_token);
      return NextResponse.json({ session: publicSession(latest), orders: orders.map(publicOrder) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await db.from('table_sessions').delete().eq('id', created.data.id).eq('status', 'PENDING_PAYMENT');
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request không hợp lệ.' }, { status: error instanceof ApiError ? error.status : 400 });
  }
}
