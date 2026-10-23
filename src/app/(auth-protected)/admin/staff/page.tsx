import { readAll } from '@/lib/data/lists';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { StaffAndTableManager } from '@/components/admin/StaffAndTableManager';

export const dynamic = 'force-dynamic';

export default async function AdminStaffPage() {
  const { userId } = await requireStaffPage(['admin']);
  const supabase = await createSupabaseServiceRoleClient();

  const [zonesResult, tablesResult, staffResult, sessionsResult] =
    await Promise.all([
      readAll(after => { const q = supabase
        .from('zones')
        .select('id, name, created_at').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
      readAll(after => { const q = supabase
        .from('tables')
        .select('id, table_number, zone_id, status, current_session_id').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
      readAll(after => { const q = supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, push_subscription, is_active'
        ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
      readAll(after => { const q = supabase
        .from('table_sessions')
        .select(
          'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, activated_at, closed_at'
        )
        .in('status', ['ACTIVE', 'REQUEST_BILL']).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    ]);

  tablesResult.data.sort((a,b) => a.table_number.localeCompare(b.table_number, 'vi', {numeric:true}));
  zonesResult.data.sort((a,b) => a.created_at.localeCompare(b.created_at, 'vi', {numeric:true}));
  staffResult.data.sort((a,b) => a.full_name.localeCompare(b.full_name, 'vi', {numeric:true}));
  return (
    <StaffAndTableManager
      currentAdminId={userId}
      initialZones={zonesResult.data ?? []}
      initialTables={tablesResult.data ?? []}
      initialStaff={staffResult.data.map(staff => ({
        id: staff.id, full_name: staff.full_name, role: staff.role,
        assigned_zone_id: staff.assigned_zone_id, is_active: staff.is_active,
        has_push_subscription: staff.push_subscription !== null,
      }))}
      initialActiveSessions={sessionsResult.data ?? []}
    />
  );
}
