import type { DisplayOrderItem } from '@/lib/orders/contracts';
import type { PublicMenuItem } from '@/lib/data/read-contracts';
import { formatVND } from '@/lib/utils';
export function BillPanel({items,menu,total}:{items:DisplayOrderItem[];menu:PublicMenuItem[];total:number}) {
 return <section className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 space-y-4">
  <h2 className="text-xl font-bold">Hóa đơn tạm tính của cả bàn</h2>
  <p className="flex flex-wrap justify-between gap-3"><span>Tổng tạm tính</span><strong className="text-2xl text-amber-300">{formatVND(total)}</strong></p>
  <p className="text-sm text-zinc-300">Nhân viên sẽ kiểm tra và xác nhận hóa đơn cuối cùng.</p>
  <details><summary className="min-h-12 py-3 cursor-pointer">Xem chi tiết {items.length} dòng món</summary>
   {items.length?<ul className="divide-y divide-zinc-700">{items.map(item=><li key={item.id} className="py-3 space-y-1"><p className="font-bold">{item.quantity} × {menu.find(food=>food.id===item.menu_item_id)?.name??'Món đã gọi'}</p><p className="flex flex-wrap justify-between gap-2"><span>Đơn giá: {formatVND(item.unit_price)}</span><strong>{formatVND(item.quantity*item.unit_price)}</strong></p></li>)}</ul>:<p>Bàn chưa có món trong hóa đơn.</p>}
  </details>
 </section>;
}
