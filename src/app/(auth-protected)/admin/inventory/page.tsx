import { readAll } from '@/lib/data/lists';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { InventoryManager } from '@/components/admin/InventoryManager';
import { listPage, LIST_PAGE_SIZE } from '@/lib/data/lists';
import { ListNavigation } from '@/components/ui/ListNavigation';
import type { InventoryLogType } from '@/types/database.types';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await requireStaffPage(['admin']);
  const params = await searchParams ?? {}, page = listPage(params.page);
  const type: InventoryLogType | 'ALL' = params.type === 'IMPORT' || params.type === 'WASTAGE' || params.type === 'EXPORT_SALE' || params.type === 'RETURN_BEER' ? params.type : 'ALL';
  const supabase = await createSupabaseServiceRoleClient();

  let logsQuery = supabase.from('inventory_logs').select('id, ingredient_id, type, quantity_change, total_cost, note, created_by, created_at');
  if (type !== 'ALL') logsQuery = logsQuery.eq('type', type);
  const [ingredientsResult, logsResult, staffResult] = await Promise.all([
    readAll(after => { const q = supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_threshold, unit_cost').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    logsQuery.order('created_at', {ascending:false}).order('id', {ascending:false}).range((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
    readAll(after => { const q = supabase
      .from('staff_profiles')
      .select('id, full_name, role, assigned_zone_id, is_active').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
  ]);

  if (logsResult.error || !logsResult.data) throw new Error('Không tải được lịch sử kho.');
  ingredientsResult.data.sort((a,b) => a.name.localeCompare(b.name, 'vi', {numeric:true}));
  return (<>
    <ListNavigation path="/admin/inventory" page={page} hasNext={logsResult.data.length > LIST_PAGE_SIZE} params={{type}} label="Phiếu kho" />
    <InventoryManager
      initialIngredients={ingredientsResult.data ?? []}
      initialLogs={logsResult.data.slice(0, LIST_PAGE_SIZE)}
      initialLogType={type}
      remoteLogs
      staffProfiles={staffResult.data ?? []}
      currentStaffId={userId}
    /></>
  );
}
