'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Receipt, UtensilsCrossed, Package, Users, ArrowUpRight } from 'lucide-react';
const items = [
  ['/admin','Tình hình quán','Tiền bán hàng & Món bán chạy',BarChart3],
  ['/admin/bills','Thu ngân & Hóa đơn','Nhận tiền, chốt bàn, in hóa đơn',Receipt],
  ['/admin/menu','Thực đơn','Món ngon & Giá bán',UtensilsCrossed],
  ['/admin/inventory','Kho & Xuất nhập','Theo dõi bia & Nguyên liệu',Package],
  ['/admin/staff','Bàn & Nhân sự','Số bàn & Người cùng làm',Users],
] as const;
export function AdminNavigation() {
  const path=usePathname();
  return <nav aria-label="Quản lý quán" className="flex gap-3 overflow-x-auto p-4 md:grid md:grid-cols-1">{items.map(([href,label,description,Icon]) => {
    const active=href==='/admin'?path===href:path.startsWith(href);
    return <Link key={href} href={href} aria-current={active?'page':undefined} className={'admin-nav-link flex min-h-14 min-w-[160px] md:min-w-0 items-center gap-3 rounded-2xl px-3 py-3 transition-colors ' + (active?'neu-selected':'hover:bg-white/40')}>
      <span className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ' + (active?'bg-teal-800/10':'neu-inset')}><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{label}</span><span className="mt-1 hidden text-[11px] text-muted-ink md:block">{description}</span></span>{active && <ArrowUpRight className="hidden h-4 w-4 shrink-0 md:block" />}
    </Link>;
  })}</nav>;
}
