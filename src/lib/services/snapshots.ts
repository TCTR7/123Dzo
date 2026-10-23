import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { assertAllowed } from './errors';
import type { IngredientRow, MenuItemRow, OrderItemRow, StaffProfileRow, TableRow, TableSessionRow } from '@/types/database.types';

export interface AppAlert { id: string; message: string }
export type KitchenQueueEntry = Pick<OrderItemRow, 'id' | 'created_at' | 'station' | 'status'>;
export interface AppSnapshot {
  menu: MenuItemRow[]; orders: OrderItemRow[]; sessions: TableSessionRow[];
  tables: TableRow[]; ingredients: IngredientRow[]; queue: KitchenQueueEntry[]; alerts: AppAlert[];
}
export const publicMenu = (row: MenuItemRow): MenuItemRow => ({ ...row, cost_price: 0, linked_ingredient_id: null });
export const publicOrder = (row: OrderItemRow): OrderItemRow => ({ ...row, unit_cost_price: 0, served_by_staff_id: null, cancelled_by: null, batch_id: null });
export const publicSession = (row: TableSessionRow): TableSessionRow => ({ ...row, assigned_staff_id: null });

export async function sessionByToken(token: string) {
  assertAllowed(token.length >= 8 && token.length <= 160, 'Token không hợp lệ.', 401);
  const { data, error } = await createSupabaseServiceRoleClient().from('table_sessions').select('*').eq('session_token', token).single();
  assertAllowed(!error && data, 'Mã phiên không hợp lệ.', 404);
  return data;
}

export function staffAlerts(actor: StaffProfileRow, sessions: TableSessionRow[], orders: OrderItemRow[], tables: TableRow[], now = Date.now()): AppAlert[] {
  const manager = actor.role === 'operator' || actor.role === 'admin';
  return orders.filter((item) => item.status === 'READY' && item.ready_at).flatMap((item) => {
    const session = sessions.find((entry) => entry.id === item.session_id);
    if (!session || !['ACTIVE', 'REQUEST_BILL'].includes(session.status)) return [];
    const table = tables.find((entry) => entry.id === session.table_id);
    const overdue = now - Date.parse(item.ready_at!) >= 120000;
    const own = session.assigned_staff_id === actor.id;
    const inZone = Boolean(table && table.zone_id === actor.assigned_zone_id);
    if (!manager && !own && !(inZone && (overdue || !session.assigned_staff_id))) return [];
    return [{ id: `${item.id}:${overdue ? 'overdue' : 'ready'}`, message: `${overdue ? 'Món chờ hơn 2 phút – cần hỗ trợ' : 'Món đã sẵn sàng'} · ${table?.table_number ?? 'Mang về'}` }];
  }).concat(sessions.filter((session) => (manager || session.assigned_staff_id === actor.id) && session.status === 'REQUEST_BILL').map((session) => ({ id: `${session.id}:bill`, message: `${tables.find((table) => table.id === session.table_id)?.table_number ?? 'Khách'} gọi tính tiền` })));
}

export async function readSnapshot(actor: StaffProfileRow | null, token?: string, view?: string): Promise<AppSnapshot> {
  const db = createSupabaseServiceRoleClient();
  const menus = await db.from('menu_items').select('*').order('name');
  assertAllowed(!menus.error, 'Không đọc được thực đơn.', 502);
  const empty: AppSnapshot = { menu: (menus.data ?? []).map(publicMenu), orders: [], sessions: [], tables: [], ingredients: [], queue: [], alerts: [] };
  // A supplied customer token always scopes the response, even for a signed-in admin.
  if (token || !actor) {
    if (!token) return empty;
    const session = await sessionByToken(token);
    const orders = await db.from('order_items').select('*').eq('session_id', session.id).order('created_at');
    assertAllowed(!orders.error, 'Không đọc được món của phiên.', 502);
    empty.sessions = [publicSession(session)]; empty.orders = (orders.data ?? []).map(publicOrder);
    if (session.status === 'CLOSED') return empty;
    // Only timestamps/ranks are shared for other tables; no customer data, prices or IDs.
    const active = await db.from('table_sessions').select('id').in('status', ['ACTIVE', 'REQUEST_BILL']);
    assertAllowed(!active.error, 'Không đọc được hàng đợi.', 502);
    const queue = active.data?.length ? await db.from('order_items').select('created_at').in('session_id', active.data.map((entry) => entry.id)).eq('station', 'KITCHEN').eq('status', 'QUEUED').order('created_at') : { data: [], error: null };
    assertAllowed(!queue.error, 'Không đọc được hàng đợi.', 502);
    empty.queue = (queue.data ?? []).map((row, index) => ({ id: `queue-${index}`, created_at: row.created_at, station: 'KITCHEN', status: 'QUEUED' }));
    return empty;
  }
  const includeHistory = (actor.role === 'admin' || actor.role === 'operator') && view !== 'kitchen' && view !== 'staff';
  const [sessions, history, tables, ingredients] = await Promise.all([
    db.from('table_sessions').select('*').neq('status', 'CLOSED').order('opened_at', { ascending: false }),
    includeHistory ? db.from('table_sessions').select('*').eq('status', 'CLOSED').order('opened_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    db.from('tables').select('*'),
    actor.role === 'kitchen' ? Promise.resolve({ data: [], error: null }) : db.from('ingredients').select('*'),
  ]);
  assertAllowed(!sessions.error && !history.error && !tables.error && !ingredients.error, 'Không đọc được dữ liệu nội bộ.', 502);
  const sessionRows = Array.from(new Map([...(sessions.data ?? []), ...(history.data ?? [])].map((entry) => [entry.id, entry])).values());
  const orders: OrderItemRow[] = [];
  // Small ID batches keep URLs bounded. Pagination avoids silently dropping current
  // orders when the default Supabase 1,000-row response limit is reached.
  for (let index = 0; index < sessionRows.length; index += 50) {
    const ids = sessionRows.slice(index, index + 50).map((entry) => entry.id);
    for (let offset = 0; ; offset += 1000) {
      const items = await db.from('order_items').select('*').in('session_id', ids).order('id').range(offset, offset + 999);
      assertAllowed(!items.error, 'Không đọc được món gọi.', 502);
      orders.push(...(items.data ?? []));
      if ((items.data?.length ?? 0) < 1000) break;
    }
  }
  const kitchenView = actor.role === 'kitchen' || view === 'kitchen' && (actor.role === 'admin' || actor.role === 'operator');
  const pendingPayments = actor.role === 'admin' || actor.role === 'operator'
    ? sessionRows.filter((session) => session.session_type === 'TAKEAWAY' && session.status === 'PENDING_PAYMENT').map((session) => ({ id: `${session.id}:payment`, message: 'Đơn mang về đang chờ xác nhận thanh toán' })) : [];
  return { ...empty, menu: menus.data ?? [], sessions: sessionRows, orders, tables: tables.data ?? [], ingredients: ingredients.data ?? [], alerts: kitchenView
    ? orders.filter((item) => item.station === 'KITCHEN' && item.status === 'QUEUED' && sessionRows.some((session) => session.id === item.session_id && ['ACTIVE', 'REQUEST_BILL'].includes(session.status))).map((item) => ({ id: `${item.id}:queued`, message: 'Có món mới đang chờ nấu' }))
    : [...staffAlerts(actor, sessionRows, orders, tables.data ?? []), ...pendingPayments] };
}
