'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {TakeawayBrowseView} from './TakeawayBrowseView';
import {CustomerShell} from './CustomerShell';
import {PaymentInstructions} from './PaymentInstructions';
import {AccessibleDialog} from '@/components/ui/AccessibleDialog';
import {acceptTakeaway,forgetTakeaway,pendingTakeaway,readTakeaway,recoverTakeaway,submitTakeaway,takeawayHistory,TakeawayError} from '@/lib/takeaway/client';
import type {TakeawayCreated,TakeawaySnapshot} from '@/lib/takeaway/contracts';
import type {PublicMenuItem} from '@/lib/data/read-contracts';
import type {CustomerStoreConfig} from '@/lib/customer/customer-config';
import {useTakeawayCartStore} from '@/lib/store/useCartStore';
import {deriveTakeawayStatus} from '@/lib/customer/order-status';
import {formatVND} from '@/lib/utils';
export function TakeawayFlow({menu,store,error,settings}:{menu:PublicMenuItem[];store:CustomerStoreConfig;error?:string;settings:{enabled:boolean;bank:{bankId:string;accountNo:string;accountName:string}|null}}){
 const cart=useTakeawayCartStore(),[history,setHistory]=useState<string[]>([]),[token,setToken]=useState<string|null>(null),[snapshot,setSnapshot]=useState<TakeawaySnapshot|null>(null),[created,setCreated]=useState<TakeawayCreated|null>(null);
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState<string|null>(null),[stale,setStale]=useState(false),[updated,setUpdated]=useState<string|null>(null),[review,setReview]=useState<{name:string;phone:string}|null>(null),[forget,setForget]=useState(false);
 const lock=useRef(false),router=useRouter();
 function apply(found:Awaited<ReturnType<typeof submitTakeaway>>){
  // Cart reduction is idempotent and persisted before dropping the journal.
  cart.acceptSubmittedOrder(found.result.operationId,found.journal.command.lines);
  acceptTakeaway(found.result,found.journal);setHistory(takeawayHistory());setToken(found.journal.token);setCreated(found.result);setUnknown(false);setReview(null);
 }
 useEffect(()=>{try{setHistory(takeawayHistory());setUnknown(pendingTakeaway()!==null);}catch(e){setUnknown(true);setMessage(e instanceof Error?e.message:'Không đọc được lịch sử trên máy.');}},[]);
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  async function recover(){if(document.visibilityState!=='visible'||!navigator.onLine||lock.current)return;lock.current=true;
   try{const found=await recoverTakeaway(controller.signal);if(active&&found)apply(found);}catch{if(active)setMessage('Chưa đối soát được lượt đặt trước. Giữ nguyên giỏ và mã khôi phục.');}finally{lock.current=false;}}
  window.addEventListener('online',recover);window.addEventListener('focus',recover);
  return()=>{active=false;controller.abort();window.removeEventListener('online',recover);window.removeEventListener('focus',recover);};
 // Recovery reads only and does not create an order on mount/focus.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  setSnapshot(null);setUpdated(null);setStale(false);if(!token)return;
  let active=true,inFlight=false,stopped=false,delay=15000,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
  async function refresh(){if(inFlight||stopped||!active||document.visibilityState!=='visible'||!navigator.onLine)return;clearTimeout(timer);inFlight=true;
   try{const data=await readTakeaway(token!,controller.signal);if(active){setSnapshot(data);setCreated(null);setStale(false);setUpdated(new Date().toLocaleTimeString('vi-VN'));delay=15000;stopped=data.status==='CLOSED';}}
   catch(e){if(active){setStale(true);delay=Math.min(delay*2,60000);if(e instanceof TakeawayError&&[401,403,404].includes(e.status)){stopped=true;setMessage('Không mở được đơn bằng mã này. Liên hệ quán để kiểm tra.');}}}finally{inFlight=false;if(active&&!stopped)timer=setTimeout(refresh,delay);}}
  const offline=()=>setStale(true);void refresh();window.addEventListener('online',refresh);window.addEventListener('offline',offline);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{active=false;controller.abort();clearTimeout(timer);window.removeEventListener('online',refresh);window.removeEventListener('offline',offline);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[token]);
 async function send(){if(lock.current||(!unknown&&!review))return;lock.current=true;setBusy(true);setMessage(null);
  try{const found=await submitTakeaway(unknown?undefined:{customerName:review!.name,customerPhone:review!.phone,lines:cart.items.map(row=>({menu_item_id:row.menu_item_id,quantity:row.quantity,note:row.note.trim(),expected_price:row.unit_price}))});apply(found);}
  catch(e){setMessage(e instanceof Error?e.message:'Chưa xác nhận lượt đặt.');try{setUnknown(pendingTakeaway()!==null);}catch{setUnknown(true);}if(e instanceof TakeawayError&&e.status===409&&['PRICE_CHANGED','MENU_UNAVAILABLE'].includes(e.code)){setReview(null);router.refresh();}}
  finally{lock.current=false;setBusy(false);}
 }
 const current=snapshot??created,whole=snapshot?deriveTakeawayStatus(snapshot.status,snapshot.items):null;
 return <>
  {!token&&<TakeawayBrowseView menu={menu} store={store} error={error} onCheckout={settings.enabled&&!unknown?recipient=>{setReview(recipient);setMessage(null);}:undefined}/>}
  <CustomerShell as={token?'main':'section'}><div className="p-4 space-y-4">
   {unknown&&<section role="status" className="border border-amber-500 rounded-xl p-4 space-y-3"><p>Lượt đặt trước chưa có kết quả chắc chắn. Kiểm tra trước khi gửi đơn mới.</p><button type="button" disabled={busy} onClick={()=>void send()} className="min-h-12 px-4 border rounded-xl">{busy?'Đang kiểm tra…':'Kiểm tra lượt đặt mang về vừa gửi'}</button></section>}
   {message&&<p role="alert" className="text-red-200">{message}</p>}
   {token&&<section className="space-y-4"><h1 className="text-2xl font-bold">Đơn mang về của bạn</h1><p>Nhận tại {store.name}{store.verified?` · ${store.address} · ${store.hours}`:''}</p>{store.verified&&<a className="min-h-12 inline-flex items-center underline" href={'tel:'+store.phone}>Gọi quán {store.phone}</a>}
    {stale&&<p role="alert">Chưa cập nhật được trạng thái. Thông tin dưới đây có thể đã cũ; không chuyển khoản lại.</p>}
    {!current&&<p role="status">Đang tải trạng thái đơn từ quán…</p>}
    {current&&<><p className="font-bold">Mã đơn: {current.paymentCode}</p><p role="status" className="text-lg font-bold">{whole?.label??'Chờ nhân viên xác nhận đã nhận tiền'}</p><p>Tổng đơn: {formatVND(current.totalAmount)}</p>
     {current.status==='PENDING_PAYMENT'&&<PaymentInstructions bank={settings.bank} amount={current.totalAmount} code={current.paymentCode}/>}
     {snapshot&&<ul className="space-y-2">{snapshot.items.map(item=><li key={item.id}>{item.quantity} × {item.name} · {formatVND(item.quantity*item.unitPrice)}{item.note&&` · ${item.note}`}{item.status==='CANCELLED'?' · Đã hủy':''}</li>)}</ul>}
     {updated&&<p className="text-sm">Cập nhật: {updated}</p>}</>}
    <button type="button" onClick={()=>{setToken(null);setCreated(null);}} className="min-h-12 border rounded-xl px-4">Quay lại thực đơn</button><button type="button" onClick={()=>setForget(true)} className="min-h-12 border rounded-xl px-4">Xóa lối mở đơn khỏi máy này</button>
   </section>}
   <section className="space-y-2"><h2 className="text-xl font-bold">Đơn đã lưu trên máy này</h2><p>Người dùng chung máy có thể mở các đơn này. Đây là lối truy cập đã lưu, trạng thái luôn được lấy lại từ quán.</p>
    {!history.length&&<p>Chưa có đơn đã lưu.</p>}{history.map((value,index)=><button key={value} type="button" onClick={()=>{setCreated(null);setToken(value);setMessage(null);}} className="min-h-12 px-4 mr-2 border rounded-xl">Mở đơn đã lưu {index+1}</button>)}
   </section>
  </div></CustomerShell>
  <AccessibleDialog open={Boolean(review)} title="Gửi đơn và chờ xác nhận tiền" locked={busy} onClose={()=>setReview(null)}>
   <p>{review?.name} · {review?.phone}</p><p>Tổng: {formatVND(cart.getTotalAmount())}</p><p>Đơn chỉ vào bếp khi quán kiểm tra đã nhận đủ tiền. Chưa giữ hàng trước thanh toán; nếu có thay đổi quán sẽ liên hệ để đối soát.</p>{message&&<p role="alert">{message}</p>}
   <button type="button" disabled={busy||!cart.items.length||unknown} onClick={()=>void send()} className="min-h-12 w-full rounded-xl bg-amber-400 text-zinc-950 font-bold">{busy?'Đang gửi…':'Xác nhận gửi đơn mang về'}</button>
  </AccessibleDialog>
  <AccessibleDialog open={forget} title="Xóa lối truy cập trên thiết bị?" onClose={()=>setForget(false)}><p>Việc này không hủy đơn hoặc hoàn tiền. Sau khi xóa, máy này có thể không mở lại được đơn; liên hệ quán nếu cần hỗ trợ.</p><button type="button" className="min-h-12 px-4 border rounded-xl" onClick={()=>{try{if(token)forgetTakeaway(token);setHistory(takeawayHistory());setToken(null);setForget(false);}catch{setMessage('Chưa xóa được lối truy cập. Kiểm tra quyền lưu trữ của trình duyệt.');}}}>Xác nhận xóa khỏi máy</button></AccessibleDialog>
 </>;
}
