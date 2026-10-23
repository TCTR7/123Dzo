import type { DisplayOrderItem } from '@/lib/orders/contracts';
import type { PublicMenuItem } from '@/lib/data/read-contracts';
import { itemStatusLabel } from '@/lib/customer/order-status';
export function OrderProgress({items,menu,positions}:{items:DisplayOrderItem[];menu:PublicMenuItem[];positions:Record<string,number>}) {
 if (!items.length) return <p className="p-4 rounded-xl border border-zinc-700">Bàn chưa gọi món. Chọn món từ Thực đơn rồi gửi cho quán.</p>;
 return <section className="space-y-4"><h2 className="text-xl font-bold">Món đã gọi của cả bàn</h2><p className="text-sm text-zinc-300">Thông tin tự cập nhật khi có kết nối. Thời gian nấu chỉ để tham khảo.</p>
  {items.filter(item=>item.quantity>0&&item.status!=='SERVED'&&item.status!=='CANCELLED').map(item=>{const food=menu.find(m=>m.id===item.menu_item_id);return <article key={item.id} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 space-y-2">
   <h3 className="font-bold">{item.quantity} × {food?.name??'Món đã gọi'}</h3><p className="text-amber-300">{item.quantity===0?'Đã trả hết':itemStatusLabel[item.status]}</p>
   {item.note&&<p>Ghi chú: {item.note}</p>}{item.status==='CANCELLED'&&item.cancel_reason&&<p>Lý do hủy: {item.cancel_reason}</p>}
   {item.status==='QUEUED'&&positions[item.id]&&<p>Vị trí chờ bếp: {positions[item.id]}. Thứ tự có thể thay đổi khi quán xử lý món.</p>}
   {item.status==='COOKING'&&food&&food.prep_time_minutes>0&&<p className="text-sm text-zinc-300">Thời gian nấu thường khoảng {food.prep_time_minutes} phút/món, tùy lượng khách.</p>}
   {item.status==='READY'&&<p>Quán đã chuẩn bị xong. Vui lòng chờ nhân viên mang ra bàn.</p>}
  </article>;})}
  {items.some(item=>item.status==='SERVED'||item.quantity===0)&&<details className="border border-zinc-700 rounded-xl p-4"><summary className="min-h-12 py-3 cursor-pointer">Món đã lên bàn / đã trả</summary><ul>{items.filter(item=>item.status==='SERVED'||item.quantity===0).map(item=><li key={item.id} className="py-2">{item.quantity} × {menu.find(food=>food.id===item.menu_item_id)?.name??'Món đã gọi'} — {item.quantity===0?'Đã trả hết':'Đã lên bàn'}</li>)}</ul></details>}
  {items.some(item=>item.status==='CANCELLED'&&item.quantity>0)&&<details className="border border-zinc-700 rounded-xl p-4"><summary className="min-h-12 py-3 cursor-pointer">Món đã hủy</summary><ul>{items.filter(item=>item.status==='CANCELLED'&&item.quantity>0).map(item=><li key={item.id} className="py-2">{item.quantity} × {menu.find(food=>food.id===item.menu_item_id)?.name??'Món đã gọi'}{item.cancel_reason&&` — ${item.cancel_reason}`}</li>)}</ul></details>}
 </section>;
}
