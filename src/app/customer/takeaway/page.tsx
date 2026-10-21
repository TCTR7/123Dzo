import { createSupabaseServerClient } from '@/lib/supabase/server';
import { TakeawayOrderView } from '@/components/customer/TakeawayOrderView';

export const dynamic = 'force-dynamic';

export default async function TakeawayPage() {
  const supabase = await createSupabaseServerClient();

  const { data: menuItems } = await supabase
    .from('menu_items')
    .select(
      'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
    )
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  return <TakeawayOrderView initialMenuItems={menuItems ?? []} />;
}
