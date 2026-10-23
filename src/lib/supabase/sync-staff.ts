import type { SupabaseClient } from '@supabase/supabase-js';
import { requireStaffRole } from '@/lib/auth/roles';
import type { Database } from '@/types/database.types';

export async function syncClerkStaffToSupabase(_supabase?: SupabaseClient<Database>) {
  const profile = await requireStaffRole(['operator', 'admin', 'staff', 'kitchen']);
  return { userId: profile.id, role: profile.role, isActive: profile.is_active };
}
