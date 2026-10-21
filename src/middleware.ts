import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import type { StaffRole } from '@/types/database.types';

/**
 * 1. Nhóm Route Công khai (Public Routes):
 * - Trang chủ (/)
 * - Khách gọi món tại bàn qua QR động (/customer/order/[session_token])
 * - Khách đặt mang về (/customer/takeaway)
 * - Webhook thanh toán PayOS/SePay (/api/webhooks/payment)
 * - Cron chống ngủ đông Supabase (/api/cron/keep-alive)
 * - Trang đăng nhập/đăng ký Clerk (/sign-in, /sign-up)
 */
const isPublicRoute = createRouteMatcher([
  '/',
  '/customer/order/(.*)',
  '/customer/takeaway(.*)',
  '/api/webhooks/(.*)',
  '/api/cron/keep-alive(.*)',
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

  return undefined;
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

function isClerkConfigured(): boolean {
  const pubKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secKey = process.env.CLERK_SECRET_KEY;
  if (!pubKey || !secKey) return false;
  if (
    pubKey.includes('your_clerk_publishable_key') ||
    secKey.includes('your_clerk_secret_key')
  ) {
    return false;
  }
  return (
    (pubKey.startsWith('pk_test_') || pubKey.startsWith('pk_live_')) &&
    (secKey.startsWith('sk_test_') || secKey.startsWith('sk_live_'))
  );
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
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

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!isClerkConfigured()) {
    return NextResponse.next();
  }
  return clerkHandler(req, event);
}

export const config = {
  matcher: [
    // Bỏ qua Next.js internals và toàn bộ static files (ảnh, âm thanh ting-ting.mp3, manifest...)
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3)).*)',
    // Luôn chạy cho các route API
    '/(api|trpc)(.*)',
  ],
};
