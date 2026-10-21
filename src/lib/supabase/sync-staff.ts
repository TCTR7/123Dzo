import { auth, currentUser } from '@clerk/nextjs/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { Database, StaffRole } from '@/types/database.types';

/**
 * Tự động đồng bộ (Auto-Upsert) tài khoản đang đăng nhập từ Clerk sang bảng `staff_profiles` của Supabase.
 * Giúp các cột khóa ngoại (assigned_staff_id, served_by_staff_id, created_by) luôn hợp lệ 100%
 * và đảm bảo phân quyền theo đúng role trong bảng `staff_profiles`.
 */
export async function syncClerkStaffToSupabase(
  _supabase?: SupabaseClient<Database>
): Promise<{
  userId: string | null;
  role: StaffRole;
  isActive: boolean;
}> {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) {
      return { userId: null, role: 'admin', isActive: true };
    }

    // Sử dụng Service Role Client để đảm bảo luôn đọc/ghi được staff_profiles bất kể cấu hình RLS
    const adminSupabase = createSupabaseServiceRoleClient();

    const rawMetadata = (
      sessionClaims as Record<string, unknown> | null | undefined
    )?.metadata as { role?: StaffRole } | undefined;
    const rawPublicMetadata = (
      sessionClaims as Record<string, unknown> | null | undefined
    )?.publicMetadata as { role?: StaffRole } | undefined;

    const candidateRole = rawMetadata?.role ?? rawPublicMetadata?.role;
    const clerkRole: StaffRole =
      candidateRole === 'admin' ||
      candidateRole === 'kitchen' ||
      candidateRole === 'staff'
        ? candidateRole
        : 'admin';

    // 1. Kiểm tra xem userId của Clerk đã tồn tại trong bảng staff_profiles chưa
    const { data: existingProfile } = await adminSupabase
      .from('staff_profiles')
      .select('id, role, is_active')
      .eq('id', userId)
      .single();

    if (existingProfile) {
      // Ưu tiên role trong bảng staff_profiles để Chủ quán có thể đổi quyền nhân sự trực tiếp tại /admin/staff
      return {
        userId,
        role: existingProfile.role,
        isActive: existingProfile.is_active,
      };
    }

    // 2. Nếu chưa có trong Supabase, lấy tên hiển thị từ Clerk và tự động tạo mới trong staff_profiles
    const clerkUser = await currentUser().catch(() => null);
    const fullName =
      [clerkUser?.firstName, clerkUser?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      clerkUser?.username ||
      clerkUser?.emailAddresses?.[0]?.emailAddress ||
      `Nhân sự (${userId.slice(-5)})`;

    await adminSupabase.from('staff_profiles').upsert(
      {
        id: userId,
        full_name: fullName,
        role: clerkRole,
        is_active: true,
      },
      { onConflict: 'id' }
    );

    return { userId, role: clerkRole, isActive: true };
  } catch {
    return { userId: null, role: 'admin', isActive: true };
  }
}
