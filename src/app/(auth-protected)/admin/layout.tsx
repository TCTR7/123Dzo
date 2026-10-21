import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { UserButton } from '@clerk/nextjs';
import {
  BarChart3,
  UtensilsCrossed,
  Package,
  Users,
  Receipt,
  Beer,
  ChefHat,
  LayoutGrid,
  ShieldCheck,
} from 'lucide-react';
import { syncClerkStaffToSupabase } from '@/lib/supabase/sync-staff';

interface AdminLayoutProps {
  children: ReactNode;
}

const ADMIN_NAV_ITEMS = [
  {
    href: '/admin',
    label: 'Dashboard KPI',
    icon: BarChart3,
    description: 'Doanh thu & Hiệu suất',
  },
  {
    href: '/admin/bills',
    label: 'Thu ngân & Hóa đơn',
    icon: Receipt,
    description: 'Chốt bill & In nhiệt K80',
  },
  {
    href: '/admin/menu',
    label: 'Thực đơn (Menu)',
    icon: UtensilsCrossed,
    description: 'Món ăn, Giá vốn & 86ing',
  },
  {
    href: '/admin/inventory',
    label: 'Kho & Xuất nhập',
    icon: Package,
    description: 'Nguyên liệu & Bia',
  },
  {
    href: '/admin/staff',
    label: 'Bàn & Nhân sự',
    icon: Users,
    description: 'Khu vực, Bàn & Phân ca',
  },
] as const;

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Đồng bộ tài khoản Clerk với bảng staff_profiles và kiểm tra chặt chẽ quyền truy cập từ Database
  const { role } = await syncClerkStaffToSupabase();

  if (role === 'staff') {
    redirect('/staff');
  }

  if (role === 'kitchen') {
    redirect('/kitchen');
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
      {/* Sidebar điều hướng Admin */}
      <aside className="w-full md:w-64 bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-800 shrink-0 flex flex-col justify-between">
        <div>
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <Beer className="h-6 w-6" />
              </div>
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <h1 className="font-bold text-base tracking-tight text-amber-400 truncate">
                    123Dzô Admin
                  </h1>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <ShieldCheck className="h-3 w-3" />
                    ADMIN
                  </span>
                </div>
                <p className="text-xs text-zinc-400 truncate">
                  Quản trị Quán nhậu &amp; POS
                </p>
              </div>
            </div>

            <div className="shrink-0">
              <UserButton />
            </div>
          </div>

          <nav className="p-3 grid grid-cols-2 md:grid-cols-1 gap-1.5">
            {ADMIN_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-300 hover:text-amber-400 hover:bg-zinc-800/80 transition-colors"
                >
                  <Icon className="h-4 w-4 text-amber-400 shrink-0" />
                  <div className="truncate">
                    <div className="leading-none">{item.label}</div>
                    <span className="hidden md:block text-[11px] text-zinc-500 mt-1">
                      {item.description}
                    </span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Liên kết chuyển nhanh sang màn hình Phục vụ & Bếp (Hiển thị trên cả Mobile & Desktop) */}
        <div className="p-3 border-t border-zinc-800 space-y-1.5">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Chuyển nhanh phân hệ
          </p>
          <div className="grid grid-cols-2 md:grid-cols-1 gap-1.5">
            <Link
              href="/staff"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-950/60 md:bg-transparent hover:bg-zinc-800 transition-colors"
            >
              <LayoutGrid className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="truncate">Phục vụ (/staff)</span>
            </Link>
            <Link
              href="/kitchen"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-950/60 md:bg-transparent hover:bg-zinc-800 transition-colors"
            >
              <ChefHat className="h-4 w-4 text-orange-400 shrink-0" />
              <span className="truncate">Bếp KDS (/kitchen)</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Nội dung trang chính */}
      <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
