import { Lock } from 'lucide-react';
import { readDineInSnapshot } from '@/lib/data/dine-in-snapshot';
import { DineInOrderView } from '@/components/customer/DineInOrderView';

export const dynamic = 'force-dynamic';

interface DineInTableTokenPageProps {
  params: Promise<{ token: string }>;
}

export default async function DineInTableTokenPage({
  params,
}: DineInTableTokenPageProps) {
  // Tuân thủ Next.js 15 App Router: params bắt buộc phải await
  const { token } = await params;
  const snapshot = await readDineInSnapshot(token);

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-zinc-100">
            Mã QR không hợp lệ hoặc bàn đã đóng
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Mã gọi món này không còn sử dụng được. Vui lòng nhờ nhân viên kiểm tra hoặc mở bàn mới.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DineInOrderView
      initialSession={snapshot.session}
      table={snapshot.table}
      zone={snapshot.zone}
      initialMenuItems={snapshot.menu}
      initialSessionOrders={snapshot.items}
      initialQueuePositions={snapshot.queuePositions}
    />
  );
}
