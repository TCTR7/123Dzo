import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { clerkClient } from '@clerk/nextjs/server';
import packageInfo from '../../../../package.json';
import { requireStaffRole } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { OperatorConsole } from '@/components/operator/OperatorConsole';
import { OnboardingGuideModal } from '@/components/shared/OnboardingGuideModal';

export const dynamic = 'force-dynamic';

export default async function OperatorPage() {
  const profile = await requireStaffRole(['operator']);
  const db = createSupabaseServiceRoleClient();
  const tables = ['staff_profiles', 'zones', 'tables', 'menu_items', 'table_sessions', 'order_items', 'ingredients', 'inventory_logs'] as const;
  const [counts, clerkConnected] = await Promise.all([
    Promise.all(tables.map(async (table) => {
      const { count, error } = await db.from(table).select('id', { count: 'exact', head: true });
      return { table, count: error ? null : count, connected: !error };
    })),
    (await clerkClient()).users.getUser(profile.id).then(() => true, () => false),
  ]);
  return <div className="min-h-screen bg-zinc-950 p-4 text-zinc-100 md:p-8">
    <header className="operator-screen-only mx-auto mb-6 flex max-w-6xl flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-bold tracking-widest text-amber-400">123DZÔ · OPERATOR</p><h1 className="text-2xl font-bold">Bàn giao hệ thống</h1></div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="text-sm text-amber-400">Quản trị quán</Link>
        <Link href="/staff" className="text-sm">Phục vụ</Link>
        <Link href="/kitchen" className="text-sm">Bếp</Link>
        <OnboardingGuideModal role="operator" /><UserButton />
      </div>
    </header>
    <OperatorConsole version={packageInfo.version} environment={process.env.NODE_ENV} buildTime={process.env.NEXT_PUBLIC_BUILD_TIME || ''}
      appUrl={process.env.NEXT_PUBLIC_APP_URL || ''} counts={counts} clerkConnected={clerkConnected} />
  </div>;
}
