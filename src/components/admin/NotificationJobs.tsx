'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useServerRefresh } from '@/lib/data/use-server-refresh';
import type { NotificationJobStatus, NotificationStatus } from '@/lib/notifications/contracts';

export function NotificationJobs({ status }: { status: NotificationStatus }) {
  useServerRefresh();
  const router = useRouter(), lock = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  async function retry(job: NotificationJobStatus) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/admin/notification-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, expectedAttempts: job.attempts }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('RETRY_UNCONFIRMED');
      setMessage('Đã đưa thông báo về hàng chờ. Hệ thống sẽ kiểm tra lại trước khi gửi.');
    } catch { setMessage('Chưa xác nhận được thao tác. Hãy tải lại trạng thái trước khi thử lại.'); }
    finally { router.refresh(); lock.current = false; setBusy(false); }
  }
  return <section className="space-y-4">
    <h1 className="text-xl font-bold">Tình trạng thông báo</h1>
    <p className="text-sm text-zinc-400">Đang chờ: {status.pending} · Cần kiểm tra: {status.failed}. Hiển thị tối đa 25 việc, ưu tiên lỗi.</p>
    <p className="text-sm text-zinc-400">Thông báo không thay thế danh sách công việc trên màn hình Phục vụ.</p>
    {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
    <button className="min-h-12 px-4 border rounded-xl" onClick={() => router.refresh()}>Tải lại trạng thái</button>
    {status.jobs.length === 0 && <p>Không có thông báo đang chờ xử lý.</p>}
    <ul className="space-y-3">{status.jobs.map(job => <li key={job.id} className="p-4 rounded-xl border border-zinc-800 space-y-2">
      <p>{job.kind === 'BILL_REQUESTED' ? 'Yêu cầu tính tiền' : job.kind === 'ORDER_READY_FALLBACK' ? 'Nhắc hỗ trợ bưng món' : job.kind === 'ORDER_READY' ? 'Món chờ phục vụ' : 'Cập nhật công việc'}</p>
      <p className="text-sm text-zinc-400">{job.failed_at ? 'Cần kiểm tra cấu hình hoặc kết nối' : job.locked_until ? 'Đang xử lý' : 'Đang chờ'} · Đã thử {job.attempts} lần</p>
      {job.failed_at && <button disabled={busy} className="min-h-12 px-4 rounded-xl bg-amber-500 text-zinc-950 disabled:opacity-40" onClick={() => void retry(job)}>Thử gửi lại</button>}
    </li>)}</ul>
  </section>;
}
