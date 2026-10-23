import Link from 'next/link';
import { CustomerShell } from '@/components/customer/CustomerShell';
import { customerStoreConfig } from '@/lib/customer/customer-config';
import {takeawaySettings} from '@/lib/takeaway/config';
export default function HomePage() {
 const store=customerStoreConfig(),takeaway=takeawaySettings();
 return <CustomerShell><div className="px-5 py-8 space-y-8">
  <header className="space-y-3"><p className="text-amber-300 font-bold">123Dzô</p><h1 className="text-3xl font-bold">Hôm nay bạn muốn dùng món gì?</h1><p>Xem thực đơn và chọn món cho bữa ăn của bạn.</p></header>
  <section className="rounded-2xl border border-amber-400 p-5 space-y-4"><h2 className="text-xl font-bold">Mang về</h2><p>{takeaway.enabled?'Chọn món, chuyển khoản và chờ nhân viên xác nhận tiền trước khi bếp chuẩn bị đơn.':'Bạn có thể xem món và chuẩn bị giỏ. Quán chưa mở nhận đơn và thanh toán trực tuyến.'}</p>
  <Link href="/customer/takeaway" className="inline-flex items-center justify-center min-h-12 w-full rounded-xl bg-amber-400 text-zinc-950 font-bold p-3">Xem thực đơn mang về</Link></section>
  <section className="space-y-3"><h2 className="text-xl font-bold">Bạn đang ngồi tại quán?</h2><p>Nhờ nhân viên mở bàn và đưa mã QR. Quét mã để gọi món đúng bàn, không cần đăng nhập.</p></section>
  {store.verified&&<address className="not-italic border-t border-zinc-700 pt-4 space-y-2"><p>{store.name} · {store.address}</p><p>{store.hours}</p><a href={'tel:'+store.phone.replace(/\s/g,'')} className="inline-flex min-h-12 items-center underline">{store.phone}</a></address>}
  <footer className="border-t border-zinc-700 pt-4"><Link href="/sign-in" className="inline-flex min-h-12 items-center text-zinc-300 underline">Đăng nhập nhân viên</Link></footer>
 </div></CustomerShell>;
}
