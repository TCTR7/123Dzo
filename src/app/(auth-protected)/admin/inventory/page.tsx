import { createSupabaseServerClient } from '@/lib/supabase/server';
import { syncClerkStaffToSupabase } from '@/lib/supabase/sync-staff';
import { InventoryManager } from '@/components/admin/InventoryManager';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPage() {
  const supabase = await createSupabaseServerClient();
  const { userId } = await syncClerkStaffToSupabase(supabase);

  const [ingredientsResult, logsResult, staffResult] = await Promise.all([
    supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_threshold, unit_cost')
      .order('name', { ascending: true }),
    supabase
      .from('inventory_logs')
      .select(
        'id, ingredient_id, type, quantity_change, total_cost, note, created_by, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('staff_profiles')
      .select('id, full_name, role, assigned_zone_id, push_subscription, is_active'),
  ]);

  return (
    <InventoryManager
      initialIngredients={ingredientsResult.data ?? []}
      initialLogs={logsResult.data ?? []}
      staffProfiles={staffResult.data ?? []}
      currentStaffId={userId}
    />
  );
}
