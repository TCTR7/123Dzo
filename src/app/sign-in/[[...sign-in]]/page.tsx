import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PhoneSignInForm } from '@/components/shared/PhoneSignInForm';
import { internalDestination } from '@/lib/auth/navigation';
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string }> }) {
  const head = await headers();
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || (head.get('x-forwarded-proto') || 'http') + '://' + head.get('host')).origin;
  const returnTo = internalDestination((await searchParams).redirect_url, origin) || undefined;
  if ((await auth()).userId) redirect(returnTo ? '/?returnTo=' + encodeURIComponent(returnTo) : '/');
  return <main className="min-h-screen bg-soft flex flex-col items-center justify-center gap-6 p-5">
    <div className="text-center"><span className="text-sm font-bold tracking-widest text-teal-800">123DZÔ · QUÁN MÌNH</span><h1 className="mt-2 text-3xl font-bold text-ink">Mỗi ca làm, nhẹ nhàng hơn.</h1><p className="mt-2 text-muted-ink">Dành cho chủ quán, phục vụ và đầu bếp</p></div>
    <PhoneSignInForm returnTo={returnTo} /><Link href="/customer/takeaway" className="min-h-12 p-3 text-sm text-muted-ink">← Khách đặt mang về</Link>
  </main>;
}
