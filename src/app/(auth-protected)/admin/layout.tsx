import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  BarChart3,
  UtensilsCrossed,
  Package,
  Users,
  Receipt,
  Beer,
  ChefHat,
  LayoutGrid,
} from 'lucide-react';

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

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
      {/* Sidebar điều hướng Admin */}
      <aside className="w-full md:w-64 bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-800 shrink-0 flex flex-col justify-between">
        <div>
          <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Beer className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-amber-400">
                123Dzô Admin
              </h1>
              <p className="text-xs text-zinc-400">Quản trị Quán nhậu & POS</p>
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

        {/* Liên kết chuyển nhanh sang màn hình Phục vụ & Bếp */}
        <div className="hidden md:block p-3 border-t border-zinc-800 space-y-1.5">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Chuyển nhanh phân hệ
          </p>
          <Link
            href="/staff"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <LayoutGrid className="h-4 w-4 text-emerald-400" />
            Màn hình Phục vụ (/staff)
          </Link>
          <Link
            href="/kitchen"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <ChefHat className="h-4 w-4 text-orange-400" />
            Màn hình Bếp KDS (/kitchen)
          </Link>
        </div>
      </aside>

      {/* Nội dung trang chính */}
      <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
