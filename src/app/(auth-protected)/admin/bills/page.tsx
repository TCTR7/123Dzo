import { readAll } from '@/lib/data/lists';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { BillsManager } from '@/components/admin/BillsManager';
import { listPage, LIST_PAGE_SIZE } from '@/lib/data/lists';
import { ListNavigation } from '@/components/ui/ListNavigation';

export const dynamic = 'force-dynamic';

export default async function AdminBillsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await requireStaffPage(['admin']);
  const params = await searchParams ?? {}, page = listPage(params.page);
  const status = params.status === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const supabase = await createSupabaseServiceRoleClient();

  let sessionsQuery = supabase.from('table_sessions').select('id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, activated_at, closed_at');
  sessionsQuery = status === 'CLOSED' ? sessionsQuery.eq('status', 'CLOSED') : sessionsQuery.in('status', ['ACTIVE', 'REQUEST_BILL']);
  const [sessionsRes, tablesRes, menuRes, staffRes] =
    await Promise.all([
      sessionsQuery.order('status', {ascending:false}).order('opened_at', { ascending: false }).order('id', {ascending:false}).range((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
      readAll(after => { const q = supabase
        .from('tables')
        .select('id, table_number, zone_id, status, current_session_id').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
      readAll(after => { const q = supabase
        .from('menu_items')
        .select(
          'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
        ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
      readAll(after => { const q = supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, is_active'
        ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    ]);

  if (sessionsRes.error || !sessionsRes.data) throw new Error('Không tải được danh sách hóa đơn.');
  tablesRes.data.sort((a,b) => a.table_number.localeCompare(b.table_number, 'vi', {numeric:true}));
  return (<>
    <ListNavigation path="/admin/bills" page={page} hasNext={sessionsRes.data.length > LIST_PAGE_SIZE} params={{status}} label="Hóa đơn" />
    <BillsManager
      initialSessions={sessionsRes.data.slice(0, LIST_PAGE_SIZE)}
      initialOrderItems={[]}
      listStatus={status}
      remoteList
      tables={tablesRes.data ?? []}
      menuItems={menuRes.data ?? []}
      staffProfiles={staffRes.data ?? []}
      currentAdminId={userId}
    /></>
  );
}
