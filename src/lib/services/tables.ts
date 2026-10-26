import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { ApiError } from './errors';
const defaultZoneId = '12300000-0000-4000-8000-000000000001';
// The existing schema requires zone_id. This compatibility value is hidden from users.
export async function restaurantZone(db: SupabaseClient<Database>) {
  const existing = await db.from('zones').select('id').order('created_at').limit(1).maybeSingle();
  if (existing.error) throw new ApiError('Chưa thêm được bàn. Vui lòng thử lại.', 502);
  if (existing.data) return existing.data.id;
  const saved = await db.from('zones').insert({ id: defaultZoneId, name: 'Quán' }).select('id').single();
  if (saved.data && !saved.error) return saved.data.id;
  const retry = await db.from('zones').select('id').eq('id', defaultZoneId).maybeSingle();
  if (retry.error || !retry.data) throw new ApiError('Chưa thêm được bàn. Vui lòng thử lại.', 502);
  return retry.data.id;
}
export function numberedTable(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const number = value.trim().replace(/^bàn\s*/i, '');
  return /^\d{1,4}$/.test(number) && Number(number) > 0 ? 'Bàn ' + Number(number) : null;
}
