import Link from 'next/link';
import {
  Beer,
  ShoppingBag,
  LayoutGrid,
  ChefHat,
  BarChart3,
} from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mx-auto text-amber-400">
          <Beer className="h-9 w-9" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-black text-amber-400">
            Quán Nhậu 123Dzô • Smart POS &amp; KDS
          </h1>
          <p className="text-sm text-zinc-400">
            Hệ thống Gọi món QR Động tại bàn, Đặt mang về VietQR &amp; Điều phối Bếp thời gian thực
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <Link
            href="/customer/takeaway"
            className="p-4 rounded-2xl bg-zinc-950 hover:bg-zinc-800/80 border border-amber-500/40 flex items-center gap-3.5 transition-colors"
          >
            <ShoppingBag className="h-6 w-6 text-amber-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-zinc-100">
                Khách Đặt Mang Về
              </div>
              <span className="text-xs text-zinc-400">
                /customer/takeaway (VietQR)
              </span>
            </div>
          </Link>

          <Link
            href="/staff"
            className="p-4 rounded-2xl bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 flex items-center gap-3.5 transition-colors"
          >
            <LayoutGrid className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-zinc-100">
                Phân hệ Phục vụ
              </div>
              <span className="text-xs text-zinc-400">
                /staff (Mở bàn &amp; Sinh QR)
              </span>
            </div>
          </Link>

          <Link
            href="/kitchen"
            className="p-4 rounded-2xl bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 flex items-center gap-3.5 transition-colors"
          >
            <ChefHat className="h-6 w-6 text-orange-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-zinc-100">
                Màn hình Bếp KDS
              </div>
              <span className="text-xs text-zinc-400">
                /kitchen (Gom mẻ &amp; FIFO)
              </span>
            </div>
          </Link>

          <Link
            href="/admin"
            className="p-4 rounded-2xl bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 flex items-center gap-3.5 transition-colors"
          >
            <BarChart3 className="h-6 w-6 text-sky-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-zinc-100">
                Quản trị &amp; Dashboard KPI
              </div>
              <span className="text-xs text-zinc-400">
                /admin (Doanh thu &amp; KPI)
              </span>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
