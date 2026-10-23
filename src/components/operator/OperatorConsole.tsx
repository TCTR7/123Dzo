'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { AccountCredentials, type LoginCredentials } from '@/components/shared/AccountCredentials';

interface Props {
  version: string;
  environment: string;
  buildTime: string;
  appUrl: string;
  counts: { table: string; count: number | null; connected: boolean }[];
  clerkConnected: boolean;
}
const inputClass = 'mt-1 min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2';
const buttonClass = 'min-h-12 rounded-xl bg-amber-500 px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50';
const steps = [
  'Quét QR 1 để đăng nhập Chủ quán và cài App ra màn hình chính.',
  'Vào Thực đơn cập nhật món/giá; vào Bàn & Nhân sự tạo tài khoản nhân viên và đầu bếp.',
  'In QR 2 dán tại quầy. Khách ngồi tại bàn dùng QR mới do nhân viên bấm Mở bàn & Tạo QR.',
];
const countLabels: Record<string, string> = { staff_profiles: 'Tài khoản', zones: 'Khu vực', tables: 'Bàn', menu_items: 'Món', table_sessions: 'Phiên đơn hàng' };

async function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

export function OperatorConsole({ version, environment, buildTime, appUrl, counts, clerkConnected }: Props) {
  const router = useRouter();
  const [origin, setOrigin] = useState('');
  const [shop, setShop] = useState({ name: 'Quán Nhậu 123Dzô', address: '', phone: '', bank: '' });
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [credentials, setCredentials] = useState<LoginCredentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const qrAdmin = useRef<HTMLDivElement>(null);
  const qrTakeaway = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setOrigin(appUrl ? new URL(appUrl).origin : window.location.origin); }
    catch { setOrigin(window.location.origin); }
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('dzo_handover_shop_v1') || 'null');
      if (stored && typeof stored === 'object') {
        const value = stored as Record<string, unknown>;
        setShop({ name: typeof value.name === 'string' ? value.name : 'Quán Nhậu 123Dzô', address: typeof value.address === 'string' ? value.address : '', phone: typeof value.phone === 'string' ? value.phone : '', bank: typeof value.bank === 'string' ? value.bank : '' });
      }
    } catch { /* Storage is optional; credentials are never persisted. */ }
  }, [appUrl]);

  function updateShop(key: keyof typeof shop, value: string) {
    const next = { ...shop, [key]: value };
    setShop(next);
    try { localStorage.setItem('dzo_handover_shop_v1', JSON.stringify(next)); } catch { /* Keep editing in memory. */ }
  }

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(''); setCredentials(null);
    try {
      const login = identifier.trim();
      const response = await fetch('/api/accounts/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, password, role: 'admin', ...(login.includes('@') ? { emailAddress: login } : { username: login }) }) });
      const result = await response.json() as { error?: string; credentials: LoginCredentials };
      if (!response.ok) throw new Error(result.error || 'Không tạo được tài khoản.');
      setCredentials(result.credentials); setPassword('');
      setMessage('Tài khoản Chủ quán đã sẵn sàng. Có thể tải hoặc in phiếu bàn giao.');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không tạo được tài khoản. Thử lại.'); }
    finally { setBusy(false); }
  }

  async function runTool(action: 'seed' | 'reset') {
    if (busy) return;
    if (action === 'reset' && !window.confirm('XÓA TOÀN BỘ hóa đơn và món đã gọi, kể cả hóa đơn đã thanh toán. Chỉ dùng cho dữ liệu test trước khai trương. Kho và lịch sử kho được giữ nguyên. Tiếp tục?')) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/operator/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, confirmation: action === 'reset' ? 'XOA HOA DON TEST' : undefined }) });
      const result = await response.json() as { error?: string; message: string };
      if (!response.ok) throw new Error(result.error || 'Không thể thực hiện.');
      setMessage(result.message); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể thực hiện. Thử lại.'); }
    finally { setBusy(false); }
  }

  async function downloadPng() {
    if (!credentials || busy) return;
    setBusy(true); setMessage('');
    try {
      const adminSvg = qrAdmin.current?.querySelector('svg');
      const takeawaySvg = qrTakeaway.current?.querySelector('svg');
      if (!adminSvg || !takeawaySvg) throw new Error('Chưa tạo xong mã QR.');
      const images = await Promise.all([svgImage(adminSvg), svgImage(takeawaySvg)]);
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 800;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Trình duyệt không hỗ trợ xuất ảnh.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = '#18181b'; ctx.fillRect(0, 0, 1200, 120);
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 24px Arial';
      ctx.fillText('PHIẾU BÀN GIAO HỆ THỐNG SMART POS & KDS 123DZÔ', 40, 42);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 30px Arial'; ctx.fillText(shop.name, 40, 88, 970);
      ctx.font = '18px Arial'; ctx.fillText(`v${version}`, 1060, 88, 100);
      ctx.fillStyle = '#18181b';
      const line = (text: string, y: number) => { ctx.font = '18px Arial'; ctx.fillText(text, 40, y, 1120); };
      line(`${shop.address || 'Địa chỉ: —'} · Hotline: ${shop.phone || '—'}`, 150);
      line(`Ngân hàng VietQR: ${shop.bank || '—'}`, 178);
      line(`Đăng nhập quản trị: ${origin}/admin`, 212);
      line(`Tài khoản Chủ quán: ${credentials.loginIdentifier}`, 243);
      line(`Mật khẩu khởi tạo: ${credentials.password}`, 274);
      ctx.drawImage(images[0], 200, 298, 240, 240); ctx.drawImage(images[1], 760, 298, 240, 240);
      ctx.textAlign = 'center'; ctx.font = 'bold 20px Arial';
      ctx.fillText('QR 1 · ĐĂNG NHẬP CHỦ QUÁN', 320, 568);
      ctx.fillText('QR 2 · KHÁCH ĐẶT MANG VỀ', 880, 568);
      ctx.font = '16px Arial'; ctx.fillText(`${origin}/admin`, 320, 595, 520);
      ctx.fillText(`${origin}/customer/takeaway`, 880, 595, 520);
      ctx.textAlign = 'left'; ctx.font = 'bold 20px Arial'; ctx.fillText('3 BƯỚC BẮT ĐẦU', 40, 642);
      steps.forEach((step, index) => line(`${index + 1}. ${step}`, 679 + index * 34));
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Không xuất được ảnh.')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      link.download = `Ban-Giao-123Dzo-${shop.name.replace(/[^\p{L}\p{N}-]+/gu, '-') || 'Quan'}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không xuất được ảnh PNG.'); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-6xl space-y-6">
    <section className="operator-screen-only rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-lg font-bold">Thông tin hệ thống · v{version}</h2>
      <p className="mt-2 break-all text-sm text-zinc-400">{environment} · {appUrl || origin} · Build: {buildTime || 'Chưa có thông tin'}</p>
      <p className="mt-2 text-sm">Supabase: {counts.every((item) => item.connected) ? 'Connected – 8 Core Tables' : 'Có lỗi kết nối, kiểm tra cấu hình Supabase'} · Clerk: {clerkConnected ? 'Connected' : 'Không kết nối được'}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">{counts.filter((item) => countLabels[item.table]).map((item) => <div key={item.table} className="rounded-xl bg-zinc-950 p-4"><p className="text-xs text-zinc-400">{countLabels[item.table]}</p><p className="text-2xl font-bold text-amber-400">{item.count ?? '—'}</p></div>)}</div>
    </section>
    <section className="operator-screen-only rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="mb-4 text-lg font-bold">Thông tin quán & Tài khoản Chủ quán</h2>
      <form onSubmit={provision} className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">Tên quán<input required maxLength={100} value={shop.name} onChange={(e) => updateShop('name', e.target.value)} className={inputClass} /></label>
        <label className="text-sm">Địa chỉ<input maxLength={180} value={shop.address} onChange={(e) => updateShop('address', e.target.value)} className={inputClass} /></label>
        <label className="text-sm">Hotline<input type="tel" maxLength={30} value={shop.phone} onChange={(e) => updateShop('phone', e.target.value)} className={inputClass} /></label>
        <label className="text-sm">Ngân hàng / Số tài khoản VietQR<input maxLength={120} value={shop.bank} onChange={(e) => updateShop('bank', e.target.value)} className={inputClass} /></label>
        <label className="text-sm">Họ tên Chủ quán<input required maxLength={200} value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} /></label>
        <label className="text-sm">Email / Tên đăng nhập<input required maxLength={254} autoComplete="off" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={inputClass} /></label>
        <label className="text-sm">Mật khẩu khởi tạo<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></label>
        <button disabled={busy} className={`${buttonClass} self-end`}>{busy ? 'Đang xử lý…' : 'Tạo Tài Khoản Chủ Quán & Sinh Phiếu Bàn Giao'}</button>
      </form>
      {credentials && <div className="mt-4"><AccountCredentials credentials={credentials} /></div>}
    </section>
    <p role="status" aria-live="polite" className="operator-screen-only text-sm text-amber-300">{message}</p>
    <section id="handover-kit" className="rounded-2xl bg-white p-6 text-zinc-900 md:p-8">
      <div className="border-b-2 border-amber-500 pb-4"><p className="text-xs font-bold tracking-wider">PHIẾU BÀN GIAO HỆ THỐNG SMART POS & KDS 123DZÔ</p><h2 className="mt-2 text-3xl font-bold">{shop.name} <span className="text-base font-normal">v{version}</span></h2><p className="mt-2 break-words text-sm">{shop.address} · Hotline: {shop.phone || '—'}</p>{shop.bank && <p className="text-sm">Ngân hàng VietQR: {shop.bank}</p>}</div>
      <div className="my-5 space-y-1 break-all text-sm"><p>Đăng nhập quản trị: <strong>{origin}/admin</strong></p><p>Tài khoản Chủ quán: <strong>{credentials?.loginIdentifier || 'Chưa tạo tài khoản'}</strong></p><p>Mật khẩu khởi tạo: <strong>{credentials?.password || '—'}</strong></p></div>
      <div className="grid grid-cols-1 gap-6 text-center sm:grid-cols-2 print:grid-cols-2">
        <div><div ref={qrAdmin} className="flex justify-center">{origin && <QRCodeSVG value={`${origin}/admin`} size={220} level="M" marginSize={4} />}</div><h3 className="mt-2 font-bold">QR 1 · Đăng nhập Chủ quán</h3><p className="break-all text-xs">{origin}/admin</p></div>
        <div><div ref={qrTakeaway} className="flex justify-center">{origin && <QRCodeSVG value={`${origin}/customer/takeaway`} size={220} level="M" marginSize={4} />}</div><h3 className="mt-2 font-bold">QR 2 · Khách đặt mang về</h3><p className="break-all text-xs">{origin}/customer/takeaway</p></div>
      </div>
      <h3 className="mt-6 font-bold">3 bước bắt đầu dành cho Chủ quán</h3><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
    </section>
    <div className="operator-screen-only flex flex-wrap gap-3"><button onClick={downloadPng} disabled={busy || !credentials || !origin} className={buttonClass}>🖼️ Tải Ảnh Bàn Giao (.PNG)</button><button onClick={() => window.print()} disabled={busy || !credentials || !origin} className={buttonClass}>📄 Xuất / In File .PDF</button></div>
    <section className="operator-screen-only rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-lg font-bold">Tiện ích trước khai trương</h2><p className="my-3 text-sm text-zinc-400">Tạo mẫu khi chưa có bàn và món. Reset xóa toàn bộ hóa đơn, kể cả đã thanh toán; giữ nguyên thực đơn, khu vực, nhân sự và kho.</p>
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => runTool('seed')} className={buttonClass}>🌱 Tạo dữ liệu mẫu (Khu vực, Bàn & Menu mẫu)</button><button disabled={busy} onClick={() => runTool('reset')} className="min-h-12 rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 font-semibold text-red-300 disabled:opacity-50">🧹 Xóa dữ liệu hóa đơn test</button></div>
    </section>
    <style>{`@media print {
      @page { size: A4 portrait; margin: 12mm; }
      html, body { background: white !important; color: black !important; }
      body * { visibility: hidden; }
      .operator-screen-only { display: none !important; }
      #handover-kit, #handover-kit * { visibility: visible; }
      #handover-kit { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 8mm; border-radius: 0; box-sizing: border-box; break-inside: avoid; }
      #handover-kit svg { width: 48mm; height: 48mm; }
    }`}</style>
  </main>;
}
