import { createSupabaseServerClient } from '@/lib/supabase/server';
import { StaffAndTableManager } from '@/components/admin/StaffAndTableManager';

export const dynamic = 'force-dynamic';

export default async function AdminStaffPage() {
  const supabase = await createSupabaseServerClient();

  const [zonesResult, tablesResult, staffResult, sessionsResult] =
    await Promise.all([
      supabase
        .from('zones')
        .select('id, name, created_at')
        .order('created_at', { ascending: true }),
      supabase
        .from('tables')
        .select('id, table_number, zone_id, status, current_session_id')
        .order('table_number', { ascending: true }),
      supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, push_subscription, is_active'
        )
        .order('full_name', { ascending: true }),
      supabase
        .from('table_sessions')
        .select(
          'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at'
        )
        .neq('status', 'CLOSED'),
    ]);

  return (
    <StaffAndTableManager
      initialZones={zonesResult.data ?? []}
      initialTables={tablesResult.data ?? []}
      initialStaff={staffResult.data ?? []}
      initialActiveSessions={sessionsResult.data ?? []}
    />
  );
}
