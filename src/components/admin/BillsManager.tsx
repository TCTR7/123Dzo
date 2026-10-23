'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Printer,
  CheckCircle2,
  BellRing,
  Search,
  Ban,
  Clock,
  CreditCard,
  Banknote,
  ShoppingBag,
  X,
} from 'lucide-react';
import { useAppEvents } from '@/lib/use-app-events';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatVND, playNotificationSound, cn } from '@/lib/utils';
import type {
  MenuItemRow,
  OrderItemRow,
  PaymentMethod,
  StaffProfileRow,
  TableRow,
  TableSessionRow,
} from '@/types/database.types';

interface BillsManagerProps {
  initialSessions: TableSessionRow[];
  initialOrderItems: OrderItemRow[];
  tables: TableRow[];
  menuItems: MenuItemRow[];
  staffProfiles: StaffProfileRow[];
  currentAdminId: string | null;
}

export function BillsManager({
  initialSessions,
  initialOrderItems,
  tables,
  menuItems,
  staffProfiles,
  currentAdminId,
}: BillsManagerProps) {
  const supabase = createSupabaseBrowserClient();

  const [sessions, setSessions] = useState<TableSessionRow[]>(initialSessions);
  const [orderItems, setOrderItems] =
    useState<OrderItemRow[]>(initialOrderItems);

  const [tabFilter, setTabFilter] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => {
      const firstUrgent = initialSessions.find(
        (s) => s.status === 'REQUEST_BILL' || s.status === 'PENDING_PAYMENT'
      );
      return firstUrgent?.id ?? initialSessions[0]?.id ?? null;
    }
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>('CASH');

  // Modal hủy món của Admin (bắt buộc nhập cancel_reason theo Mục 7 RBAC)
  const [cancellingOrderItem, setCancellingOrderItem] =
    useState<OrderItemRow | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tableMap = useMemo(() => {
    const map = new Map<string, TableRow>();
    tables.forEach((t) => map.set(t.id, t));
    return map;
  }, [tables]);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemRow>();
    menuItems.forEach((m) => map.set(m.id, m));
    return map;
  }, [menuItems]);

  const staffMap = useMemo(() => {
    const map = new Map<string, StaffProfileRow>();
    staffProfiles.forEach((s) => map.set(s.id, s));
    return map;
  }, [staffProfiles]);

  // ==========================================================================
  // LẮNG NGHE REALTIME TABLE_SESSIONS & ORDER_ITEMS (CÓ CLEANUP REMOVECHANNEL)
  // ==========================================================================
  useAppEvents((snapshot) => {
    setSessions(snapshot.sessions); setOrderItems(snapshot.orders);
  }, { sound: true });

  const requestBillCount = useMemo(
    () => sessions.filter((s) => s.status === 'REQUEST_BILL').length,
    [sessions]
  );

  const pendingTakeawayCount = useMemo(
    () =>
      sessions.filter(
        (s) => s.session_type === 'TAKEAWAY' && s.status === 'PENDING_PAYMENT'
      ).length,
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        if (tabFilter === 'OPEN') {
          if (s.status === 'CLOSED') return false;
        } else {
          if (s.status !== 'CLOSED') return false;
        }

        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const tableLabel = s.table_id
          ? tableMap.get(s.table_id)?.table_number.toLowerCase() ?? ''
          : '';
        return (
          s.session_token.toLowerCase().includes(q) ||
          (s.payment_code ?? '').toLowerCase().includes(q) ||
          (s.customer_name ?? '').toLowerCase().includes(q) ||
          (s.customer_phone ?? '').toLowerCase().includes(q) ||
          tableLabel.includes(q)
        );
      })
      .sort((a, b) => {
        const aUrgent =
          a.status === 'REQUEST_BILL' || a.status === 'PENDING_PAYMENT';
        const bUrgent =
          b.status === 'REQUEST_BILL' || b.status === 'PENDING_PAYMENT';
        if (aUrgent && !bUrgent) {
          return -1;
        }
        if (bUrgent && !aUrgent) {
          return 1;
        }
        return (
          new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
        );
      });
  }, [sessions, tabFilter, searchQuery, tableMap]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  const selectedSessionOrders = useMemo(() => {
    if (!selectedSession) return [];
    return orderItems.filter((i) => i.session_id === selectedSession.id);
  }, [orderItems, selectedSession]);

  const validSelectedOrders = useMemo(
    () => selectedSessionOrders.filter((i) => i.status !== 'CANCELLED'),
    [selectedSessionOrders]
  );

  const calculatedBillTotal = useMemo(
    () =>
      validSelectedOrders.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0
      ),
    [validSelectedOrders]
  );

  function getSessionTitle(session: TableSessionRow): string {
    if (session.session_type === 'TAKEAWAY') {
      return `Mang về • ${session.customer_name ?? 'Khách lẻ'}`;
    }
    if (session.table_id) {
      return tableMap.get(session.table_id)?.table_number ?? 'Bàn nhậu';
    }
    return 'Bàn nhậu';
  }

  /**
   * Admin hủy món (bao gồm cả món đang nấu COOKING hoặc đã bưng SERVED)
   * Bắt buộc phải có cancel_reason theo Mục 7 RBAC Matrix & Mục 3.2 AGENTS.md
   */
  async function handleAdminCancelOrderItem(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    if (!cancellingOrderItem || !selectedSession || isSubmitting) return;

    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) {
      setErrorMessage(
        'Admin hủy món bắt buộc phải nhập lý do hủy (cancel_reason).'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const nowIso = new Date().toISOString();
      const validAdminId =
        currentAdminId && staffMap.has(currentAdminId)
          ? currentAdminId
          : null;

      const { data: cancelledItem, error } = await supabase
        .from('order_items')
        .update({
          status: 'CANCELLED',
          cancelled_at: nowIso,
          cancelled_by: validAdminId,
          cancel_reason: trimmedReason,
        })
        .eq('id', cancellingOrderItem.id)
        .select('*')
        .single();

      if (error || !cancelledItem) {
        throw new Error(error?.message ?? 'Không thể hủy món');
      }

      const nextOrders = orderItems.map((i) =>
        i.id === cancelledItem.id ? cancelledItem : i
      );
      setOrderItems(nextOrders);

      const newTotal = nextOrders
        .filter(
          (i) => i.session_id === selectedSession.id && i.status !== 'CANCELLED'
        )
        .reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

      const { data: updatedSession } = await supabase
        .from('table_sessions')
        .update({ total_amount: newTotal })
        .eq('id', selectedSession.id)
        .select('*')
        .single();

      if (updatedSession) {
        setSessions((prev) =>
          prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
        );
      }

      setCancellingOrderItem(null);
      setCancelReason('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi hủy món');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Chủ quán xác nhận đã nhận tiền chuyển khoản từ khách đặt mang về ở xa (TAKEAWAY):
   * 1. Chuyển table_sessions.status từ 'PENDING_PAYMENT' -> 'ACTIVE' (payment_method = 'VIETQR')
   * 2. Đẩy các món KITCHEN vào hàng đợi Bếp (QUEUED) & các món BAR_INSTANT sang READY
   * 3. Tự động trừ kho nguyên liệu (EXPORT_SALE) cho các món có linked_ingredient_id
   */
  async function handleConfirmTakeawayTransfer() {
    if (
      !selectedSession ||
      selectedSession.session_type !== 'TAKEAWAY' ||
      selectedSession.status !== 'PENDING_PAYMENT' ||
      isSubmitting
    ) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const nowIso = new Date().toISOString();
      const validAdminId =
        currentAdminId && staffMap.has(currentAdminId)
          ? currentAdminId
          : null;

      const { data: activatedSession, error: sessionErr } = await supabase
        .from('table_sessions')
        .update({
          status: 'ACTIVE',
          payment_method: 'VIETQR',
          total_amount: calculatedBillTotal,
        })
        .eq('id', selectedSession.id)
        .select('*')
        .single();

      if (sessionErr || !activatedSession) {
        throw new Error(
          sessionErr?.message ?? 'Không thể xác nhận chuyển khoản đơn mang về'
        );
      }

      setSessions((prev) =>
        prev.map((s) => (s.id === activatedSession.id ? activatedSession : s))
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Lỗi khi xác nhận chuyển khoản đơn mang về'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Bấm "In Bill & Đóng bàn":
   * 1. Cập nhật table_sessions -> status = 'CLOSED', closed_at = NOW(), payment_method, total_amount
   * 2. Giải phóng bàn vật lý (tables.status = 'AVAILABLE', current_session_id = null)
   * 3. Kích hoạt hộp thoại in nhiệt khổ K80 (window.print())
   */
  async function handlePrintAndCloseBill() {
    if (!selectedSession || isSubmitting) return;

    // Nếu hóa đơn đã đóng trước đó, chỉ thực hiện in lại bill K80
    if (selectedSession.status === 'CLOSED') {
      window.print();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const nowIso = new Date().toISOString();
      const finalMethod =
        selectedSession.payment_method ?? selectedPaymentMethod;

      const { data: closedSession, error: sessionErr } = await supabase
        .from('table_sessions')
        .update({
          status: 'CLOSED',
          payment_method: finalMethod,
          total_amount: calculatedBillTotal,
          closed_at: nowIso,
        })
        .eq('id', selectedSession.id)
        .select('*')
        .single();

      if (sessionErr || !closedSession) {
        throw new Error(sessionErr?.message ?? 'Không thể đóng hóa đơn');
      }

      if (selectedSession.table_id) {
        await supabase
          .from('tables')
          .update({
            status: 'AVAILABLE',
            current_session_id: null,
          })
          .eq('id', selectedSession.table_id);
      }

      setSessions((prev) =>
        prev.map((s) => (s.id === closedSession.id ? closedSession : s))
      );

      // Đợi DOM cập nhật trạng thái CLOSED rồi gọi lệnh in nhiệt K80
      setTimeout(() => {
        window.print();
      }, 150);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi chốt và in hóa đơn'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header không in */}
      <div className="print:hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-100">
            Thu ngân, Quản lý Hóa đơn &amp; In Bill Nhiệt K80
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Chủ quán xác nhận chuyển khoản đơn mang về (`PENDING_PAYMENT`), chốt bill tại bàn (`REQUEST_BILL`) và in hóa đơn nhiệt khổ 80mm.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pendingTakeawayCount > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500 text-amber-300 text-xs font-extrabold animate-pulse">
              <ShoppingBag className="h-4 w-4" />
              Có {pendingTakeawayCount} đơn mang về chờ duyệt chuyển khoản!
            </div>
          )}

          {requestBillCount > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500 text-rose-300 text-xs font-extrabold animate-pulse">
              <BellRing className="h-4 w-4" />
              Có {requestBillCount} bàn đang gọi tính tiền!
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="print:hidden p-3.5 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bố cục 2 cột: Danh sách Phiên bàn & Bản xem trước Hóa đơn K80 */}
      <div className="print:block grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cột trái: Danh sách hóa đơn */}
        <div className="print:hidden lg:col-span-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 p-3 rounded-2xl">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setTabFilter('OPEN')}
                className={cn(
                  'px-3.5 py-2 rounded-xl text-xs font-bold transition-colors',
                  tabFilter === 'OPEN'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-950 text-zinc-400'
                )}
              >
                Đang mở / Chờ thanh toán
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('CLOSED')}
                className={cn(
                  'px-3.5 py-2 rounded-xl text-xs font-bold transition-colors',
                  tabFilter === 'CLOSED'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-950 text-zinc-400'
                )}
              >
                Lịch sử đã đóng (CLOSED)
              </button>
            </div>

            <div className="relative flex-1">
              <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm số bàn, mã CK (DZO...), SĐT..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100"
              />
            </div>
          </div>

          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {filteredSessions.length === 0 ? (
              <div className="py-12 text-center bg-zinc-900 border border-zinc-800 rounded-2xl text-zinc-500 text-sm">
                Không có hóa đơn nào trong mục này.
              </div>
            ) : (
              filteredSessions.map((sess) => {
                const isSelected = sess.id === selectedSessionId;
                const isRequestBill = sess.status === 'REQUEST_BILL';
                const isPendingTakeaway =
                  sess.session_type === 'TAKEAWAY' &&
                  sess.status === 'PENDING_PAYMENT';
                const staff = sess.assigned_staff_id
                  ? staffMap.get(sess.assigned_staff_id)
                  : undefined;

                return (
                  <div
                    key={sess.id}
                    onClick={() => {
                      setSelectedSessionId(sess.id);
                      if (sess.payment_method) {
                        setSelectedPaymentMethod(sess.payment_method);
                      }
                    }}
                    className={cn(
                      'p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between gap-3',
                      isRequestBill
                        ? 'bg-rose-950/35 border-rose-500/70'
                        : isPendingTakeaway
                        ? 'bg-amber-950/35 border-amber-500/70'
                        : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700',
                      isSelected ? 'ring-2 ring-amber-400' : ''
                    )}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-base text-zinc-100">
                          {getSessionTitle(sess)}
                        </span>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-bold',
                            sess.status === 'REQUEST_BILL'
                              ? 'bg-rose-500 text-white animate-pulse'
                              : isPendingTakeaway
                              ? 'bg-amber-500 text-zinc-950 animate-pulse'
                              : sess.status === 'ACTIVE'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : sess.status === 'CLOSED'
                              ? 'bg-zinc-800 text-zinc-300'
                              : 'bg-amber-500/20 text-amber-300'
                          )}
                        >
                          {sess.status === 'REQUEST_BILL'
                            ? 'GỌI TÍNH TIỀN'
                            : isPendingTakeaway
                            ? 'CHỜ CHỦ QUÁN DUYỆT CK'
                            : sess.status === 'ACTIVE' &&
                              sess.session_type === 'TAKEAWAY'
                            ? 'ĐÃ DUYỆT CK • BẾP ĐANG NẤU'
                            : sess.status}
                        </span>
                      </div>

                      <div className="text-xs text-zinc-400 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(sess.opened_at).toLocaleString('vi-VN')}
                        </span>
                        {sess.payment_code && (
                          <span>
                            • Nội dung CK:{' '}
                            <strong className="text-amber-300 font-mono">
                              {sess.payment_code}
                            </strong>
                          </span>
                        )}
                        {sess.customer_phone && (
                          <span>• SĐT: {sess.customer_phone}</span>
                        )}
                        {staff && <span>• NV: {staff.full_name}</span>}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-black text-amber-400">
                        {formatVND(sess.total_amount)}
                      </div>
                      <span className="text-[11px] text-zinc-400">
                        {sess.payment_method ?? 'Chưa chọn PTTT'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Cột phải: Chi tiết đối soát & Mẫu In Nhiệt K80 */}
        <div className="lg:col-span-6 space-y-4">
          {!selectedSession ? (
            <div className="print:hidden bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 text-sm">
              Chọn một hóa đơn bên trái để đối soát, in bill nhiệt K80 và đóng phiên bàn.
            </div>
          ) : (
            <>
              {/* Bảng điều khiển Thu ngân (Ẩn khi in) */}
              <div className="print:hidden bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div>
                    <span className="text-xs text-amber-400 font-bold">
                      Chi tiết thu ngân &amp; kiểm soát món
                    </span>
                    <h3 className="text-xl font-black text-zinc-100">
                      {getSessionTitle(selectedSession)}
                    </h3>
                    {selectedSession.session_type === 'TAKEAWAY' && (
                      <p className="text-xs text-zinc-400 mt-1">
                        SĐT khách:{' '}
                        <strong className="text-zinc-200">
                          {selectedSession.customer_phone ?? '—'}
                        </strong>{' '}
                        • Nội dung CK:{' '}
                        <code className="px-1.5 py-0.5 rounded bg-zinc-950 text-emerald-400 font-bold">
                          {selectedSession.payment_code ??
                            selectedSession.session_token}
                        </code>
                      </p>
                    )}
                  </div>

                  {selectedSession.status !== 'CLOSED' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedPaymentMethod('CASH')}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border',
                          selectedPaymentMethod === 'CASH'
                            ? 'bg-amber-500 text-zinc-950 border-amber-500'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                        )}
                      >
                        <Banknote className="h-4 w-4" />
                        Tiền mặt
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPaymentMethod('VIETQR')}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border',
                          selectedPaymentMethod === 'VIETQR'
                            ? 'bg-amber-500 text-zinc-950 border-amber-500'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                        )}
                      >
                        <CreditCard className="h-4 w-4" />
                        VietQR
                      </button>
                    </div>
                  )}
                </div>

                {/* Hộp xác nhận chuyển khoản của Chủ quán dành riêng cho đơn Mang về ở xa */}
                {selectedSession.session_type === 'TAKEAWAY' &&
                  selectedSession.status === 'PENDING_PAYMENT' && (
                    <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 space-y-3">
                      <div className="text-xs text-amber-200 leading-relaxed">
                        <strong className="text-amber-300 block text-sm mb-0.5">
                          Đơn đặt mang về từ xa đang chờ Chủ quán xác nhận chuyển khoản
                        </strong>
                        Kiểm tra tài khoản ngân hàng xem đã nhận đủ{' '}
                        <strong>{formatVND(calculatedBillTotal)}</strong> với nội
                        dung{' '}
                        <code className="px-1.5 py-0.5 rounded bg-zinc-950 text-emerald-400 font-bold">
                          {selectedSession.payment_code}
                        </code>{' '}
                        chưa. Khi bấm xác nhận, đơn sẽ lập tức chuyển sang{' '}
                        <strong>ACTIVE</strong> và hiện lên màn hình Bếp!
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleConfirmTakeawayTransfer}
                        className="min-h-12 w-full py-3 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg"
                      >
                        <CheckCircle2 className="h-5 w-5" />
                        Xác nhận đã nhận chuyển khoản • Đẩy đơn vào Bếp (
                        {formatVND(calculatedBillTotal)})
                      </button>
                    </div>
                  )}

                {/* Danh sách món cho phép Admin hủy kèm lý do */}
                <div className="divide-y divide-zinc-800 max-h-60 overflow-y-auto pr-1 text-sm">
                  {selectedSessionOrders.map((item) => {
                    const menu = menuMap.get(item.menu_item_id);
                    return (
                      <div
                        key={item.id}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div>
                          <span
                            className={cn(
                              'font-semibold',
                              item.status === 'CANCELLED'
                                ? 'line-through text-zinc-500'
                                : 'text-zinc-100'
                            )}
                          >
                            {item.quantity}x {menu?.name ?? 'Món ăn'} (
                            {formatVND(item.unit_price)})
                          </span>
                          <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                            {item.status}
                          </span>
                          {item.cancel_reason && (
                            <span className="block text-[11px] text-red-400">
                              Lý do hủy: {item.cancel_reason}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-200">
                            {formatVND(item.unit_price * item.quantity)}
                          </span>
                          {selectedSession.status !== 'CLOSED' &&
                            item.status !== 'CANCELLED' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingOrderItem(item);
                                  setCancelReason('');
                                }}
                                title="Admin hủy món (Bắt buộc nhập lý do)"
                                className="p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handlePrintAndCloseBill}
                  className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg"
                >
                  <Printer className="h-5 w-5" />
                  {selectedSession.status === 'CLOSED'
                    ? 'In lại Hóa đơn Nhiệt K80 (80mm)'
                    : selectedSession.session_type === 'TAKEAWAY'
                    ? `In Bill K80 & Hoàn tất giao đơn Mang về (${formatVND(
                        calculatedBillTotal
                      )})`
                    : `In Bill K80 & Đóng bàn (${formatVND(
                        calculatedBillTotal
                      )})`}
                </button>
              </div>

              {/* ============================================================ */}
              {/* MẪU HÓA ĐƠN IN NHIỆT KHỔ K80 (80MM) CHUẨN POS */}
              {/* ============================================================ */}
              <div
                id="k80-thermal-receipt"
                className="bg-white text-black rounded-2xl p-6 max-w-[320px] mx-auto shadow-xl font-mono text-xs space-y-3"
              >
                <div className="text-center border-b border-dashed border-black pb-3 space-y-0.5">
                  <div className="font-black text-base tracking-tight">
                    QUÁN NHẬU 123DZÔ
                  </div>
                  <div>Đ/C: TP. Hồ Chí Minh • Hotline: 0909.123.456</div>
                  <div className="font-bold text-sm pt-1">
                    HÓA ĐƠN THANH TOÁN
                  </div>
                </div>

                <div className="border-b border-dashed border-black pb-2 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>Phiên / Bàn:</span>
                    <strong className="uppercase">
                      {getSessionTitle(selectedSession)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Mã bill:</span>
                    <span>{selectedSession.session_token}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Giờ mở:</span>
                    <span>
                      {new Date(selectedSession.opened_at).toLocaleString(
                        'vi-VN'
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Giờ in:</span>
                    <span>
                      {new Date(
                        selectedSession.closed_at ?? new Date().toISOString()
                      ).toLocaleString('vi-VN')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Thu ngân / NV:</span>
                    <span>
                      {selectedSession.assigned_staff_id
                        ? staffMap.get(selectedSession.assigned_staff_id)
                            ?.full_name ?? 'Admin'
                        : 'Chủ quán / Thu ngân'}
                    </span>
                  </div>
                </div>

                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-dashed border-black">
                      <th className="py-1">Tên món</th>
                      <th className="py-1 text-center">SL</th>
                      <th className="py-1 text-right">T.Tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-gray-400">
                    {validSelectedOrders.map((item) => {
                      const menu = menuMap.get(item.menu_item_id);
                      return (
                        <tr key={item.id}>
                          <td className="py-1.5 pr-1">
                            <div className="font-bold">
                              {menu?.name ?? 'Món gọi'}
                            </div>
                            <div className="text-[10px] text-gray-700">
                              {formatVND(item.unit_price)}
                            </div>
                          </td>
                          <td className="py-1.5 text-center font-bold">
                            {item.quantity}
                          </td>
                          <td className="py-1.5 text-right font-bold">
                            {formatVND(item.unit_price * item.quantity)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="border-t border-dashed border-black pt-2 space-y-1">
                  <div className="flex justify-between text-sm font-black">
                    <span>TỔNG CỘNG:</span>
                    <span>{formatVND(calculatedBillTotal)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span>Phương thức TT:</span>
                    <strong>
                      {selectedSession.payment_method ?? selectedPaymentMethod}
                    </strong>
                  </div>
                </div>

                <div className="text-center border-t border-dashed border-black pt-3 text-[11px] space-y-0.5">
                  <div className="font-bold">1, 2, 3... DZÔ! 🍻</div>
                  <div>Cảm ơn Quý khách &amp; Hẹn gặp lại!</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Admin hủy món (bắt buộc nhập cancel_reason theo Mục 7 RBAC) */}
      {cancellingOrderItem && (
        <div className="print:hidden fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                Xác nhận Hủy món (Quyền Admin)
              </h3>
              <button
                type="button"
                onClick={() => setCancellingOrderItem(null)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAdminCancelOrderItem} className="space-y-4">
              <p className="text-xs text-zinc-300">
                Món đang chọn:{' '}
                <strong>
                  {cancellingOrderItem.quantity}x{' '}
                  {menuMap.get(cancellingOrderItem.menu_item_id)?.name ??
                    'Món ăn'}
                </strong>{' '}
                (Trạng thái: <code>{cancellingOrderItem.status}</code>)
              </p>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Lý do hủy món (`cancel_reason` - Bắt buộc theo Mục 7 RBAC) *
                </label>
                <input
                  type="text"
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="VD: Bếp làm cháy món / Khách báo đợi quá 15 phút..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancellingOrderItem(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-semibold"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
                >
                  Xác nhận Hủy món
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
