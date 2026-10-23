import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { StaffRole } from '@/types/database.types';

/**
 * 1. Nhóm Route Công khai (Public Routes):
 * - Trang chủ (/)
 * - Khách gọi món tại bàn qua QR động (/customer/order/[session_token])
 * - Khách đặt mang về (/customer/takeaway)
 * - Webhook thanh toán PayOS/SePay (/api/webhooks/payment)
 * - Cron chống ngủ đông Supabase (/api/cron/keep-alive)
 * - Proxy kết nối Supabase nội bộ (/api/supabase-proxy)
 * - Trang đăng nhập/đăng ký Clerk (/sign-in, /sign-up)
 */
const isPublicRoute = createRouteMatcher([
  '/',
  '/customer/order/(.*)',
  '/customer/takeaway(.*)',
  '/api/webhooks/(.*)',
  '/api/cron/keep-alive(.*)',
  '/api/supabase-proxy/(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
]);

/**
 * 2. Nhóm Route Nội bộ phân quyền theo RBAC Matrix (Mục 7 & Mục 9.1):
 */
const isAdminRoute = createRouteMatcher(['/admin(.*)']);
const isKitchenRoute = createRouteMatcher(['/kitchen(.*)']);
const isStaffRoute = createRouteMatcher(['/staff(.*)']);
const isInternalPushApiRoute = createRouteMatcher(['/api/push/(.*)']);

interface ClerkSessionClaimsMetadata {
  role?: StaffRole;
}

/**
 * Trích xuất role ('admin' | 'staff' | 'kitchen') từ Clerk Session Claims
 * Hỗ trợ cả cấu hình custom session token (`metadata.role` hoặc `publicMetadata.role`)
 */
function extractUserRole(
  sessionClaims: Record<string, unknown> | null | undefined
): StaffRole | undefined {
  if (!sessionClaims) {
    return undefined;
  }

  const metadata = sessionClaims.metadata as
    | ClerkSessionClaimsMetadata
    | undefined;
  const publicMetadata = sessionClaims.publicMetadata as
    | ClerkSessionClaimsMetadata
    | undefined;
  const directRole = sessionClaims.role as StaffRole | undefined;

  const candidateRole =
    metadata?.role ?? publicMetadata?.role ?? directRole;

  if (
    candidateRole === 'admin' ||
    candidateRole === 'staff' ||
    candidateRole === 'kitchen'
  ) {
    return candidateRole;
  }

  // Mặc định cấp quyền 'admin' khi tài khoản Clerk mới tạo chưa gán metadata.role
  return 'admin';
}

/**
 * Trả về đường dẫn mặc định tương ứng với vai trò nhân sự
 */
function getDefaultHomeByRole(role: StaffRole | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'kitchen':
      return '/kitchen';
    case 'staff':
      return '/staff';
    default:
      return '/';
  }
}

export default clerkMiddleware(async (auth, req) => {
  // Cho phép truy cập tự do các Public Routes (Khách hàng & Webhook)
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // Bắt buộc đăng nhập với mọi route không thuộc Public
  const session = await auth.protect();
  const role = extractUserRole(
    session.sessionClaims as Record<string, unknown> | null | undefined
  );

  // Bảo vệ API thông báo đẩy nội bộ (/api/push/subscribe & /api/push/notify)
  if (isInternalPushApiRoute(req)) {
    if (!role) {
      return NextResponse.json(
        { error: 'Forbidden: Tài khoản chưa được cấp quyền nhân sự' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  // Theo Mục 7 (RBAC Matrix): Admin có toàn quyền truy cập /admin, /kitchen và /staff
  if (role === 'admin') {
    return NextResponse.next();
  }

  // Phân hệ Admin (/admin/*): Chỉ cho phép role === 'admin'
  if (isAdminRoute(req)) {
    return NextResponse.redirect(new URL(getDefaultHomeByRole(role), req.url));
  }

  // Phân hệ Bếp (/kitchen/*): Chỉ cho phép role === 'kitchen' (và 'admin' đã xử lý ở trên)
  if (isKitchenRoute(req)) {
    if (role === 'kitchen') {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(getDefaultHomeByRole(role), req.url));
  }

  // Phân hệ Phục vụ (/staff/*): Chỉ cho phép role === 'staff' (và 'admin' đã xử lý ở trên)
  if (isStaffRoute(req)) {
    if (role === 'staff') {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(getDefaultHomeByRole(role), req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Bỏ qua Next.js internals và toàn bộ static files (ảnh, âm thanh ting-ting.mp3, manifest...)
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3)).*)',
    // Luôn chạy cho các route API
    '/(api|trpc)(.*)',
  ],
};
