import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { syncClerkStaffToSupabase } from '@/lib/supabase/sync-staff';
import { StaffDashboard } from '@/components/staff/StaffDashboard';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const supabase = await createSupabaseServerClient();
  const { userId, role: currentStaffRole } =
    await syncClerkStaffToSupabase(supabase);

  if (currentStaffRole === 'kitchen') {
    redirect('/kitchen');
  }

  const [
    tablesRes,
    sessionsRes,
    orderItemsRes,
    menuRes,
    ingredientsRes,
    staffRes,
  ] = await Promise.all([
    supabase
      .from('tables')
      .select('id, table_number, zone_id, status, current_session_id')
      .order('table_number', { ascending: true }),
    supabase
      .from('table_sessions')
      .select(
        'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at'
      )
      .neq('status', 'CLOSED'),
    supabase
      .from('order_items')
      .select(
        'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason'
      )
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
      )
      .order('category', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_threshold, unit_cost'),
    supabase
      .from('staff_profiles')
      .select(
        'id, full_name, role, assigned_zone_id, push_subscription, is_active'
      )
      .order('full_name', { ascending: true }),
  ]);

  return (
    <StaffDashboard
      initialTables={tablesRes.data ?? []}
      initialSessions={sessionsRes.data ?? []}
      initialOrderItems={orderItemsRes.data ?? []}
      menuItems={menuRes.data ?? []}
      initialIngredients={ingredientsRes.data ?? []}
      staffProfiles={staffRes.data ?? []}
      currentStaffId={userId}
      currentStaffRole={currentStaffRole}
    />
  );
}
