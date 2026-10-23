import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { resolveStaffProfile, getHomeByRole, OperatorRoleConstraintError } from '@/lib/auth/roles';
import type { StaffProfileRow } from '@/types/database.types';

const isPublicRoute = createRouteMatcher([
  '/', '/manifest.json', '/customer/order/(.*)', '/customer/takeaway(.*)', '/api/customer/(.*)', '/api/events',
  '/api/webhooks/(.*)', '/api/cron/keep-alive(.*)',
  '/api/supabase-proxy/(.*)', '/sign-in(.*)', '/sign-up(.*)',
]);
const isOperator = createRouteMatcher(['/operator(.*)', '/api/operator/(.*)']);
const isAdmin = createRouteMatcher(['/admin(.*)', '/api/accounts/(.*)']);
const isStaff = createRouteMatcher(['/staff(.*)']);
const isKitchen = createRouteMatcher(['/kitchen(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();
  const session = await auth.protect();
  if (req.nextUrl.pathname === '/access-denied') return NextResponse.next();
  let profile: StaffProfileRow | null;
  try {
    profile = await resolveStaffProfile(session.userId);
  } catch (error) {
    const reason = error instanceof OperatorRoleConstraintError ? 'operator-role' : 'auth-setup';
    console.error('Staff authorization failed:', error instanceof Error ? error.message : 'Unknown error');
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: reason === 'operator-role'
        ? 'Database chưa hỗ trợ vai trò operator. Cần cập nhật staff_profiles_role_check trong Supabase.'
        : 'Không thể kiểm tra quyền. Kiểm tra kết nối Supabase/Clerk và thử lại.' }, { status: 503 });
    }
    const target = new URL('/access-denied', req.url);
    target.searchParams.set('reason', reason);
    return NextResponse.redirect(target);
  }
  const role = profile?.role;
  const allowed = role && (
    isOperator(req) ? role === 'operator' :
    isAdmin(req) ? role === 'operator' || role === 'admin' :
    isStaff(req) ? role !== 'kitchen' :
    isKitchen(req) ? role !== 'staff' : true
  );
  if (!allowed) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.redirect(new URL(profile ? getHomeByRole(profile.role) : '/access-denied', req.url));
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
