import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { isManager } from '@/lib/auth/roles';
import { ApiError, assertAllowed, objectBody } from './errors';
import type { OrderItemInsert, StaffProfileRow, TableSessionRow } from '@/types/database.types';

export async function getSession(id: string) {
  const { data, error } = await createSupabaseServiceRoleClient().from('table_sessions').select('*').eq('id', id).single();
  assertAllowed(!error && data, 'Không tìm thấy phiên bàn.', 404);
  return data;
}
export function ownsSession(actor: StaffProfileRow, session: TableSessionRow) {
  return isManager(actor.role) || actor.role === 'staff' && session.assigned_staff_id === actor.id;
}
export async function recalculateTotal(sessionId: string) {
  const db = createSupabaseServiceRoleClient();
  const { data, error } = await db.from('order_items').select('unit_price,quantity').eq('session_id', sessionId).neq('status', 'CANCELLED');
  if (error) throw new ApiError('Không tính được tổng hóa đơn.', 502);
  const total = (data ?? []).reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const saved = await db.from('table_sessions').update({ total_amount: total }).eq('id', sessionId);
  if (saved.error) throw new ApiError('Không cập nhật được tổng hóa đơn.', 502);
  return total;
}

// Compare-and-set prevents lost stock updates when two tables order at once.
export async function changeStock(ingredientId: string, delta: number, actorId: string | null, type: 'EXPORT_SALE' | 'RETURN_BEER', note: string) {
  const db = createSupabaseServiceRoleClient();
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await db.from('ingredients').select('*').eq('id', ingredientId).single();
    if (result.error || !result.data) throw new ApiError('Không đọc được tồn kho.', 502);
    const ingredient = result.data;
    const next = ingredient.stock_quantity + delta;
    assertAllowed(next >= 0, `Không đủ tồn kho ${ingredient.name}.`, 409);
    const updated = await db.from('ingredients').update({ stock_quantity: next }).eq('id', ingredientId).eq('stock_quantity', ingredient.stock_quantity).select('id').maybeSingle();
    if (updated.error) throw new ApiError('Không cập nhật được kho.', 502);
    if (!updated.data) continue;
    const logged = await db.from('inventory_logs').insert({ ingredient_id: ingredientId, type, quantity_change: delta, total_cost: Math.abs(delta) * ingredient.unit_cost, created_by: actorId, note });
    if (logged.error) {
      // Restore only if no other writer has changed this stock in the meantime.
      await db.from('ingredients').update({ stock_quantity: ingredient.stock_quantity }).eq('id', ingredientId).eq('stock_quantity', next);
      throw new ApiError('Không ghi được phiếu kho. Vui lòng kiểm tra tồn kho trước khi thử lại.', 502);
    }
    return;
  }
  throw new ApiError('Kho vừa thay đổi. Vui lòng thử lại.', 409);
}

export function parseCart(value: unknown) {
  assertAllowed(Array.isArray(value) && value.length > 0 && value.length <= 50, 'Giỏ hàng phải có 1–50 dòng.', 400);
  return value.map((entry) => {
    const row = objectBody(entry);
    assertAllowed(typeof row.menu_item_id === 'string' && /^[0-9a-f-]{36}$/i.test(row.menu_item_id) && Number.isInteger(row.quantity) && Number(row.quantity) > 0 && Number(row.quantity) <= 100 && (row.note == null || typeof row.note === 'string' && row.note.length <= 500), 'Món hoặc số lượng không hợp lệ.', 400);
    return { menu_item_id: row.menu_item_id, quantity: Number(row.quantity), note: typeof row.note === 'string' ? row.note.trim() || null : null };
  });
}

