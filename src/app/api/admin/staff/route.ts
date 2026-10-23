import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { parseSaveStaffRequest } from '@/lib/auth/staff-profile';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: status === 503 } }, { status });
}

export async function POST(req: Request) {
  const access = await requireStaffApi(['admin']);
  if (access.response) return access.response;
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  }

  try {
    const input = parseSaveStaffRequest(await readJson(req));
    if (!input) return failure(400, 'INVALID_STAFF_PROFILE', 'Thông tin nhân sự không hợp lệ.');

    if (input.action === 'create') {
      try {
        const clerk = await clerkClient();
        const user = await clerk.users.getUser(input.profile.id);
        if (user.id !== input.profile.id || user.banned || user.locked) {
          return failure(422, 'CLERK_USER_UNAVAILABLE', 'Tài khoản Clerk chưa thể được cấp quyền.');
        }
      } catch (error) {
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          return failure(404, 'CLERK_USER_NOT_FOUND', 'Không tìm thấy tài khoản Clerk.');
        }
        return failure(503, 'CLERK_UNAVAILABLE', 'Chưa thể xác minh tài khoản Clerk. Vui lòng thử lại sau.');
      }
    }

    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase.rpc('fn_admin_save_staff', {
      p_actor_id: access.staff.userId,
      p_profile: { ...input.profile },
      p_expected: input.expected ? { ...input.expected } : null,
    });
    if (error) {
      if (error.code === '42501') return failure(403, 'FORBIDDEN', 'Quyền quản lý đã thay đổi. Vui lòng tải lại trang.');
      if (error.code === 'P0002') return failure(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự.');
      if (error.code === '23505') return failure(409, 'STAFF_EXISTS', 'Hồ sơ nhân sự đã tồn tại. Vui lòng tải lại trang.');
      if (error.code === 'P0001') return failure(409, 'LAST_ADMIN', 'Phải giữ ít nhất một quản trị viên đang hoạt động.');
      if (error.code === '40001') return failure(409, 'STAFF_CHANGED', 'Hồ sơ đã được thay đổi. Vui lòng tải lại trang trước khi sửa.');
      if (error.code === '23503' || error.code === '22023') return failure(400, 'INVALID_STAFF_PROFILE', 'Hồ sơ hoặc khu vực không hợp lệ.');
      return failure(503, 'STAFF_SAVE_UNAVAILABLE', 'Chưa thể lưu nhân sự. Vui lòng kiểm tra lại trước khi thử lại.');
    }
    const profile = data?.[0];
    if (!profile) return failure(503, 'STAFF_SAVE_UNAVAILABLE', 'Chưa xác nhận được kết quả lưu nhân sự.');
    return NextResponse.json({ data: profile }, { status: input.action === 'create' ? 201 : 200 });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status, 'INVALID_REQUEST_BODY', error.message);
    return failure(503, 'STAFF_SAVE_UNAVAILABLE', 'Chưa thể lưu nhân sự. Vui lòng thử lại sau.');
  }
}
