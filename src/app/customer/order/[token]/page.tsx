import { Lock } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { publicSession, readSnapshot } from '@/lib/services/snapshots';
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
  const supabase = await createSupabaseServerClient();

  // 1. Kiểm tra tính hợp lệ của session_token
  const { data: session } = await supabase
    .from('table_sessions')
    .select(
      'id, session_token, session_type, table_id, assigned_staff_id, customer_name, customer_phone, status, payment_method, payment_code, total_amount, opened_at, closed_at'
    )
    .eq('session_token', token)
    .single();

  if (!session || session.status === 'CLOSED') {
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
            Phiên gọi món tại bàn này đã kết thúc thanh toán (`CLOSED`) hoặc đường dẫn QR không tồn tại. Vui lòng liên hệ nhân viên phục vụ để mở phiên bàn mới.
          </p>
        </div>
      </div>
    );
  }

  const snapshot = await readSnapshot(null, token);
  const tableRes = session.table_id
    ? await supabase.from('tables').select('*').eq('id', session.table_id).single()
    : { data: null };

  const table = tableRes.data ?? null;

  const { data: zone } = table
    ? await supabase
        .from('zones')
        .select('id, name, created_at')
        .eq('id', table.zone_id)
        .single()
    : { data: null };

  return (
    <DineInOrderView
      initialSession={publicSession(session)}
      table={table}
      zone={zone ?? null}
      initialMenuItems={snapshot.menu}
      initialSessionOrders={snapshot.orders}
      initialGlobalKitchenQueue={snapshot.queue}
    />
  );
}
