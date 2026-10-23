import { auth, clerkClient } from '@clerk/nextjs/server';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { StaffProfileRow, StaffRole } from '@/types/database.types';

export class OperatorRoleConstraintError extends Error {
  constructor() {
    super('Database chưa cho phép vai trò operator. Cần cập nhật ràng buộc staff_profiles_role_check trong Supabase.');
    this.name = 'OperatorRoleConstraintError';
  }
}

export function isStaffRole(value: unknown): value is StaffRole {
  return value === 'operator' || value === 'admin' || value === 'staff' || value === 'kitchen';
}

export function isManager(role: StaffRole): boolean {
  return role === 'operator' || role === 'admin';
}

export function canManageRole(actor: StaffRole, target: StaffRole): boolean {
  return actor === 'operator' || (actor === 'admin' && (target === 'staff' || target === 'kitchen'));
}

export function getHomeByRole(role: StaffRole): string {
  return role === 'operator' ? '/operator' : role === 'admin' ? '/admin' : role === 'staff' ? '/staff' : '/kitchen';
}

export function isConfiguredOperator(user: {
  id: string;
  emailAddresses: Array<{ emailAddress: string; verification?: { status: string } | null }>;
}): boolean {
  const ids = (process.env.OPERATOR_CLERK_USER_IDS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const emails = (process.env.OPERATOR_EMAILS ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return ids.includes(user.id) || user.emailAddresses.some((email) =>
    email.verification?.status === 'verified' && emails.includes(email.emailAddress.toLowerCase())
  );
}

// Database roles are authoritative; stale/missing Clerk metadata never grants access.
export async function resolveStaffProfile(userId: string): Promise<StaffProfileRow | null> {
  const db = createSupabaseServiceRoleClient();
  const { data: existing, error } = await db.from('staff_profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error('Không thể kiểm tra quyền nhân sự. Vui lòng thử lại.');
  if (existing && !existing.is_active) return null;
  const user = await (await clerkClient()).users.getUser(userId);
  let bootstrap = isConfiguredOperator(user);
  if (!existing && !bootstrap) {
    const result = await db.from('staff_profiles').select('id', { count: 'exact', head: true });
    if (result.error) throw new Error('Không thể kiểm tra tài khoản khởi tạo.');
    bootstrap = result.count === 0;
  }
  if (bootstrap && existing?.role !== 'operator') {
    const { data, error: saveError } = await db.from('staff_profiles').upsert({
      id: userId,
      full_name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || user.emailAddresses[0]?.emailAddress || 'Operator',
      role: 'operator',
      is_active: true,
    }, { onConflict: 'id' }).select('*').single();
    if (saveError) {
      if (saveError.code === '23514' && saveError.message.includes('staff_profiles_role_check')) {
        throw new OperatorRoleConstraintError();
      }
      console.error('Operator bootstrap failed:', saveError.code, saveError.message);
      throw new Error('Không thể khởi tạo Operator. Kiểm tra cấu hình Supabase và thử lại.');
    }
    return data;
  }
  return existing;
}

export const getCurrentStaffProfile = cache(async (): Promise<StaffProfileRow | null> => {
  const { userId } = await auth();
  return userId ? resolveStaffProfile(userId) : null;
});

export async function requireStaffRole(allowed: StaffRole[]): Promise<StaffProfileRow> {
  const profile = await getCurrentStaffProfile();
  if (!profile) redirect('/access-denied');
  if (!allowed.includes(profile.role)) redirect(getHomeByRole(profile.role));
  return profile;
}
