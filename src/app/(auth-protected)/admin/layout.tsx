import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { UserButton } from '@clerk/nextjs';
import { Beer, ChefHat, LayoutGrid } from 'lucide-react';
import { syncClerkStaffToSupabase } from '@/lib/supabase/sync-staff';
import { OnboardingGuideModal } from '@/components/shared/OnboardingGuideModal';
import { PaymentSetupModal } from '@/components/admin/PaymentSetupModal';
import { AdminNavigation } from '@/components/admin/AdminNavigation';
export default async function AdminLayout({children}:{children:ReactNode}) {
  const {role}=await syncClerkStaffToSupabase();
  if(role==='staff')redirect('/staff');if(role==='kitchen')redirect('/kitchen');
  return <div className="min-h-screen bg-soft text-ink md:flex">
    <aside className="admin-sidebar md:sticky md:top-0 md:flex md:h-screen md:w-[272px] md:shrink-0 md:flex-col">
      <div className="flex items-center gap-3 px-6 pb-5 pt-7"><span className="neu-card flex h-12 w-12 items-center justify-center rounded-2xl text-orange-700"><Beer className="h-7 w-7" /></span><div><p className="text-2xl font-extrabold tracking-tight">123Dzô<span className="text-orange-600">.</span></p><p className="mt-0.5 text-xs text-muted-ink">Quán nhỏ, niềm vui lớn</p></div></div>
      <p className="eyebrow hidden px-7 pb-1 md:block">GÓC CỦA CHỦ QUÁN</p><AdminNavigation />
      <div className="mt-auto px-5 pb-6 pt-4"><div className="neu-inset rounded-2xl p-4"><p className="mb-3 text-xs font-bold text-muted-ink">Sang màn hình làm việc</p><div className="flex flex-wrap gap-2"><Link href="/staff" className="neu-button flex items-center gap-2 px-3 py-2 text-sm"><LayoutGrid className="h-4 w-4" />Phục vụ</Link><Link href="/kitchen" className="neu-button flex items-center gap-2 px-3 py-2 text-sm"><ChefHat className="h-4 w-4" />Bếp</Link></div></div></div>
    </aside>
    <main className="min-w-0 flex-1 px-4 pb-8 sm:px-6 lg:px-9">
      <header className="mb-7 flex min-h-24 flex-wrap items-center justify-between gap-3 border-b border-line py-4"><p className="text-sm font-semibold text-muted-ink">Chào bạn, chúc quán mình một ngày đông khách ☀</p><div className="flex items-center gap-3">{role==='operator' && <Link href="/operator" className="text-sm font-semibold text-teal-800">Bàn giao</Link>}<OnboardingGuideModal role={role} /><PaymentSetupModal role={role} /><UserButton /></div></header>
      <div className="mx-auto max-w-[1440px]">{children}</div>
    </main>
  </div>;
}
