'use client';

import { useEffect, useRef, useState } from 'react';
import type { StaffRole } from '@/types/database.types';

type GuideTab = 'pwa' | 'admin' | 'staff' | 'kitchen';
const tabs: { id: GuideTab; label: string; steps: string[] }[] = [
  { id: 'pwa', label: '📱 Cài App & Bật chuông', steps: [
    'iPhone / iPad: mở bằng Safari → Chia sẻ (Share) → Thêm vào MH chính (Add to Home Screen). Mở app từ màn hình chính rồi bấm Bật thông báo đẩy và cho phép thông báo.',
    'Android / máy tính bảng / Chrome: bấm Cài đặt ứng dụng trên thanh địa chỉ hoặc menu 3 chấm → Cài đặt / Thêm vào màn hình chính.',
    'Đầu ca, bấm Kiểm tra chuông, bật âm lượng thiết bị và cho phép thông báo. Giữ màn hình Bếp mở khi làm việc.',
  ] },
  { id: 'admin', label: '👑 Chủ quán', steps: [
    'Dashboard KPI: xem doanh thu, lãi/lỗ, giờ vàng và hiệu suất bếp / nhân viên theo khoảng ngày.',
    'Thu ngân & Hóa đơn: kiểm tra chuyển khoản đơn mang về, xác nhận đã nhận tiền, chốt bill và in nhiệt K80.',
    'Thực đơn: thêm/sửa món, giá bán, giá vốn; gạt Báo hết món (86ing) khi tạm hết hàng.',
    'Kho & Xuất nhập: nhập bia/nguyên liệu, ghi nhận hàng hỏng và kiểm tra tồn kho.',
    'Bàn & Nhân sự: tạo khu vực, bàn và tài khoản đăng nhập cho nhân viên / đầu bếp; phân công khu vực.',
  ] },
  { id: 'staff', label: '🍻 Phục vụ', steps: [
    'Khách vào bàn: bấm Mở bàn & Tạo QR, đưa khách quét QR của lượt khách đó để gọi món.',
    'Món chín / bia lấy ngay: nghe chuông, bưng món và bấm Bưng ngay / Đã phục vụ để xác nhận.',
    'Cuối buổi nếu còn bia: bấm Trả bia thừa và nhập số lượng thực tế.',
    'Khách tính tiền: nhân viên phụ trách hoặc Chủ quán kiểm tra tiền rồi bấm Chốt & Đóng bill. QR bàn hết hiệu lực sau khi đóng.',
  ] },
  { id: 'kitchen', label: '🔥 Đầu bếp', steps: [
    'Xem cột Gom món trùng (Batch Cooking) để nấu gộp cùng món của nhiều bàn.',
    'Bấm Nhận nấu khi bắt đầu; bấm Hoàn thành khi ra món để gọi nhân viên vào bưng.',
    'Hết nguyên liệu: dùng Báo hết món (86ing) để khóa món ngay trên thực đơn khách.',
  ] },
];

export function OnboardingGuideModal({ role }: { role: StaffRole }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GuideTab>(role === 'operator' ? 'admin' : role);
  useEffect(() => {
    try { setOpen(localStorage.getItem('dzo_onboarding_seen_v1') !== 'true'); }
    catch { setOpen(true); }
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function dismiss() {
    try { localStorage.setItem('dzo_onboarding_seen_v1', 'true'); } catch { /* Private browsing: help remains available. */ }
    setOpen(false);
  }
  const selected = tabs.find((entry) => entry.id === tab)!;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="min-h-12 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-100">❓ Hướng dẫn & Cài App</button>
    <dialog ref={dialog} aria-labelledby="onboarding-title" onCancel={(event) => { event.preventDefault(); dismiss(); }} className="w-[calc(100%_-_2rem)] max-w-2xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-zinc-100 shadow-2xl backdrop:bg-black/75">
      <div className="flex items-center justify-between gap-3">
        <h2 id="onboarding-title" className="text-xl font-bold text-amber-400">Bắt đầu cùng 123Dzô</h2>
        <button type="button" autoFocus aria-label="Đóng hướng dẫn" onClick={dismiss} className="min-h-12 min-w-12 rounded-lg bg-zinc-800">✕</button>
      </div>
      <nav aria-label="Nội dung hướng dẫn" className="my-5 grid grid-cols-2 gap-2">
        {tabs.map((entry) => <button key={entry.id} type="button" aria-pressed={tab === entry.id} onClick={() => setTab(entry.id)} className={`min-h-12 rounded-lg border p-2 text-sm ${tab === entry.id ? 'border-amber-400 bg-amber-500/15 text-amber-300' : 'border-zinc-700 bg-zinc-800'}`}>{entry.label}</button>)}
      </nav>
      <h3 className="font-bold">{selected.label}</h3>
      <ol className="my-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-zinc-200">{selected.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <button type="button" onClick={dismiss} className="min-h-12 w-full rounded-xl bg-amber-500 px-4 py-3 font-bold text-zinc-950">Đã hiểu, bắt đầu làm việc</button>
    </dialog>
  </>;
}
