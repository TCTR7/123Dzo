'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CustomerShell } from './CustomerShell';
import { MenuCatalog } from './MenuCatalog';
import { CartSheet } from './CartSheet';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
import { useTakeawayCartStore } from '@/lib/store/useCartStore';
import { recipientInput,type CustomerStoreConfig } from '@/lib/customer/customer-config';
import type { PublicMenuItem } from '@/lib/data/read-contracts';
import { formatVND } from '@/lib/utils';
export function TakeawayBrowseView({menu,store,error,onCheckout}:{menu:PublicMenuItem[];store:CustomerStoreConfig;error?:string;onCheckout?:(recipient:{name:string;phone:string})=>void}) {
 const cart=useTakeawayCartStore(),[open,setOpen]=useState(false),[review,setReview]=useState(false),[name,setName]=useState(''),[phone,setPhone]=useState(''),[validated,setValidated]=useState(false);
 const recipient=recipientInput(name,phone);
 const changes=cart.items.flatMap(line=>{const current=menu.find(item=>item.id===line.menu_item_id);return !current?.is_available||current.price!==line.unit_price?[{line,current}]:[];});
 return <CustomerShell><header className="p-4 space-y-3"><Link href="/" className="inline-flex items-center min-h-12 underline">Trang chủ</Link><h1 className="text-2xl font-bold">Đặt món mang về</h1><p>{store.name}</p>
  {store.verified?<address className="not-italic space-y-1"><p>Nhận tại: {store.address}</p><p>Giờ phục vụ: {store.hours}</p><a className="inline-flex min-h-12 items-center underline" href={'tel:'+store.phone.replace(/\s/g,'')}>{store.phone}</a></address>:<p>Thông tin nhận món đang được quán xác nhận.</p>}
  <p role="status" className="rounded-xl border border-amber-500 p-3 text-amber-200">{onCheckout?'Đơn mang về cần thanh toán trước và chờ nhân viên xác nhận tiền thực nhận.':'Quán chưa mở đặt món và thanh toán trực tuyến. Bạn có thể xem thực đơn; giỏ đang chọn chưa phải đơn được quán tiếp nhận.'}</p></header>
  {changes.length>0&&<section role="alert" className="m-4 p-4 border border-amber-500 rounded-xl space-y-3"><p>Thực đơn đã thay đổi. Kiểm tra lại trước khi gửi đơn:</p><ul>{changes.map(({line,current})=><li key={line.lineId}>{line.name}: {!current?.is_available?'hiện không phục vụ — bỏ món này trong giỏ':`${formatVND(line.unit_price)} → ${formatVND(current.price)}`}</li>)}</ul>
   {changes.some(({current})=>current?.is_available)&&<button type="button" className="min-h-12 px-4 border rounded-xl" onClick={()=>useTakeawayCartStore.setState(state=>({items:state.items.map(line=>{const current=menu.find(item=>item.id===line.menu_item_id);return current?.is_available?{...line,unit_price:current.price}:line;})}))}>Đồng ý cập nhật giá trong giỏ</button>}
  </section>}
  <div className="p-4"><MenuCatalog items={menu} selected={cart.items} error={error} onRetry={()=>window.location.reload()} onAdd={item=>cart.addItem({menu_item_id:item.id,name:item.name,category:item.category,station:item.station,unit_price:item.price,image_url:item.image_url})}/></div>
  {cart.items.length>0&&<div className="fixed bottom-0 inset-x-0 mx-auto max-w-[640px] p-4 bg-zinc-950 safe-bottom"><button type="button" onClick={()=>setOpen(true)} className="min-h-12 w-full rounded-xl bg-amber-400 text-zinc-950 font-bold px-4">Xem giỏ mang về ({cart.getTotalQuantity()}) · {formatVND(cart.getTotalAmount())}</button></div>}
  <CartSheet open={open} onClose={()=>setOpen(false)} items={cart.items} tableName="đơn mang về" locked={false} blocked={false} unknown={false} cooldown={0} onQuantity={cart.updateQuantity} onNote={cart.updateNote} submitLabel="Xem lại và thông tin nhận" onSubmit={()=>{setOpen(false);setReview(true);}}/>
  <AccessibleDialog open={review} title="Xem lại đơn mang về" onClose={()=>setReview(false)}>
   <p>{onCheckout?'Xem lại món và người nhận trước khi gửi đơn.':'Giỏ đang chọn chưa được gửi. Quán chưa nhận thanh toán trực tuyến.'}</p>
   <ul>{cart.items.map(item=><li key={item.lineId}>{item.quantity} × {item.name} — {formatVND(item.quantity*item.unit_price)}{item.note&&` (${item.note})`}</li>)}</ul><p className="font-bold">Tổng: {formatVND(cart.getTotalAmount())}</p>
   <label className="block space-y-2"><span>Tên người nhận</span><input autoComplete="name" value={name} maxLength={80} onChange={event=>setName(event.target.value)} aria-invalid={validated&&Boolean(recipient.nameError)} aria-describedby="recipient-name-error" className="w-full min-h-12 rounded-xl border bg-zinc-950 px-3"/></label><p id="recipient-name-error" role={validated&&recipient.nameError?'alert':undefined}>{validated&&recipient.nameError}</p>
   <label className="block space-y-2"><span>Số điện thoại</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} maxLength={24} onChange={event=>setPhone(event.target.value)} aria-invalid={validated&&Boolean(recipient.phoneError)} aria-describedby="recipient-phone-error" className="w-full min-h-12 rounded-xl border bg-zinc-950 px-3"/></label><p id="recipient-phone-error" role={validated&&recipient.phoneError?'alert':undefined}>{validated&&recipient.phoneError}</p>
   <button type="button" onClick={()=>setValidated(true)} className="min-h-12 px-4 border rounded-xl">Kiểm tra thông tin nhận</button>
   {changes.length>0&&<p role="alert">Có món đổi giá hoặc không còn phục vụ. Quay lại giỏ để kiểm tra.</p>}
   <button type="button" disabled={!onCheckout||changes.length>0} onClick={()=>{setValidated(true);if(onCheckout&&!changes.length&&!recipient.nameError&&!recipient.phoneError){setReview(false);onCheckout({name:recipient.name,phone:recipient.phone});}}} className="min-h-12 w-full rounded-xl bg-amber-400 text-zinc-950 disabled:bg-zinc-700 px-4">{onCheckout?'Tiếp tục xác nhận đơn':'Thanh toán chưa mở'}</button>
   <button type="button" onClick={()=>{setReview(false);setOpen(true);}} className="min-h-12 px-4 underline">Quay lại giỏ</button>
  </AccessibleDialog>
 </CustomerShell>;
}
