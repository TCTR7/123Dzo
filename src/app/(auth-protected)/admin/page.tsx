import { readAdminAnalytics } from '@/lib/data/analytics';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { AdminKpiDashboard } from '@/components/admin/AdminKpiDashboard';
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await requireStaffPage(['admin']);
  const data=await readAdminAnalytics();
  return (
    <AdminKpiDashboard
      initialFinancial={data.financial}
      initialPeakHours={data.peak}
      initialMenuAnalytics={data.menu}
      initialKitchenKpi={data.kitchen}
      initialWaitstaffKpi={data.staff}
      initialUpdatedAt={new Date().toISOString()}
    />
  );
}
