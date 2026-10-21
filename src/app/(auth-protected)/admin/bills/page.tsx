import { auth } from '@clerk/nextjs/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BillsManager } from '@/components/admin/BillsManager';

export const dynamic = 'force-dynamic';

export default async function AdminBillsPage() {
  const [{ userId }, supabase] = await Promise.all([
    auth().catch(() => ({ userId: null })),
    createSupabaseServerClient(),
  ]);

  const [sessionsRes, orderItemsRes, tablesRes, menuRes, staffRes] =
    await Promise.all([
      supabase
        .from('table_sessions')
        .select(
          'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at'
        )
        .order('opened_at', { ascending: false })
        .limit(100),
      supabase
        .from('order_items')
        .select(
          'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason'
        )
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('tables')
        .select('id, table_number, zone_id, status, current_session_id'),
      supabase
        .from('menu_items')
        .select(
          'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
        ),
      supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, push_subscription, is_active'
        ),
    ]);

  return (
    <BillsManager
      initialSessions={sessionsRes.data ?? []}
      initialOrderItems={orderItemsRes.data ?? []}
      tables={tablesRes.data ?? []}
      menuItems={menuRes.data ?? []}
      staffProfiles={staffRes.data ?? []}
      currentAdminId={userId}
    />
  );
}
