import { Lock } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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

  // 2. Tải thông tin bàn, khu vực, thực đơn, các món của bàn và hàng đợi bếp toàn quán (chỉ tính các phiên đang ACTIVE / REQUEST_BILL)
  const [
    tableRes,
    menuRes,
    sessionOrdersRes,
    globalQueueRes,
    activeSessionsRes,
    ingredientsRes,
  ] = await Promise.all([
    session.table_id
      ? supabase
          .from('tables')
          .select('id, table_number, zone_id, status, current_session_id')
          .eq('id', session.table_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from('menu_items')
      .select(
        'id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id'
      )
      .order('category', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('order_items')
      .select(
        'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason'
      )
      .eq('session_id', session.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('order_items')
      .select(
        'id, session_id, menu_item_id, quantity, note, station, status, batch_id, unit_price, unit_cost_price, served_by_staff_id, created_at, cooking_started_at, ready_at, served_at, cancelled_at, cancelled_by, cancel_reason'
      )
      .eq('station', 'KITCHEN')
      .eq('status', 'QUEUED')
      .order('created_at', { ascending: true }),
    supabase
      .from('table_sessions')
      .select('id')
      .in('status', ['ACTIVE', 'REQUEST_BILL']),
    supabase
      .from('ingredients')
      .select('id, name, unit, stock_quantity, min_threshold, unit_cost'),
  ]);

  const activeSessionIdSet = new Set(
    (activeSessionsRes.data ?? []).map((s) => s.id)
  );
  const validGlobalKitchenQueue = (globalQueueRes.data ?? []).filter((item) =>
    activeSessionIdSet.has(item.session_id)
  );

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
      initialSession={session}
      table={table}
      zone={zone ?? null}
      initialMenuItems={menuRes.data ?? []}
      initialSessionOrders={sessionOrdersRes.data ?? []}
      initialGlobalKitchenQueue={validGlobalKitchenQueue}
      initialIngredients={ingredientsRes.data ?? []}
    />
  );
}
