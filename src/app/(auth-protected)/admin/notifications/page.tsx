import { requireStaffPage } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { parseNotificationStatus } from '@/lib/notifications/contracts';
import { NotificationJobs } from '@/components/admin/NotificationJobs';
export const dynamic = 'force-dynamic';
export default async function NotificationsPage() {
  const staff = await requireStaffPage(['admin']);
  const { data, error } = await createSupabaseServiceRoleClient().rpc('fn_admin_notification_jobs', { p_actor_id: staff.userId });
  const status = !error && parseNotificationStatus(data);
  if (!status) throw new Error('NOTIFICATION_STATUS_UNAVAILABLE');
  return <NotificationJobs status={status} />;
}
