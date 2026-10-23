'use client';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
import { formatVND } from '@/lib/utils';
import type { CartLine } from '@/lib/customer/cart-lines';
export function CartSheet({open,onClose,items,tableName,locked,blocked,unknown,error,cooldown,onQuantity,onNote,onSubmit,submitLabel}:{
 open:boolean;onClose:()=>void;items:CartLine[];tableName:string;locked:boolean;blocked:boolean;unknown:boolean;error?:string;cooldown:number;
 onQuantity:(id:string,quantity:number)=>void;onNote:(id:string,note:string)=>void;onSubmit:()=>void;
 submitLabel?:string;
}) {
 return <AccessibleDialog open={open} title={`Giỏ hàng của ${tableName}`} onClose={onClose} locked={locked}>
  <p>Món bạn đang chọn, chưa gửi cho quán.</p>{error&&<p role="alert" className="text-red-300">{error}</p>}
  {unknown&&<p role="status" className="text-amber-300">Chưa xác nhận lượt vừa gửi. Kiểm tra trước khi gửi lượt mới.</p>}
  <fieldset disabled={locked||blocked||unknown} className="space-y-4">{items.map(item=><div key={item.lineId} className="border-b border-zinc-700 pb-4 space-y-3">
   <h3 className="font-bold">{item.name}</h3><div className="flex flex-wrap justify-between items-center gap-3"><span>{formatVND(item.unit_price*item.quantity)}</span><div className="flex gap-2 items-center">
    <button type="button" aria-label={`Bớt ${item.name}`} onClick={()=>onQuantity(item.lineId,item.quantity-1)} className="min-h-12 min-w-12 border rounded-xl">−</button><output aria-label={`Số lượng ${item.name}`}>{item.quantity}</output>
    <button type="button" aria-label={`Thêm một ${item.name}`} disabled={item.quantity>=99} onClick={()=>onQuantity(item.lineId,item.quantity+1)} className="min-h-12 min-w-12 bg-amber-400 text-zinc-950 rounded-xl">+</button></div></div>
   <label className="block space-y-2"><span className="text-sm">Ghi chú cho {item.name}</span><input value={item.note} maxLength={500} onChange={event=>onNote(item.lineId,event.target.value)} placeholder="Ví dụ: ít cay, không hành" className="w-full min-h-12 border border-zinc-600 rounded-xl px-3 bg-zinc-950"/></label>
  </div>)}</fieldset>
  {!items.length&&<p>Chưa có món trong giỏ.</p>}
  <p className="flex flex-wrap justify-between gap-2 font-bold">Tổng lượt này <strong>{formatVND(items.reduce((sum,i)=>sum+i.unit_price*i.quantity,0))}</strong></p>
  <button type="button" disabled={locked||(!unknown&&(blocked||!items.length||cooldown>0))} onClick={onSubmit} className="w-full min-h-12 rounded-xl bg-amber-400 text-zinc-950 font-bold px-4 disabled:opacity-50">
   {locked?'Đang gửi…':unknown?'Kiểm tra lượt vừa gửi':cooldown>0?`Vui lòng đợi ${cooldown}s…`:submitLabel??'Xác nhận Đặt món ngay'}</button>
 </AccessibleDialog>;
}
