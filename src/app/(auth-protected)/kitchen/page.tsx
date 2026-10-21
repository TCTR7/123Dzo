import { createSupabaseServerClient } from '@/lib/supabase/server';
import { KitchenKdsBoard } from '@/components/kitchen/KitchenKdsBoard';

export const dynamic = 'force-dynamic';

export default async function KitchenPage() {
  const supabase = await createSupabaseServerClient();

  const [ordersRes, sessionsRes, tablesRes, menuRes] = await Promise.all([
    supabase
      .from('order_items')
      .select(
        'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason'
      )
      .eq('station', 'KITCHEN')
      .in('status', ['QUEUED', 'COOKING'])
      .order('created_at', { ascending: true }),
    supabase
      .from('table_sessions')
      .select(
        'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at'
      )
      .in('status', ['ACTIVE', 'REQUEST_BILL']),
    supabase
      .from('tables')
      .select('id, table_number, zone_id, status, current_session_id'),
    supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
      )
      .order('name', { ascending: true }),
  ]);

  const activeSessionIds = new Set(
    (sessionsRes.data ?? []).map((s) => s.id)
  );

  // Chỉ giữ lại các order_items thuộc các phiên đang ACTIVE hoặc REQUEST_BILL
  // Đảm bảo đơn mang về chưa thanh toán (PENDING_PAYMENT) không bao giờ lọt vào màn hình Bếp (Mục 3.2 AGENTS.md)
  const initialKitchenOrders = (ordersRes.data ?? []).filter((o) =>
    activeSessionIds.has(o.session_id)
  );

  return (
    <KitchenKdsBoard
      initialKitchenOrders={initialKitchenOrders}
      initialActiveSessions={sessionsRes.data ?? []}
      tables={tablesRes.data ?? []}
      initialMenuItems={menuRes.data ?? []}
    />
  );
}
