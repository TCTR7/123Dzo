import { readAll } from '@/lib/data/lists';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/auth/staff-guard';
import { MenuManager } from '@/components/admin/MenuManager';

export const dynamic = 'force-dynamic';

export default async function AdminMenuPage() {
  const { userId } = await requireStaffPage(['admin']);
  const supabase = await createSupabaseServiceRoleClient();

  const [menuResult, ingredientsResult] = await Promise.all([
    readAll(after => { const q = supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
      ).order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
    readAll(after => { const q = supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_threshold, unit_cost').order('id', {ascending:true}).limit(250); return after ? q.gt('id', after) : q; }),
  ]);

  menuResult.data.sort((a,b) => a.name.localeCompare(b.name, 'vi', {numeric:true}));
  ingredientsResult.data.sort((a,b) => a.name.localeCompare(b.name, 'vi', {numeric:true}));
  return (
    <MenuManager
      currentStaffId={userId}
      initialMenuItems={menuResult.data ?? []}
      ingredients={ingredientsResult.data ?? []}
    />
  );
}
