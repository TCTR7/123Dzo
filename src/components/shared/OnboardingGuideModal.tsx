'use client';
import { useEffect, useRef, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import type { StaffRole } from '@/types/database.types';
type Tab='install'|'admin'|'staff'|'kitchen';
const tabs:{id:Tab;label:string;steps:string[]}[]=[
  {id:'install',label:'Cài ứng dụng & Bật chuông',steps:['iPhone / iPad: mở bằng Safari → Chia sẻ → Thêm vào màn hình chính.','Android: mở bằng Chrome → menu ba chấm → Cài đặt ứng dụng hoặc Thêm vào màn hình chính.','Giữ ứng dụng mở trong ca làm việc để nhận thông báo món xong. Khi đóng ứng dụng hoặc khóa máy sẽ không có thông báo nền. Đầu ca hãy kiểm tra chuông và âm lượng.']},
  {id:'admin',label:'Chủ quán',steps:['Tình hình quán: xem tiền bán hàng, ngày đông khách, món bán chạy và ít được gọi.','Thu ngân & Hóa đơn: thiết lập QR tài khoản nhận tiền, kiểm tra chuyển khoản, xác nhận nhận tiền và chốt hóa đơn.','Thực đơn: thêm món, sửa giá và bấm Báo hết món khi tạm hết.','Kho & Xuất nhập: nhập bia, nguyên liệu, ghi lại hàng hỏng và xem tồn kho.','Bàn & Nhân sự: nhập số bàn và tạo tài khoản bằng số điện thoại, mật khẩu cho người cùng làm.']},
  {id:'staff',label:'Phục vụ',steps:['Khách vào: bấm Mở bàn để nhận phụ trách và đưa mã QR cho khách gọi món.','Món xong: nghe chuông, mang ra đúng bàn rồi bấm Đã bưng lên bàn. Đơn mang về: bấm Đã giao khách khi trao món.','Cuối buổi: trả bia thừa nếu có, kiểm tra tiền rồi chốt thanh toán. Muốn đổi người phụ trách, dùng bàn giao bàn.']},
  {id:'kitchen',label:'Đầu bếp',steps:['Món gọi trước nằm trên. Xem kỹ ghi chú từng bàn. Có thể bật Gộp món giống nhau để làm chung.','Làm xong bấm Xong món. Món tiếp theo tự lên đầu; khách và người phụ trách tự nhận thông tin.','Hết nguyên liệu: bấm Báo hết món để khách biết ngay.']},
];
export function OnboardingGuideModal({role}:{role:StaffRole}) {
  const ref=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false),[tab,setTab]=useState<Tab>(role==='operator'?'admin':role);
  useEffect(()=>{try{setOpen(localStorage.getItem('dzo_onboarding_seen_v1')!=='true');}catch{setOpen(true);}},[]);
  useEffect(()=>{if(open)ref.current?.showModal();else ref.current?.close();},[open]);
  function dismiss(){try{localStorage.setItem('dzo_onboarding_seen_v1','true');}catch{}setOpen(false);}
  const selected=tabs.find(t=>t.id===tab)!;
  return <><button onClick={()=>setOpen(true)} className="neu-button flex min-h-12 items-center gap-2 px-3 py-2 text-xs font-semibold"><CircleHelp className="h-4 w-4" />Hướng dẫn & Cài ứng dụng</button><dialog ref={ref} aria-labelledby="guide-title" onCancel={e=>{e.preventDefault();dismiss();}} className="neu-card max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-6 text-ink backdrop:bg-slate-900/35 backdrop:backdrop-blur-sm">
    <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">LÀM QUEN THẬT NHANH</p><h2 id="guide-title" className="mt-2 text-2xl font-bold">Bắt đầu cùng 123Dzô</h2></div><button autoFocus aria-label="Đóng hướng dẫn" onClick={dismiss} className="neu-button p-3"><X className="h-5 w-5" /></button></div>
    <nav aria-label="Nội dung hướng dẫn" className="my-5 grid grid-cols-2 gap-3">{tabs.map(t=><button key={t.id} aria-pressed={tab===t.id} onClick={()=>setTab(t.id)} className={'neu-button min-h-12 p-3 text-sm '+(tab===t.id?'neu-selected':'')}>{t.label}</button>)}</nav>
    <h3 className="font-bold">{selected.label}</h3><ol className="my-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed">{selected.steps.map(s=><li key={s}>{s}</li>)}</ol><button onClick={dismiss} className="neu-button neu-selected min-h-12 w-full px-4 py-3 font-bold">Đã hiểu, bắt đầu làm việc</button>
  </dialog></>;
}
