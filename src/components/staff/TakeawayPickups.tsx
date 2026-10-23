'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {AccessibleDialog} from '@/components/ui/AccessibleDialog';
import {isRecord,UUID} from '@/lib/orders/contracts';
import {parsePickupResult} from '@/lib/takeaway/contracts';
import {formatVND} from '@/lib/utils';
type Row={sessionId:string;paymentCode:string;customerName:string|null;totalAmount:number};
export function TakeawayPickups({actorId}:{actorId:string}){
 const router=useRouter(),[rows,setRows]=useState<Row[]>([]),[page,setPage]=useState(1),[more,setMore]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState(false),[selected,setSelected]=useState<Row|null>(null),[revision,setRevision]=useState(0),lock=useRef(false);
 const key='123dzo-pending-pickup:'+actorId;
 useEffect(()=>{try{setPending(localStorage.getItem(key)!==null);}catch{setPending(true);setError('Không đọc được mã giao đang lưu. Nhờ quản lý đối soát.');}},[key]);
 useEffect(()=>{let active=true;
  const refresh=()=>setRevision(v=>v+1);
  window.addEventListener('online',refresh);window.addEventListener('offline',refresh);document.addEventListener('visibilitychange',refresh);
  const stopListeners=()=>{window.removeEventListener('online',refresh);window.removeEventListener('offline',refresh);document.removeEventListener('visibilitychange',refresh);};
  if(document.visibilityState==='hidden'||navigator.onLine===false){setError('Danh sách tạm dừng khi mất mạng hoặc ẩn màn hình. Mở lại để cập nhật trước khi giao.');return stopListeners;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  void fetch('/api/staff/takeaway?page='+page,{cache:'no-store',signal:controller.signal}).then(async response=>{
   const body:unknown=await response.json();if(!response.ok||!isRecord(body)||!isRecord(body.data)||!Array.isArray(body.data.rows)||typeof body.data.hasMore!=='boolean')throw new Error('Unavailable');
   const values:Row[]=[];for(const row of body.data.rows){if(!isRecord(row)||typeof row.sessionId!=='string'||!UUID.test(row.sessionId)||typeof row.paymentCode!=='string'||(row.customerName!==null&&typeof row.customerName!=='string')||typeof row.totalAmount!=='number'||!Number.isFinite(row.totalAmount))throw new Error('Invalid pickup row');values.push({sessionId:row.sessionId,paymentCode:row.paymentCode,customerName:row.customerName,totalAmount:row.totalAmount});}
   if(active){setRows(values);setMore(body.data.hasMore);setError(null);}
  }).catch(()=>{if(active)setError('Chưa tải được đơn chờ giao. Không suy ra đơn đã sẵn sàng.');}).finally(()=>clearTimeout(timer));
  const interval=setInterval(refresh,15000);
  return()=>{active=false;controller.abort();clearTimeout(timer);clearInterval(interval);stopListeners();};
 },[page,revision]);
 async function send(recover=false){if(lock.current||(!recover&&(pending||!selected)))return;lock.current=true;setBusy(true);setError(null);
  try{
   const raw=localStorage.getItem(key);let journal:unknown=raw?JSON.parse(raw):{operationId:crypto.randomUUID(),sessionId:selected?.sessionId};
   if(!isRecord(journal)||Object.keys(journal).sort().join(',')!=='operationId,sessionId'||typeof journal.operationId!=='string'||!UUID.test(journal.operationId)||typeof journal.sessionId!=='string'||!UUID.test(journal.sessionId))throw new Error('Mã giao đơn đang lưu không hợp lệ. Nhờ quản lý đối soát.');
   if(!raw)localStorage.setItem(key,JSON.stringify(journal));
   async function call(url:string,init:RequestInit={}){const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);try{const response=await fetch(url,{...init,cache:'no-store',signal:c.signal});const body:unknown=await response.json();if(!response.ok){if(response.status>=400&&response.status<500&&isRecord(body)&&isRecord(body.error)&&['ORDER_NOT_FOUND','PICKUP_NOT_ACTIVE','PICKUP_NOT_READY','INVALID_PICKUP'].includes(String(body.error.code)))localStorage.removeItem(key);throw new Error(isRecord(body)&&isRecord(body.error)&&typeof body.error.message==='string'?body.error.message:'Chưa xác nhận giao đơn.');}if(!isRecord(body)||!Object.hasOwn(body,'data'))throw new Error('Chưa đọc được kết quả giao.');return body.data;}finally{clearTimeout(t);}}
   let data:unknown;if(raw)data=await call('/api/staff/takeaway?'+new URLSearchParams({operationId:journal.operationId}));
   if(!raw||data===null)data=await call('/api/staff/takeaway',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(journal)});
   const result=parsePickupResult(data);if(!result||result.operationId!==journal.operationId||result.sessionId!==journal.sessionId||result.handedOverBy!==actorId)throw new Error('Chưa đối soát được đúng lượt giao.');
   localStorage.removeItem(key);setSelected(null);setRevision(v=>v+1);router.refresh();
  }catch(e){setError(e instanceof Error?e.message:'Chưa xác nhận kết quả giao đơn.');}finally{try{setPending(localStorage.getItem(key)!==null);}catch{setPending(true);}lock.current=false;setBusy(false);}
 }
 return <section className="operations-app max-w-5xl mx-auto p-4 space-y-3"><h2 className="text-xl font-bold">Mang về đã chuẩn bị đủ — chờ giao</h2><p>Đã nhận tiền trước đó. Chỉ xác nhận khi đã giao đủ món cho đúng khách; không thu tiền lần hai.</p>
  {error&&<p role="alert">{error}</p>}{pending&&<button type="button" className="min-h-12 border rounded-xl px-4" disabled={busy} onClick={()=>void send(true)}>Kiểm tra lượt giao vừa xác nhận</button>}
  {!rows.length&&!error&&<p>Chưa có đơn chờ giao trên trang này.</p>}{rows.map(row=><article key={row.sessionId} className="border rounded-xl p-4 space-y-2"><p>{row.paymentCode} · {row.customerName??'Khách mang về'} · {formatVND(row.totalAmount)}</p><button type="button" disabled={busy||pending||Boolean(error)} onClick={()=>setSelected(row)} className="min-h-12 px-4 bg-amber-400 text-zinc-950 rounded-xl">Xác nhận giao đủ đơn này</button></article>)}
  <nav className="flex gap-3" aria-label="Trang đơn chờ giao"><button type="button" disabled={page<=1} className="min-h-12 border rounded-xl px-4" onClick={()=>setPage(v=>v-1)}>Trước</button><span className="py-3">Trang {page}</span><button type="button" disabled={!more} className="min-h-12 border rounded-xl px-4" onClick={()=>setPage(v=>v+1)}>Tiếp</button></nav>
  <AccessibleDialog open={Boolean(selected)} title="Đã giao đủ món cho khách?" locked={busy} onClose={()=>setSelected(null)}><p>{selected?.paymentCode} · {selected?.customerName}</p><p>Chỉ đóng đơn sau khi giao đủ món. Người giao và thời điểm sẽ được lưu.</p><button type="button" disabled={busy||pending} className="min-h-12 border rounded-xl px-4" onClick={()=>void send()}>Tôi đã giao đủ món</button></AccessibleDialog>
 </section>;
}
