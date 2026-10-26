'use client';
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, UploadCloud, CheckCircle2 } from 'lucide-react';
import { parseVietQr, type PaymentSettings } from '@/lib/payments/vietqr';
import { readQrImage } from '@/lib/payments/read-qr-image';
import type { StaffRole } from '@/types/database.types';
export const OPEN_PAYMENT_SETUP='dzo-open-payment-setup';
export function PaymentSetupModal({role}:{role:StaffRole}) {
  const dialog=useRef<HTMLDialogElement>(null), dismissed=useRef(false);
  const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false),[settings,setSettings]=useState<PaymentSettings|null>(null);
  const [qrText,setQrText]=useState(''),[candidate,setCandidate]=useState<PaymentSettings|null>(null),[name,setName]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/accounts/payment-settings',{cache:'no-store',signal:controller.signal}).then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error);setSettings(b.settings);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Chưa tải được thông tin.');}).finally(()=>{if(!controller.signal.aborted)setLoaded(true);});
    const show=()=>setOpen(true);window.addEventListener(OPEN_PAYMENT_SETUP,show);
    return()=>{controller.abort();window.removeEventListener(OPEN_PAYMENT_SETUP,show);};
  },[]);
  useEffect(()=>{
    function auto(){if(loaded && !settings && role==='admin' && !dismissed.current && !document.querySelector('dialog[open]'))setOpen(true);}
    auto(); document.addEventListener('close',auto,true);return()=>document.removeEventListener('close',auto,true);
  },[loaded,settings,role]);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  function close(){dismissed.current=true;setOpen(false);}
  async function image(file?:File){
    if(!file || busy)return;setBusy(true);setError('');setMessage('');setCandidate(null);setConfirmed(false);setQrText('');
    try{const raw=await readQrImage(file), parsed=parseVietQr(raw);setQrText(raw);setCandidate(parsed);setName(parsed.accountName);}
    catch(e){setError(e instanceof Error?e.message:'Chưa đọc được ảnh.');}finally{setBusy(false);}
  }
  async function save(){
    if(!candidate || !confirmed || !name.trim() || busy)return;setBusy(true);setError('');
    try{const r=await fetch('/api/accounts/payment-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qrText,accountName:name,confirmed})});const b=await r.json();if(!r.ok)throw Error(b.error);setSettings(b.settings);setCandidate(null);setMessage('Đã lưu tài khoản nhận tiền cho quán.');}
    catch(e){setError(e instanceof Error?e.message:'Chưa lưu được.');}finally{setBusy(false);}
  }
  return <dialog ref={dialog} aria-labelledby="payment-title" onCancel={e=>{e.preventDefault();if(!busy)close();}} className="neu-card max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto p-6 text-ink backdrop:bg-slate-900/35 backdrop:backdrop-blur-sm">
    <div className="flex items-center justify-between gap-4"><h2 id="payment-title" className="text-xl font-bold">Nhận tiền về tài khoản quán</h2><button aria-label="Đóng" disabled={busy} onClick={close} className="neu-button p-3"><X className="h-5 w-5" /></button></div>
    <p className="mt-3 text-sm text-muted-ink">Chọn ảnh QR chuyển khoản từ ứng dụng ngân hàng. Ảnh được đọc ngay trên thiết bị; bạn kiểm tra người nhận trước khi lưu.</p>
    {settings && <div className="neu-inset mt-4 rounded-xl p-4 text-sm"><p className="font-bold">{settings.bankName} · {settings.accountNumber}</p><p className="mt-1">{settings.accountName}</p></div>}
    {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-4 flex gap-2 text-teal-800"><CheckCircle2 className="h-5 w-5" />{message}</p>}
    <label className="neu-inset mt-5 block cursor-pointer rounded-2xl border border-dashed border-teal-500 p-5 text-center"><UploadCloud className="mx-auto h-8 w-8 text-teal-700" /><span className="mt-2 block font-bold">{busy?'Đang xử lý…':'Chọn ảnh QR ngân hàng'}</span><input aria-label="Ảnh QR ngân hàng" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{void image(e.target.files?.[0]);e.target.value='';}} className="sr-only" /><span className="mt-2 block text-xs text-muted-ink">Ảnh PNG, JPG hoặc WebP, tối đa 10 MB.</span></label>
    {candidate && <div className="mt-5 space-y-4"><div className="flex justify-center rounded-xl bg-white p-3"><QRCodeSVG value={qrText} size={160} /></div><p className="text-sm"><strong>{candidate.bankName}</strong><br />Số tài khoản: <strong>{candidate.accountNumber}</strong></p><label className="block text-sm font-semibold">Tên chủ tài khoản<input maxLength={100} required value={name} onChange={e=>{setName(e.target.value);setConfirmed(false);}} className="mt-2 w-full rounded-xl px-4 py-3" placeholder="Nhập tên đúng trên ứng dụng ngân hàng" /></label><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1" />Tôi đã kiểm tra đúng ngân hàng, số tài khoản và người nhận.</label><button disabled={busy || !confirmed || !name.trim()} onClick={()=>void save()} className="neu-button neu-selected w-full py-3 font-bold">Lưu tài khoản nhận tiền</button></div>}
    <button disabled={busy} onClick={close} className="mt-4 min-h-12 w-full text-sm text-muted-ink">{settings?'Đóng':'Để sau, tôi sẽ thiết lập trong Thu ngân & Hóa đơn'}</button>
  </dialog>;
}