export async function addOrderItems(session: TableSessionRow, input: unknown, pending = false) {
  assertAllowed(pending ? session.status === 'PENDING_PAYMENT' && session.session_type === 'TAKEAWAY' : session.status === 'ACTIVE', 'Phiên bàn không cho phép gọi món.', 409);
  const cart = parseCart(input);
  const db = createSupabaseServiceRoleClient();
  const { data: menus, error } = await db.from('menu_items').select('*').in('id', cart.map((row) => row.menu_item_id));
  assertAllowed(!error && menus, 'Không đọc được thực đơn.', 502);
  const now = new Date().toISOString();
  const rows: OrderItemInsert[] = cart.map((entry) => {
    const menu = menus.find((item) => item.id === entry.menu_item_id);
    assertAllowed(menu?.is_available, 'Một món trong giỏ vừa hết hàng.', 409);
    const instant = !pending && menu.station === 'BAR_INSTANT';
    return { ...entry, session_id: session.id, station: menu.station, status: instant ? 'READY' : 'QUEUED', unit_price: menu.price, unit_cost_price: menu.cost_price, created_at: now, ready_at: instant ? now : null };
  });
  // Recheck the session immediately before the write; never trust client status/price.
  const fresh = await getSession(session.id);
  assertAllowed(fresh.status === session.status, 'Phiên bàn vừa đổi trạng thái.', 409);
  const reserved: { id: string; quantity: number }[] = [];
  try {
    if (!pending) for (const item of rows) {
      const menu = menus.find((entry) => entry.id === item.menu_item_id)!;
      if (menu.linked_ingredient_id) {
        await changeStock(menu.linked_ingredient_id, -item.quantity, session.assigned_staff_id, 'EXPORT_SALE', `${session.id}: ${item.quantity}x ${menu.name}`);
        reserved.push({ id: menu.linked_ingredient_id, quantity: item.quantity });
      }
    }
    const latest = await getSession(session.id);
    assertAllowed(latest.status === session.status, 'Phiên bàn vừa đổi trạng thái.', 409);
    const inserted = await db.from('order_items').insert(rows).select('*');
    if (inserted.error || !inserted.data) throw new ApiError('Không lưu được món gọi.', 502);
    // From this point the order is authoritative: do not restore stock on a total-refresh failure.
    reserved.length = 0;
    await recalculateTotal(session.id);
    return inserted.data;
  } catch (error) {
    for (const stock of reserved.reverse()) await changeStock(stock.id, stock.quantity, session.assigned_staff_id, 'RETURN_BEER', `Hoàn kho do chưa lưu được món – ${session.id}`);
    throw error;
  }
}

export async function activateTakeaway(session: TableSessionRow, actorId: string | null) {
  const db = createSupabaseServiceRoleClient();
  assertAllowed(session.session_type === 'TAKEAWAY' && session.status === 'PENDING_PAYMENT', 'Đơn không còn chờ thanh toán.', 409);
  const claimed = await db.from('table_sessions').update({ status: 'ACTIVE', payment_method: 'VIETQR' }).eq('id', session.id).eq('status', 'PENDING_PAYMENT').select('*').maybeSingle();
  assertAllowed(!claimed.error && claimed.data, 'Đơn vừa được xác nhận bởi người khác.', 409);
  const items = await db.from('order_items').select('*').eq('session_id', session.id).neq('status', 'CANCELLED');
  if (items.error) throw new ApiError('Đã xác nhận nhưng chưa đọc được món. Kiểm tra đơn trước khi thao tác lại.', 502);
  const now = new Date().toISOString();
  for (const item of items.data ?? []) {
    const menu = await db.from('menu_items').select('linked_ingredient_id,name').eq('id', item.menu_item_id).single();
    if (menu.error || !menu.data) throw new ApiError('Không đọc được món để xuất kho.', 502);
    if (menu.data.linked_ingredient_id) await changeStock(menu.data.linked_ingredient_id, -item.quantity, actorId, 'EXPORT_SALE', `Duyệt đơn ${session.payment_code}: ${menu.data.name}`);
    const saved = await db.from('order_items').update({ status: item.station === 'BAR_INSTANT' ? 'READY' : 'QUEUED', created_at: now, ready_at: item.station === 'BAR_INSTANT' ? now : null }).eq('id', item.id).eq('status', item.status);
    if (saved.error) throw new ApiError('Chưa cập nhật được trạng thái món.', 502);
  }
  return claimed.data;
}
