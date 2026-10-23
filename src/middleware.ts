import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/customer/order/(.*)',
  '/customer/takeaway(.*)',
  '/api/webhooks/payment',
  '/api/customer/orders',
  '/api/customer/operation',
  '/api/customer/bill',
  '/api/customer/snapshot',
  '/api/customer/realtime-ticket',
  '/api/customer/takeaway',
  '/api/cron/keep-alive',
  '/api/cron/notifications',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/access-denied',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();

  // Login only here. Pages/APIs check the current DB role and active flag.
  // Stale Clerk metadata must not grant access or create redirect loops.
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Vui lòng đăng nhập.', retryable: false } },
        { status: 401 }
      );
    }
  } else {
    await auth.protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3)).*)',
    '/(api|trpc)(.*)',
  ],
};
