import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MenuManager } from '@/components/admin/MenuManager';

export const dynamic = 'force-dynamic';

export default async function AdminMenuPage() {
  const supabase = await createSupabaseServerClient();

  const [menuResult, ingredientsResult] = await Promise.all([
    supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
      )
      .order('category', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_threshold, unit_cost')
      .order('name', { ascending: true }),
  ]);

  return (
    <MenuManager
      initialMenuItems={menuResult.data ?? []}
      ingredients={ingredientsResult.data ?? []}
    />
  );
}
