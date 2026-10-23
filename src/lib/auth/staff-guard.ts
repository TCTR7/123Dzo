import 'server-only';

import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getCurrentStaffAccess, type StaffIdentity } from '@/lib/supabase/sync-staff';
import type { StaffRole } from '@/types/database.types';

const STAFF_HOME: Record<StaffRole, string> = {
  admin: '/admin',
  staff: '/staff',
  kitchen: '/kitchen',
};

/** Call before constructing a page's data client; layout guards alone are insufficient. */
export async function requireStaffPage(
  allowedRoles: readonly StaffRole[]
): Promise<StaffIdentity> {
  const access = await getCurrentStaffAccess();

  if (access.status === 'unauthenticated') redirect('/sign-in');
  if (access.status === 'unavailable') redirect('/access-denied?reason=unavailable');
  if (access.status !== 'authorized') redirect('/access-denied');
  if (!allowedRoles.includes(access.staff.role)) redirect(STAFF_HOME[access.staff.role]);

  return access.staff;
}

type ApiAccess =
  | { staff: StaffIdentity; response: null }
  | { staff: null; response: NextResponse };

/** Authorize independently of middleware, before business reads/writes. */
export async function requireStaffApi(allowedRoles: readonly StaffRole[]): Promise<ApiAccess> {
  const access = await getCurrentStaffAccess();
  if (access.status === 'authorized' && allowedRoles.includes(access.staff.role)) {
    return { staff: access.staff, response: null };
  }

  const unavailable = access.status === 'unavailable';
  const unauthenticated = access.status === 'unauthenticated';
  return {
    staff: null,
    response: NextResponse.json(
      {
        error: {
          code: unavailable ? 'AUTH_UNAVAILABLE' : unauthenticated ? 'UNAUTHENTICATED' : 'FORBIDDEN',
          message: unavailable
            ? 'Chưa thể kiểm tra quyền truy cập. Vui lòng thử lại sau.'
            : unauthenticated
              ? 'Vui lòng đăng nhập tài khoản nhân viên.'
              : 'Tài khoản chưa được cấp quyền thực hiện thao tác này.',
          retryable: unavailable,
        },
      },
      { status: unavailable ? 503 : unauthenticated ? 401 : 403 }
    ),
  };
}
