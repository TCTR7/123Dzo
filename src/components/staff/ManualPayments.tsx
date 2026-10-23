'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {AccessibleDialog} from '@/components/ui/AccessibleDialog';
import {useServerRefresh} from '@/lib/data/use-server-refresh';
import {acknowledgeManualPayment,pendingManualPayment,submitManualPayment} from '@/lib/payments/client';
import type {ManualPaymentStatus} from '@/lib/payments/contracts';
import {formatVND} from '@/lib/utils';
export function ManualPayments({status,actorId,path,pendingPage=1,historyPage=1}:{status:ManualPaymentStatus;actorId:string;path:'/staff/payments'|'/admin/payments';pendingPage?:number;historyPage?:number}){
 const router=useRouter(),lock=useRef(false),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null),[method,setMethod]=useState<'CASH'|'VIETQR'>('VIETQR'),[reference,setReference]=useState(''),[received,setReceived]=useState(false);
 const selected=status.pending.find(row=>row.sessionId===selectedId);
 useServerRefresh(15000,actorId);
 useEffect(()=>{try{setPending(pendingManualPayment(actorId)!==null);}catch(e){setPending(true);setError(e instanceof Error?e.message:'Không đọc được thao tác thu tiền.');}},[actorId]);
 useEffect(()=>setReceived(false),[selectedId,selected?.amount,method,reference]);
 useEffect(()=>{if(selectedId&&!selected){setSelectedId(null);setReceived(false);}},[selectedId,selected]);
 async function confirm(recover=false){
  if(lock.current||(!recover&&(pending||!selected||!received||(method==='VIETQR'&&!reference.trim()))))return;
  lock.current=true;setBusy(true);setError(null);setNotice(null);
  try{
   const result=await submitManualPayment(actorId,recover?undefined:{sessionId:selected!.sessionId,expectedTotal:selected!.amount,paymentMethod:method,reference:method==='VIETQR'?reference:'',confirmedReceived:true});
   acknowledgeManualPayment(actorId,result.operationId);setSelectedId(null);setReceived(false);
   setNotice(`Đã ghi nhận ${formatVND(result.amount)} bởi ${result.confirmedByName} lúc ${new Date(result.confirmedAt).toLocaleString('vi-VN')}. Đơn đã chuyển vào phục vụ.`);router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Chưa xác nhận thu tiền.');router.refresh();}
  finally{try{setPending(pendingManualPayment(actorId)!==null);}catch{setPending(true);}lock.current=false;setBusy(false);}
 }
 const pageHref=(p:number,h:number)=>`${path}?${new URLSearchParams({pendingPage:String(p),historyPage:String(h)})}`;
 return <main className="operations-app space-y-6 p-4 max-w-5xl mx-auto">
  <Link href={path.startsWith('/admin')?'/admin':'/staff'} className="inline-flex min-h-12 items-center underline">Quay lại</Link>
  <h1 className="text-2xl font-bold">Xác nhận thu tiền & lịch sử</h1>
  <p>Đối chiếu tiền thực nhận trên tài khoản Techcombank của quán hoặc tiền mặt đã nhận. Ảnh chuyển khoản do khách gửi chưa phải bằng chứng tiền đã vào tài khoản.</p>
  {notice&&<p role="status" className="border border-emerald-500 p-4 rounded-xl">{notice}</p>}
  {error&&<p role="alert" className="text-red-200 border border-red-500 p-4 rounded-xl">{error}</p>}
  {pending&&<section role="status" className="border border-amber-500 p-4 rounded-xl space-y-2"><p>Có thao tác thu tiền chưa xác nhận kết quả. Đối soát trước khi tạo thao tác mới.</p><button type="button" disabled={busy} onClick={()=>void confirm(true)} className="min-h-12 px-4 border rounded-xl">{busy?'Đang kiểm tra…':'Kiểm tra xác nhận vừa gửi'}</button></section>}
  <section className="space-y-3"><h2 className="text-xl font-bold">Đơn mang về chờ xác nhận tiền</h2>
   <p>Đơn này chưa được đưa vào bếp. Chỉ xác nhận sau khi đã nhận đủ tiền và có thể phục vụ.</p>
   {status.pending.length===0&&<p>Không có đơn chờ trên trang này.</p>}
   {status.pending.map(row=><article key={row.sessionId} className="p-4 border border-zinc-700 rounded-xl space-y-2">
    <h3 className="font-bold">{row.paymentCode??row.sessionId.slice(0,8)} · {row.customerName??'Khách mang về'}</h3>
    {row.customerPhone&&<a className="inline-flex min-h-12 items-center underline" href={'tel:'+row.customerPhone}>{row.customerPhone}</a>}
    <p>{formatVND(row.amount)} · Tạo lúc {new Date(row.openedAt).toLocaleString('vi-VN')}</p>
    <button type="button" disabled={busy||pending||row.amount<=0} onClick={()=>{setSelectedId(row.sessionId);setMethod('VIETQR');setReference('');setReceived(false);setError(null);}} className="min-h-12 px-4 rounded-xl bg-amber-400 text-zinc-950 font-bold">Đối chiếu và xác nhận đã nhận tiền</button>
   </article>)}
   <nav aria-label="Trang đơn chờ" className="flex gap-4">{pendingPage>1&&<Link className="min-h-12 inline-flex items-center underline" href={pageHref(pendingPage-1,historyPage)}>Đơn chờ trước</Link>}{status.pendingHasMore&&<Link className="min-h-12 inline-flex items-center underline" href={pageHref(pendingPage+1,historyPage)}>Đơn chờ tiếp</Link>}</nav>
  </section>
  <section className="space-y-3"><h2 className="text-xl font-bold">Lịch sử xác nhận</h2><p>Lưu người xác nhận, thời điểm, số tiền và phương thức. Không có chức năng sửa hoặc xóa xác nhận.</p>
   {!status.history.length&&<p>Chưa có xác nhận trên trang này.</p>}
   {status.history.map(row=><article key={row.recordId} className="p-4 border border-zinc-700 rounded-xl space-y-1">
    <h3 className="font-bold">{row.action==='CONFIRM_PAYMENT'?'Nhận tiền đơn mang về':'Thu tiền và đóng bill tại bàn'} · {row.sessionId.slice(0,8)}</h3>
    <p>{formatVND(row.amount)} · {row.paymentMethod==='CASH'?'Tiền mặt':'Chuyển khoản'}</p>
    <p>Người xác nhận: {row.confirmedByName} ({row.confirmedBy})</p><p>Thời điểm: {new Date(row.confirmedAt).toLocaleString('vi-VN')}</p>
    {row.reference&&<p className="break-all">Mã giao dịch: {row.reference}</p>}
   </article>)}
   <nav aria-label="Trang lịch sử" className="flex gap-4">{historyPage>1&&<Link className="min-h-12 inline-flex items-center underline" href={pageHref(pendingPage,historyPage-1)}>Lịch sử trước</Link>}{status.historyHasMore&&<Link className="min-h-12 inline-flex items-center underline" href={pageHref(pendingPage,historyPage+1)}>Lịch sử tiếp</Link>}</nav>
  </section>
  <AccessibleDialog open={Boolean(selected)} title="Xác nhận tiền thực nhận" locked={busy} onClose={()=>{if(!busy)setSelectedId(null);}}>
   {selected&&<form onSubmit={event=>{event.preventDefault();void confirm();}} className="space-y-4">
    <p>{selected.paymentCode??selected.sessionId.slice(0,8)} · {selected.customerName??'Khách mang về'}</p><p className="text-xl font-bold">Cần nhận đủ: {formatVND(selected.amount)}</p>
    <fieldset disabled={busy||pending} className="space-y-4">
     <label className="block">Phương thức nhận tiền<select className="block min-h-12 w-full border rounded-xl bg-zinc-950 px-3" value={method} onChange={e=>{if(e.target.value==='CASH'||e.target.value==='VIETQR')setMethod(e.target.value);}}><option value="VIETQR">Chuyển khoản Techcombank</option><option value="CASH">Tiền mặt đã nhận</option></select></label>
     {method==='VIETQR'&&<label className="block">Mã giao dịch trên ngân hàng<input className="block min-h-12 w-full border rounded-xl bg-zinc-950 px-3" required maxLength={120} value={reference} onChange={e=>setReference(e.target.value)} autoComplete="off"/></label>}
     <label className="min-h-12 flex gap-3 items-center"><input type="checkbox" required checked={received} onChange={e=>setReceived(e.target.checked)}/>Tôi đã kiểm tra và nhận đủ số tiền trên. Xác nhận này được lưu dưới tài khoản của tôi.</label>
     {error&&<p role="alert" className="text-red-200">{error}</p>}
     <button type="submit" disabled={busy||pending||!received||(method==='VIETQR'&&!reference.trim())} className="min-h-12 w-full rounded-xl bg-amber-400 text-zinc-950 font-bold">{busy?'Đang ghi nhận…':'Xác nhận đã nhận đủ tiền'}</button>
    </fieldset>
   </form>}
  </AccessibleDialog>
 </main>;
}
