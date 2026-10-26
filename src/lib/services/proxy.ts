import { NextResponse, type NextRequest } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { canManageRole, getCurrentStaffProfile, isConfiguredOperator, isManager, isStaffRole } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { restaurantZone, numberedTable } from './tables';
import { ApiError, assertAllowed, objectBody } from './errors';
import { activateTakeaway, addOrderItems, getSession, ownsSession, recalculateTotal } from './orders';
import type { OrderItemRow, OrderItemUpdate, StaffProfileRow, TableSessionUpdate } from '@/types/database.types';

const columns: Record<string, string[]> = {
  zones: ['name'], tables: ['table_number', 'zone_id', 'status', 'current_session_id'],
  menu_items: ['name', 'category', 'station', 'price', 'cost_price', 'prep_time_minutes', 'image_url', 'is_available', 'linked_ingredient_id'],
  ingredients: ['name', 'unit', 'stock_quantity', 'min_threshold', 'unit_cost'],
  inventory_logs: ['ingredient_id', 'type', 'quantity_change', 'total_cost', 'note', 'created_by'],
  staff_profiles: ['id', 'full_name', 'role', 'assigned_zone_id', 'is_active'],
};
const coreTables = [...Object.keys(columns), 'order_items', 'table_sessions'];
const reports = ['vw_kpi_financial_summary', 'vw_kpi_peak_hours', 'vw_kpi_menu_analytics', 'vw_kpi_kitchen_performance', 'vw_kpi_waitstaff_performance'];
const kpis = ['fn_get_financial_kpi', 'fn_get_menu_kpi', 'fn_get_kitchen_kpi', 'fn_get_waitstaff_kpi'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function onlyKeys(body: Record<string, unknown>, allowed: string[]) {
  assertAllowed(Object.keys(body).length > 0 && Object.keys(body).every((key) => allowed.includes(key)), 'Trường cập nhật không được phép.');
}
function idsForWrite(req: NextRequest) {
  const value = req.nextUrl.searchParams.get('id') || '';
  const ids = value.startsWith('eq.') ? [value.slice(3)] : value.startsWith('in.(') && value.endsWith(')') ? value.slice(4, -1).split(',') : [];
  assertAllowed(ids.length > 0 && ids.length <= 100 && ids.every((id) => uuid.test(id)), 'Cần ID cụ thể cho thao tác cập nhật.', 400);
  assertAllowed(!req.nextUrl.searchParams.has('or') && !req.nextUrl.searchParams.has('and'), 'Bộ lọc cập nhật không hợp lệ.', 400);
  return ids;
}
function result(req: NextRequest, rows: unknown[]) {
  return NextResponse.json(req.headers.get('accept')?.includes('vnd.pgrst.object') ? rows[0] : rows, { headers: { 'Cache-Control': 'no-store' } });
}

async function writeSession(req: NextRequest, body: Record<string, unknown>, actor: StaffProfileRow) {
  assertAllowed(actor.role !== 'kitchen');
  const db = createSupabaseServiceRoleClient();
  if (req.method === 'POST') {
    onlyKeys(body, ['session_token', 'session_type', 'table_id', 'assigned_staff_id', 'status', 'payment_code', 'total_amount', 'opened_at']);
    assertAllowed(body.session_type === 'DINE_IN' && typeof body.table_id === 'string' && uuid.test(body.table_id), 'Chỉ mở bàn tại quán qua API nội bộ.', 400);
    const id = crypto.randomUUID();
    const reserved = await db.from('tables').update({ status: 'OCCUPIED' }).eq('id', body.table_id).eq('status', 'AVAILABLE').is('current_session_id', null).select('id').maybeSingle();
    assertAllowed(!reserved.error && reserved.data, 'Bàn vừa được mở hoặc đang có khách.', 409);
    const created = await db.from('table_sessions').insert({ id, table_id: body.table_id, session_type: 'DINE_IN', assigned_staff_id: actor.id, status: 'ACTIVE', session_token: crypto.randomUUID(), payment_code: `DZO${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`, total_amount: 0 }).select('*').single();
    if (created.error || !created.data) {
      await db.from('tables').update({ status: 'AVAILABLE' }).eq('id', body.table_id).is('current_session_id', null);
      throw new ApiError('Không mở được bàn.', 502);
    }
    const linked = await db.from('tables').update({ current_session_id: id }).eq('id', body.table_id).is('current_session_id', null);
    if (linked.error) throw new ApiError('Đã mở phiên nhưng chưa liên kết được bàn. Vui lòng tải lại.', 502);
    return result(req, [created.data]);
  }
  assertAllowed(req.method === 'PATCH');
  onlyKeys(body, ['table_id', 'assigned_staff_id', 'status', 'payment_method', 'total_amount', 'closed_at']);
  const ids = idsForWrite(req); assertAllowed(ids.length === 1);
  const session = await getSession(ids[0]);
  const totalOnly = Object.keys(body).every((key) => key === 'total_amount');
  assertAllowed(totalOnly || ownsSession(actor, session));
  assertAllowed(session.status !== 'CLOSED', 'Hóa đơn đã đóng.', 409);
  if (body.status === 'ACTIVE') {
    assertAllowed(isManager(actor.role));
    return result(req, [await activateTakeaway(session, actor.id)]);
  }
  const update: TableSessionUpdate = {};
  if (body.payment_method !== undefined) {
    assertAllowed(body.payment_method === 'CASH' || body.payment_method === 'VIETQR', 'Phương thức thanh toán không hợp lệ.', 400);
    update.payment_method = body.payment_method;
  }
  if (body.status !== undefined) {
    assertAllowed(['ACTIVE', 'REQUEST_BILL'].includes(session.status) && ['REQUEST_BILL', 'CLOSED'].includes(String(body.status)), 'Chuyển trạng thái phiên không hợp lệ.', 409);
    update.status = body.status as 'REQUEST_BILL' | 'CLOSED';
    if (update.status === 'CLOSED') update.closed_at = new Date().toISOString();
  }
  if (body.assigned_staff_id !== undefined) {
    if (body.assigned_staff_id === null) {
      assertAllowed(isManager(actor.role)); update.assigned_staff_id = null;
    } else {
      assertAllowed(typeof body.assigned_staff_id === 'string', 'Chọn nhân viên phụ trách.', 400);
      const target = await db.from('staff_profiles').select('id,role,is_active').eq('id', body.assigned_staff_id).single();
      assertAllowed(target.data?.is_active && target.data.role !== 'kitchen', 'Nhân viên không hợp lệ.', 400);
      update.assigned_staff_id = body.assigned_staff_id;
    }
  }
  let reservedTable: string | null = null;
  if (body.table_id !== undefined && body.table_id !== session.table_id) {
    assertAllowed(session.session_type === 'DINE_IN' && typeof body.table_id === 'string' && uuid.test(body.table_id), 'Bàn đích không hợp lệ.', 400);
    const reservation = await db.from('tables').update({ status: 'OCCUPIED', current_session_id: session.id }).eq('id', body.table_id).eq('status', 'AVAILABLE').is('current_session_id', null).select('id').maybeSingle();
    assertAllowed(!reservation.error && reservation.data, 'Bàn đích đã có khách.', 409);
    reservedTable = body.table_id; update.table_id = body.table_id;
  }
  update.total_amount = await recalculateTotal(session.id);
  let query = db.from('table_sessions').update(update).eq('id', session.id).eq('status', session.status);
  query = session.table_id ? query.eq('table_id', session.table_id) : query.is('table_id', null);
  const saved = await query.select('*').maybeSingle();
  if (saved.error || !saved.data) {
    if (reservedTable) await db.from('tables').update({ status: 'AVAILABLE', current_session_id: null }).eq('id', reservedTable).eq('current_session_id', session.id);
    throw new ApiError('Phiên bàn vừa thay đổi. Vui lòng tải lại.', 409);
  }
  if (session.table_id && (reservedTable || update.status === 'CLOSED')) {
    const freed = await db.from('tables').update({ status: 'AVAILABLE', current_session_id: null }).eq('id', session.table_id).eq('current_session_id', session.id);
    if (freed.error) throw new ApiError('Phiên đã lưu nhưng chưa giải phóng bàn. Vui lòng tải lại và kiểm tra bàn.', 502);
  }
  return result(req, [saved.data]);
}

async function writeOrders(req: NextRequest, body: unknown, actor: StaffProfileRow) {
  const db = createSupabaseServiceRoleClient();
  if (req.method === 'POST') {
    assertAllowed(actor.role !== 'kitchen');
    const rows = Array.isArray(body) ? body.map(objectBody) : [objectBody(body)];
    assertAllowed(rows.length > 0 && rows.length <= 50 && rows.every((row) => row.session_id === rows[0].session_id) && typeof rows[0].session_id === 'string');
    return result(req, await addOrderItems(await getSession(rows[0].session_id), rows));
  }
  assertAllowed(req.method === 'PATCH');
  const input = objectBody(body);
  onlyKeys(input, ['status', 'batch_id', 'cooking_started_at', 'ready_at', 'served_at', 'served_by_staff_id', 'cancelled_at', 'cancelled_by', 'cancel_reason']);
  const ids = idsForWrite(req);
  const selected = await db.from('order_items').select('*').in('id', ids);
  assertAllowed(!selected.error && selected.data?.length === new Set(ids).size, 'Món không tồn tại.', 404);
  const updates: { id: string; status: OrderItemRow['status']; data: OrderItemUpdate; sessionId: string }[] = [];
  for (const item of selected.data) {
    const session = await getSession(item.session_id);
    assertAllowed(['ACTIVE', 'REQUEST_BILL'].includes(session.status), 'Phiên bàn không còn mở.', 409);
    const now = new Date().toISOString();
    let data: OrderItemUpdate;
    switch (input.status) {
      case 'COOKING':
        assertAllowed((actor.role === 'kitchen' || isManager(actor.role)) && item.station === 'KITCHEN' && item.status === 'QUEUED');
        assertAllowed(input.batch_id == null || typeof input.batch_id === 'string' && uuid.test(input.batch_id), 'Mã mẻ không hợp lệ.', 400);
        data = { status: 'COOKING', cooking_started_at: now, batch_id: (input.batch_id as string | null) ?? null }; break;
      case 'READY':
        assertAllowed((actor.role === 'kitchen' || isManager(actor.role)) && item.station === 'KITCHEN' && ['QUEUED', 'COOKING'].includes(item.status));
        data = { status: 'READY', ready_at: now }; break;
      case 'SERVED':
        assertAllowed((actor.role === 'staff' || isManager(actor.role)) && item.status === 'READY');
        data = { status: 'SERVED', served_at: now, served_by_staff_id: actor.id }; break;
      case 'CANCELLED':
        assertAllowed(isManager(actor.role) || actor.role === 'staff' && item.status === 'QUEUED');
        assertAllowed(item.status !== 'CANCELLED' && typeof input.cancel_reason === 'string' && input.cancel_reason.trim().length > 0 && input.cancel_reason.length <= 500, 'Cần lý do hủy món.', 400);
        data = { status: 'CANCELLED', cancelled_at: now, cancelled_by: actor.id, cancel_reason: input.cancel_reason.trim() }; break;
      default: throw new ApiError('Trạng thái cập nhật không hợp lệ.');
    }
    updates.push({ id: item.id, status: item.status, data, sessionId: item.session_id });
  }
  const saved = [];
  for (const update of updates) {
    const row = await db.from('order_items').update(update.data).eq('id', update.id).eq('status', update.status).select('*').maybeSingle();
    assertAllowed(!row.error && row.data, 'Món vừa đổi trạng thái. Vui lòng tải lại.', 409); saved.push(row.data);
  }
  if (input.status === 'CANCELLED') for (const id of new Set(updates.map((entry) => entry.sessionId))) await recalculateTotal(id);
  return result(req, saved);
}

export async function proxyToSupabase(req: NextRequest, params: Promise<{ path: string[] }>) {
  try {
    const { path } = await params;
    assertAllowed(!['accept-profile', 'content-profile'].some((key) => req.headers.has(key) && req.headers.get(key) !== 'public'));
    const actor = await getCurrentStaffProfile(); assertAllowed(actor?.is_active, 'Cần tài khoản nhân sự đang hoạt động.', 401);
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (!read) { const origin = req.headers.get('origin'); assertAllowed(!origin || origin === req.nextUrl.origin, 'Nguồn request không hợp lệ.'); }
    const table = path[2];
    const isRest = path[0] === 'rest' && path[1] === 'v1';
    const storage = path[0] === 'storage' && path[1] === 'v1' && table === 'object' && path[3] === 'menu-images' && path.length === 5 && /^[a-zA-Z0-9_-]+\.webp$/.test(path[4]);
    const rpc = isRest && table === 'rpc' && path.length === 4 && kpis.includes(path[3]);
    assertAllowed(storage || rpc || isRest && path.length === 3 && (coreTables.includes(table) || reports.includes(table)), 'API không được phép.');
    if (storage || rpc || reports.includes(table)) assertAllowed(isManager(actor.role));
    if (actor.role === 'kitchen') assertAllowed(['menu_items', 'order_items', 'table_sessions', 'tables', 'zones'].includes(table));
    if (!read && !storage && !rpc) {
      if (req.method === 'DELETE') {
        assertAllowed(isManager(actor.role) && ['zones', 'tables', 'menu_items', 'ingredients'].includes(table)); idsForWrite(req);
      } else {
        const body: unknown = await req.clone().json();
        if (table === 'order_items') return await writeOrders(req, body, actor);
        const data = objectBody(body);
        if (table === 'table_sessions') return await writeSession(req, data, actor);
        if (table === 'tables' && req.method === 'POST') {
          assertAllowed(isManager(actor.role));
          onlyKeys(data, ['table_number']);
          const label = numberedTable(data.table_number);
          assertAllowed(label, 'Nhập số bàn từ 1 đến 9999.', 400);
          const db = createSupabaseServiceRoleClient();
          const duplicate = await db.from('tables').select('id').eq('table_number', label).maybeSingle();
          assertAllowed(!duplicate.error, 'Chưa kiểm tra được số bàn.', 502);
          assertAllowed(!duplicate.data, 'Số bàn này đã có rồi.', 409);
          const zoneId = await restaurantZone(db);
          const row = await db.from('tables').insert({ table_number: label, zone_id: zoneId, status: 'AVAILABLE' }).select('*').single();
          assertAllowed(!row.error && row.data, 'Chưa thêm được bàn. Vui lòng thử lại.', 502);
          return result(req, [row.data]);
        }
        if (table === 'tables' && req.method === 'PATCH' && (!isManager(actor.role) || Object.keys(data).every((key) => ['status', 'current_session_id'].includes(key)))) {
          onlyKeys(data, ['status', 'current_session_id']); const ids = idsForWrite(req);
          const rows = await createSupabaseServiceRoleClient().from('tables').select('*').in('id', ids);
          assertAllowed(!rows.error && rows.data?.length === ids.length && rows.data.every((row) => (data.status === undefined || data.status === row.status) && (data.current_session_id === undefined || data.current_session_id === row.current_session_id)), 'Trạng thái bàn phải thay đổi qua phiên bàn.', 409);
          return result(req, rows.data);
        }
        if (actor.role === 'kitchen' && table === 'menu_items') {
          assertAllowed(req.method === 'PATCH'); onlyKeys(data, ['is_available']); assertAllowed(typeof data.is_available === 'boolean'); idsForWrite(req);
        } else {
          assertAllowed(isManager(actor.role) && ['POST', 'PATCH'].includes(req.method)); onlyKeys(data, columns[table] ?? []);
          if (req.method === 'PATCH' && table !== 'staff_profiles') idsForWrite(req);
          if (table === 'staff_profiles') {
            const filter = req.nextUrl.searchParams.get('id'); const id = req.method === 'POST' ? data.id : filter?.startsWith('eq.') ? filter.slice(3) : null;
            assertAllowed(typeof id === 'string' && /^user_[a-zA-Z0-9]+$/.test(id));
            if (req.method === 'PATCH') assertAllowed(data.id === undefined && !req.nextUrl.searchParams.has('or') && !req.nextUrl.searchParams.has('and'));
            const existing = await createSupabaseServiceRoleClient().from('staff_profiles').select('role').eq('id', id).maybeSingle();
            assertAllowed(!existing.error && (!existing.data || canManageRole(actor.role, existing.data.role)));
            assertAllowed(data.role === undefined || isStaffRole(data.role) && canManageRole(actor.role, data.role));
            assertAllowed(id !== actor.id || (data.role === undefined || data.role === actor.role) && data.is_active !== false);
            const user = await (await clerkClient()).users.getUser(id); assertAllowed(actor.role === 'operator' || !isConfiguredOperator(user));
            if (!existing.data) assertAllowed(isStaffRole(data.role));
          }
        }
      }
    }
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; assertAllowed(serviceKey, 'Thiếu SUPABASE_SERVICE_ROLE_KEY.', 503);
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, ''); assertAllowed(base, 'Thiếu Supabase URL.', 503);
    const query = new URLSearchParams(req.nextUrl.search);
    if (read && table === 'staff_profiles') query.set('select', 'id,full_name,role,assigned_zone_id,is_active');
    if (storage && !read) assertAllowed(req.method === 'POST' && req.headers.get('content-type') === 'image/webp', 'Chỉ cho phép tải ảnh WebP.', 400);
    const headers = new Headers({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });
    for (const name of ['accept', 'content-type', 'prefer', 'range', 'x-upsert', 'cache-control']) { const value = req.headers.get(name); if (value) headers.set(name, value); }
    const body = !read && req.method !== 'DELETE' ? await req.arrayBuffer() : undefined;
    if (storage && body) assertAllowed(body.byteLength < 80 * 1024, 'Ảnh phải nhỏ hơn 80KB.', 400);
    const upstream = await fetch(`${base}/${path.join('/')}?${query}`, { method: req.method, headers, body, cache: 'no-store' });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-range', 'preference-applied']) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value); }
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) { return NextResponse.json({ message: error instanceof ApiError ? error.message : 'Không thực hiện được thao tác dữ liệu.' }, { status: error instanceof ApiError ? error.status : 500 }); }
}
