import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminKpiDashboard } from '@/components/admin/AdminKpiDashboard';
import type {
  KpiFinancialSummary,
  KpiKitchenPerformance,
} from '@/types/database.types';

export const dynamic = 'force-dynamic';

const DEFAULT_FINANCIAL: KpiFinancialSummary = {
  gross_revenue: 0,
  cash_revenue: 0,
  vietqr_revenue: 0,
  dine_in_revenue: 0,
  takeaway_revenue: 0,
  closed_sessions_count: 0,
  total_cogs: 0,
  total_wastage_cost: 0,
  net_profit: 0,
};

const DEFAULT_KITCHEN_KPI: KpiKitchenPerformance = {
  total_cooked_items: 0,
  batch_cooked_items: 0,
  avg_queue_wait_minutes: 0,
  avg_actual_cook_minutes: 0,
  avg_standard_prep_minutes: 0,
  cook_time_evaluation: 'ON_TIME',
  batch_cooking_efficiency_pct: 0,
  slow_cancelled_count: 0,
};

export default async function AdminDashboardPage() {
  const supabase = await createSupabaseServerClient();

  // Kết nối trực tiếp tới các PostgreSQL Views phục vụ Dashboard KPI (Mục 10.4 & Mục 11 PRD_SPEC.md)
  const [
    financialRes,
    peakHoursRes,
    menuAnalyticsRes,
    kitchenKpiRes,
    waitstaffKpiRes,
  ] = await Promise.all([
    supabase.from('vw_kpi_financial_summary').select('*').single(),
    supabase
      .from('vw_kpi_peak_hours')
      .select('*')
      .order('hour_of_day', { ascending: true }),
    supabase
      .from('vw_kpi_menu_analytics')
      .select('*')
      .order('total_quantity_sold', { ascending: false }),
    supabase.from('vw_kpi_kitchen_performance').select('*').single(),
    supabase
      .from('vw_kpi_waitstaff_performance')
      .select('*')
      .order('active_serving_count', { ascending: false }),
  ]);

  return (
    <AdminKpiDashboard
      initialFinancial={financialRes.data ?? DEFAULT_FINANCIAL}
      initialPeakHours={peakHoursRes.data ?? []}
      initialMenuAnalytics={menuAnalyticsRes.data ?? []}
      initialKitchenKpi={kitchenKpiRes.data ?? DEFAULT_KITCHEN_KPI}
      initialWaitstaffKpi={waitstaffKpiRes.data ?? []}
    />
  );
}
