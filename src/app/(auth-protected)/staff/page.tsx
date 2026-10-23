import { readAll } from '@/lib/data/lists';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { StaffDashboard } from '@/components/staff/StaffDashboard';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const { userId, role: currentStaffRole } =
    await requireStaffPage(['staff', 'admin']);
  const supabase = await createSupabaseServiceRoleClient();

  const [
    zonesRes,
    tablesRes,
    sessionsRes,
    orderItemsRes,
    menuRes,
    staffRes,
  ] = await Promise.all([
    readAll(after => { const q = supabase
      .from('zones')
      .select('id, name, created_at').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('tables')
      .select('id, table_number, zone_id, status, current_session_id').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('table_sessions')
      .select(
        'id, session_token, session_type, table_id, assigned_staff_id, customer_name, status, payment_method, total_amount, opened_at, activated_at, closed_at'
      )
      .in('status', ['ACTIVE', 'REQUEST_BILL']).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('order_items')
      .select(
        'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancel_reason, table_sessions!inner(status)'
      ).in('table_sessions.status',['ACTIVE','REQUEST_BILL']).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, prep_time_minutes, image_url, is_available'
      ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('staff_profiles')
      .select(
        'id, full_name, role, assigned_zone_id, is_active'
      ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
  ]);

  tablesRes.data.sort((a,b) => a.table_number.localeCompare(b.table_number, 'vi', {numeric:true}));
  zonesRes.data.sort((a,b) => a.created_at.localeCompare(b.created_at, 'vi', {numeric:true}));
  menuRes.data.sort((a,b) => a.name.localeCompare(b.name, 'vi', {numeric:true}));
  staffRes.data.sort((a,b) => a.full_name.localeCompare(b.full_name, 'vi', {numeric:true}));
  return (
    <StaffDashboard
      initialZones={zonesRes.data ?? []}
      initialTables={tablesRes.data ?? []}
      initialSessions={sessionsRes.data ?? []}
      initialOrderItems={orderItemsRes.data ?? []}
      menuItems={menuRes.data ?? []}
      staffProfiles={staffRes.data ?? []}
      currentStaffId={userId}
      currentStaffRole={currentStaffRole}
    />
  );
}
