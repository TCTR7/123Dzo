import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminKpiDashboard } from '@/components/admin/AdminKpiDashboard';
import { reportRange, weekdayVisits } from '@/lib/dashboard';
import type { TableSessionRow } from '@/types/database.types';
export const dynamic = 'force-dynamic';
export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ start?: string; end?: string }> }) {
  const p = await searchParams, range = reportRange(p.start, p.end), db = await createSupabaseServerClient();
  const args = { p_start_date: range.start + 'T00:00:00+07:00', p_end_date: range.end + 'T23:59:59.999+07:00' };
  async function visits() {
    const rows: Pick<TableSessionRow, 'opened_at' | 'session_type' | 'status'>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await db.from('table_sessions').select('opened_at,session_type,status').in('status', ['ACTIVE', 'REQUEST_BILL', 'CLOSED']).gte('opened_at', args.p_start_date).lte('opened_at', args.p_end_date).order('id').range(offset, offset + 999);
      if (r.error) throw Error('Chưa tải được lượt bàn.');
      rows.push(...r.data ?? []);
      if ((r.data?.length ?? 0) < 1000) return weekdayVisits(rows, range.start, range.end);
    }
  }
  const [fin, menu, days] = await Promise.allSettled([db.rpc('fn_get_financial_kpi', args), db.rpc('fn_get_menu_kpi', args), visits()]);
  return <AdminKpiDashboard range={range} financial={fin.status === 'fulfilled' && !fin.value.error ? fin.value.data?.[0] ?? null : null} menu={menu.status === 'fulfilled' && !menu.value.error ? menu.value.data ?? [] : null} visits={days.status === 'fulfilled' ? days.value : null} />;
}
