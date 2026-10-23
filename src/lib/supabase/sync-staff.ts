import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { StaffRole } from '@/types/database.types';

export interface StaffIdentity {
  userId: string;
  role: StaffRole;
  isActive: true;
}

export type StaffAccessResult =
  | { status: 'authorized'; staff: StaffIdentity }
  | { status: 'unauthenticated' | 'forbidden' | 'unavailable' };

function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'staff' || value === 'kitchen';
}

/** Read existing access only. Never provision from login or cache across requests. */
export async function getCurrentStaffAccess(): Promise<StaffAccessResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { status: 'unauthenticated' };

    const supabase = createSupabaseServiceRoleClient();
    const { data: profile, error } = await supabase
      .from('staff_profiles')
      .select('id, role, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (error) return { status: 'unavailable' };
    if (
      !profile ||
      profile.id !== userId ||
      profile.is_active !== true ||
      !isStaffRole(profile.role)
    ) {
      return { status: 'forbidden' };
    }
    return {
      status: 'authorized',
      staff: { userId, role: profile.role, isActive: true },
    };
  } catch {
    // Clerk, database and configuration failures never grant privileges.
    return { status: 'unavailable' };
  }
}
