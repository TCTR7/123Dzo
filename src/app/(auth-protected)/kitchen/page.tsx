import { readAll } from '@/lib/data/lists';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { KitchenKdsBoard } from '@/components/kitchen/KitchenKdsBoard';

export const dynamic = 'force-dynamic';

export default async function KitchenPage() {
  const { userId, role: currentStaffRole } = await requireStaffPage(['kitchen', 'admin']);
  const supabase = await createSupabaseServiceRoleClient();

  const [ordersRes, sessionsRes, tablesRes, menuRes] = await Promise.all([
    readAll(after => { const q = supabase
      .from('order_items')
      .select(
        'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancel_reason, table_sessions!inner(status)'
      )
      .eq('station', 'KITCHEN')
      .in('status', ['QUEUED', 'COOKING']).in('table_sessions.status',['ACTIVE','REQUEST_BILL']).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('table_sessions')
      .select(
        'id, session_type, table_id, customer_name, status, activated_at'
      )
      .in('status', ['ACTIVE', 'REQUEST_BILL']).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('tables')
      .select('id, table_number, zone_id, status, current_session_id').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, prep_time_minutes, image_url, is_available'
      ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
  ]);

  const activeSessionIds = new Set(
    (sessionsRes.data ?? []).map((s) => s.id)
  );

  // Chỉ giữ lại các order_items thuộc các phiên đang ACTIVE hoặc REQUEST_BILL
  // Đảm bảo đơn mang về chưa thanh toán (PENDING_PAYMENT) không bao giờ lọt vào màn hình Bếp (Mục 3.2 AGENTS.md)
  const initialKitchenOrders = (ordersRes.data ?? []).filter((o) =>
    activeSessionIds.has(o.session_id)
  );

  menuRes.data.sort((a,b) => a.name.localeCompare(b.name, 'vi', {numeric:true}));
  ordersRes.data.sort((a,b) => a.created_at.localeCompare(b.created_at, 'vi', {numeric:true}));
  return (
    <KitchenKdsBoard
      currentStaffId={userId}
      initialKitchenOrders={initialKitchenOrders}
      initialActiveSessions={sessionsRes.data ?? []}
      tables={tablesRes.data ?? []}
      initialMenuItems={menuRes.data ?? []}
      currentStaffRole={currentStaffRole}
    />
  );
}
