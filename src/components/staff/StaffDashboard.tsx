'use client';
import { orderStatusLabel, staffRoleLabel } from '@/lib/ui-labels';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { OnboardingGuideModal } from '@/components/shared/OnboardingGuideModal';
import {
  BellRing,
  QrCode,
  PlusCircle,
  ArrowRightLeft,
  UserCheck,
  RotateCcw,
  CheckCircle2,
  UtensilsCrossed,
  Beer,
  Receipt,
  Ban,
  Volume2,
  X,
  Clock,
  ExternalLink,
  BarChart3,
  ChefHat,
} from 'lucide-react';
import { useAppEvents } from '@/lib/use-app-events';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  formatVND,
  playNotificationSound,
  getElapsedMinutes,
  cn,
} from '@/lib/utils';
import type {
  IngredientRow,
  MenuItemRow,
  OrderItemRow,
  PaymentMethod,
  StaffProfileRow,
  StaffRole,
  TableRow,
  TableSessionRow,
} from '@/types/database.types';

interface StaffDashboardProps {
  initialTables: TableRow[];
  initialSessions: TableSessionRow[];
  initialOrderItems: OrderItemRow[];
  menuItems: MenuItemRow[];
  initialIngredients: IngredientRow[];
  staffProfiles: StaffProfileRow[];
  currentStaffId: string | null;
  currentStaffRole: StaffRole;
}

function generateSessionToken(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 10; i += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function generatePaymentCode(): string {
  return `DZO${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

export function StaffDashboard({
  initialTables,
  initialSessions,
  initialOrderItems,
  menuItems: initialMenuItems,
  initialIngredients,
  staffProfiles,
  currentStaffId,
  currentStaffRole,
}: StaffDashboardProps) {
  const supabase = createSupabaseBrowserClient();
  const [menuItems, setMenuItems] = useState(initialMenuItems);

  const [tables, setTables] = useState<TableRow[]>(initialTables);
  const [sessions, setSessions] = useState<TableSessionRow[]>(initialSessions);
  const [orderItems, setOrderItems] =
    useState<OrderItemRow[]>(initialOrderItems);
  const [ingredients, setIngredients] =
    useState<IngredientRow[]>(initialIngredients);

  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [qrModalSession, setQrModalSession] =
    useState<TableSessionRow | null>(null);

  // Modal states cho các nghiệp vụ trên bàn đang chọn
  const [isOrderModalOpen, setIsOrderModalOpen] = useState<boolean>(false);
  const [isTransferModalOpen, setIsTransferModalOpen] =
    useState<boolean>(false);
  const [isHandoverModalOpen, setIsHandoverModalOpen] =
    useState<boolean>(false);
  const [isReturnBeerModalOpen, setIsReturnBeerModalOpen] =
    useState<boolean>(false);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] =
    useState<boolean>(false);

  // Form states
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [selectedMenuQty, setSelectedMenuQty] = useState<
    Record<string, number>
  >({});
  const [selectedMenuNote, setSelectedMenuNote] = useState<
    Record<string, string>
  >({});
  const [targetTransferTableId, setTargetTransferTableId] =
    useState<string>('');
  const [targetHandoverStaffId, setTargetHandoverStaffId] =
    useState<string>('');
  const [selectedReturnOrderItemId, setSelectedReturnOrderItemId] =
    useState<string>('');
  const [returnBeerQuantity, setReturnBeerQuantity] = useState<string>('1');
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] =
    useState<PaymentMethod>('CASH');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [originUrl, setOriginUrl] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
  }, []);

  const staffMap = useMemo(() => {
    const map = new Map<string, StaffProfileRow>();
    staffProfiles.forEach((s) => map.set(s.id, s));
    return map;
  }, [staffProfiles]);

  const validCurrentStaffId = useMemo(() => {
    if (currentStaffId && staffMap.has(currentStaffId)) {
      return currentStaffId;
    }
    return null;
  }, [currentStaffId, staffMap]);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemRow>();
    menuItems.forEach((m) => map.set(m.id, m));
    return map;
  }, [menuItems]);

  const ingredientMap = useMemo(() => {
    const map = new Map<string, IngredientRow>();
    ingredients.forEach((ing) => map.set(ing.id, ing));
    return map;
  }, [ingredients]);

  const tableMap = useMemo(() => {
    const map = new Map<string, TableRow>();
    tables.forEach((t) => map.set(t.id, t));
    return map;
  }, [tables]);

  const sessionByTableId = useMemo(() => {
    const map = new Map<string, TableSessionRow>();
    sessions.forEach((s) => {
      if (s.table_id && s.status !== 'CLOSED') {
        map.set(s.table_id, s);
      }
    });
    return map;
  }, [sessions]);

  const sessionMap = useMemo(() => {
    const map = new Map<string, TableSessionRow>();
    sessions.forEach((s) => map.set(s.id, s));
    return map;
  }, [sessions]);

  // Tính lại tổng tiền phiên bàn từ các order_items hợp lệ (status !== 'CANCELLED')
  const recalculateSessionTotal = useCallback(
    async (sessionId: string, currentItems: OrderItemRow[]) => {
      const validTotal = currentItems
        .filter((i) => i.session_id === sessionId && i.status !== 'CANCELLED')
        .reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

      const { data } = await supabase
        .from('table_sessions')
        .update({ total_amount: validTotal })
        .eq('id', sessionId)
        .select('*')
        .single();

      if (data) {
        setSessions((prev) => prev.map((s) => (s.id === data.id ? data : s)));
      }
    },
    [supabase]
  );

  // ==========================================================================
  // LẮNG NGHE SUPABASE REALTIME (ORDER_ITEMS & TABLE_SESSIONS) + DỌN DẸP KÊNH
  // ==========================================================================
  const live = useAppEvents((snapshot) => {
    setOrderItems(snapshot.orders); setSessions(snapshot.sessions);
    setTables(snapshot.tables); setIngredients(snapshot.ingredients); setMenuItems(snapshot.menu);
  }, { sound: true, view: 'staff' });

  // Danh sách các món đã chín / đồ uống lấy ngay (status === 'READY') đang chờ bưng
  const readyOrderItems = useMemo(() => {
    return orderItems
      .filter((item) => item.status === 'READY')
      .sort((a, b) => {
        const timeA = new Date(a.ready_at ?? a.created_at).getTime();
        const timeB = new Date(b.ready_at ?? b.created_at).getTime();
        return timeA - timeB;
      });
  }, [orderItems]);

  const activeTable = activeTableId ? tableMap.get(activeTableId) ?? null : null;
  const activeTableSession = activeTable
    ? sessionByTableId.get(activeTable.id) ?? null
    : null;

  const activeTableOrders = useMemo(() => {
    if (!activeTableSession) return [];
    return orderItems.filter((i) => i.session_id === activeTableSession.id);
  }, [orderItems, activeTableSession]);

  const availableTablesForTransfer = useMemo(() => {
    return tables.filter((t) => t.status === 'AVAILABLE');
  }, [tables]);

  // ==========================================================================
  // 1. MỞ BÀN MỚI & SINH SESSION_TOKEN QR ĐỘNG (MỤC 3.1)
  // ==========================================================================
  async function handleOpenTable(table: TableRow) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const token = generateSessionToken();
      const paymentCode = generatePaymentCode();

      const { data: createdSession, error: sessionError } = await supabase
        .from('table_sessions')
        .insert({
          session_token: token,
          session_type: 'DINE_IN',
          table_id: table.id,
          assigned_staff_id: validCurrentStaffId,
          status: 'ACTIVE',
          payment_code: paymentCode,
          total_amount: 0,
          opened_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (sessionError || !createdSession) {
        throw new Error(sessionError?.message ?? 'Không thể mở phiên bàn mới');
      }

      const { data: updatedTable, error: tableError } = await supabase
        .from('tables')
        .update({
          status: 'OCCUPIED',
          current_session_id: createdSession.id,
        })
        .eq('id', table.id)
        .select('*')
        .single();

      if (tableError || !updatedTable) {
        throw new Error(
          tableError?.message ?? 'Không thể cập nhật trạng thái bàn'
        );
      }

      setSessions((prev) => [createdSession, ...prev]);
      setTables((prev) =>
        prev.map((t) => (t.id === updatedTable.id ? updatedTable : t))
      );
      setActiveTableId(updatedTable.id);
      setQrModalSession(createdSession);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi mở bàn');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 2. BẤM "ĐÃ BƯNG LÊN BÀN" (CẬP NHẬT SERVED_AT & SERVED_BY_STAFF_ID - MỤC 2.2 & 3.3)
  // ==========================================================================
  async function handleServeOrderItem(item: OrderItemRow) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('order_items')
        .update({
          status: 'SERVED',
          served_at: nowIso,
          served_by_staff_id: validCurrentStaffId,
        })
        .eq('id', item.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Không thể xác nhận đã bưng món');
      }

      setOrderItems((prev) =>
        prev.map((oi) => (oi.id === data.id ? data : oi))
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi cập nhật trạng thái phục vụ'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 3. ORDER HỘ KHÁCH (SNAPSHOT PRICE & BAR_INSTANT -> READY NGAY)
  // ==========================================================================
  async function handleStaffAddOrderItem(menuItem: MenuItemRow) {
    if (!activeTableSession || isSubmitting) return;

    // Kiểm tra chặt chẽ trạng thái phiên bàn trước khi thêm món
    if (activeTableSession.status !== 'ACTIVE') {
      setErrorMessage(
        'Chỉ được đặt thêm món khi phiên bàn đang ở trạng thái ACTIVE.'
      );
      return;
    }

    const qty = Math.max(1, selectedMenuQty[menuItem.id] ?? 1);
    const note = (selectedMenuNote[menuItem.id] ?? '').trim() || null;
    const isInstantBar = menuItem.station === 'BAR_INSTANT';
    const nowIso = new Date().toISOString();

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Bắt buộc copy price -> unit_price và cost_price -> unit_cost_price (Snapshot Price)
      // Nếu station === 'BAR_INSTANT', set thẳng status = 'READY' và ready_at = NOW()
      const { data: insertedItem, error: insertError } = await supabase
        .from('order_items')
        .insert({
          session_id: activeTableSession.id,
          menu_item_id: menuItem.id,
          quantity: qty,
          note,
          station: menuItem.station,
          status: isInstantBar ? 'READY' : 'QUEUED',
          unit_price: menuItem.price,
          unit_cost_price: menuItem.cost_price,
          created_at: nowIso,
          ready_at: isInstantBar ? nowIso : null,
        })
        .select('*')
        .single();

      if (insertError || !insertedItem) {
        throw new Error(insertError?.message ?? 'Không thể thêm món vào bàn');
      }

      const nextItems = [insertedItem, ...orderItems];
      setOrderItems(nextItems);
      await recalculateSessionTotal(activeTableSession.id, nextItems);

      setSelectedMenuQty((prev) => ({ ...prev, [menuItem.id]: 1 }));
      setSelectedMenuNote((prev) => ({ ...prev, [menuItem.id]: '' }));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi đặt món hộ khách'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 4. CHUYỂN BÀN (MỤC 6.3 - GIỮ NGUYÊN SESSION_TOKEN & CẬP NHẬT TABLE_ID)
  // ==========================================================================
  async function handleTransferTable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !activeTable ||
      !activeTableSession ||
      !targetTransferTableId ||
      isSubmitting
    ) {
      return;
    }

    const targetTable = tableMap.get(targetTransferTableId);
    if (!targetTable || targetTable.status !== 'AVAILABLE') {
      setErrorMessage('Bàn đích không hợp lệ hoặc đang có khách.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Cập nhật table_id trong bảng table_sessions
      const { data: updatedSession, error: sessionErr } = await supabase
        .from('table_sessions')
        .update({ table_id: targetTable.id })
        .eq('id', activeTableSession.id)
        .select('*')
        .single();

      if (sessionErr || !updatedSession) {
        throw new Error(sessionErr?.message ?? 'Không thể chuyển phiên bàn');
      }

      // 2. Giải phóng bàn cũ về AVAILABLE
      const { data: oldTableData, error: oldTableErr } = await supabase
        .from('tables')
        .update({ status: 'AVAILABLE', current_session_id: null })
        .eq('id', activeTable.id)
        .select('*')
        .single();

      if (oldTableErr || !oldTableData) {
        throw new Error(oldTableErr?.message ?? 'Không thể giải phóng bàn cũ');
      }

      // 3. Đánh dấu bàn mới là OCCUPIED
      const { data: newTableData, error: newTableErr } = await supabase
        .from('tables')
        .update({
          status: 'OCCUPIED',
          current_session_id: updatedSession.id,
        })
        .eq('id', targetTable.id)
        .select('*')
        .single();

      if (newTableErr || !newTableData) {
        throw new Error(newTableErr?.message ?? 'Không thể cập nhật bàn mới');
      }

      setSessions((prev) =>
        prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
      );
      setTables((prev) =>
        prev.map((t) => {
          if (t.id === oldTableData.id) return oldTableData;
          if (t.id === newTableData.id) return newTableData;
          return t;
        })
      );
      setActiveTableId(newTableData.id);
      setIsTransferModalOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi chuyển bàn');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 5. BÀN GIAO BÀN CHO ĐỒNG NGHIỆP (US-S04)
  // ==========================================================================
  async function handleHandoverTable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTableSession || !targetHandoverStaffId || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from('table_sessions')
        .update({ assigned_staff_id: targetHandoverStaffId })
        .eq('id', activeTableSession.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(
          error?.message ?? 'Không thể bàn giao bàn cho đồng nghiệp'
        );
      }

      setSessions((prev) => prev.map((s) => (s.id === data.id ? data : s)));
      setIsHandoverModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi bàn giao bàn'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 6. TRẢ LẠI BIA THỪA (MỤC 6.2 - TRỪ ORDER_ITEMS, CỘNG KHO & GHI LOG RETURN_BEER)
  // ==========================================================================
  async function handleReturnBeer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTableSession || !selectedReturnOrderItemId || isSubmitting) {
      return;
    }

    const targetOrderItem = activeTableOrders.find(
      (i) => i.id === selectedReturnOrderItemId
    );
    if (!targetOrderItem) {
      setErrorMessage('Không tìm thấy dòng bia/đồ uống cần trả.');
      return;
    }

    const returnQty = Math.floor(Number(returnBeerQuantity));
    if (
      Number.isNaN(returnQty) ||
      returnQty <= 0 ||
      returnQty > targetOrderItem.quantity
    ) {
      setErrorMessage(
        `Số lượng trả phải từ 1 đến ${targetOrderItem.quantity}.`
      );
      return;
    }

    const menuItem = menuMap.get(targetOrderItem.menu_item_id);
    const remainingQty = targetOrderItem.quantity - returnQty;
    const nowIso = new Date().toISOString();

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/orders/return-beer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderItemId: targetOrderItem.id, quantity: returnQty }),
      });
      const result = await response.json() as { error?: string; order: OrderItemRow };
      if (!response.ok) throw new Error(result.error || 'Khong tra duoc bia.');
      const updatedOrderItem = result.order;

      const nextItems = orderItems.map((i) =>
        i.id === updatedOrderItem.id ? updatedOrderItem : i
      );
      setOrderItems(nextItems);
      await recalculateSessionTotal(activeTableSession.id, nextItems);
      setIsReturnBeerModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi xử lý trả bia thừa'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 7. HỦY MÓN ĐANG CHỜ (QUEUED) - TUÂN THỦ NGHIÊM NGẶT RBAC MỤC 7
  // ==========================================================================
  async function handleCancelQueuedItem(item: OrderItemRow) {
    if (!activeTableSession || isSubmitting) return;

    // Theo Mục 7 & Mục 3.2 AGENTS.md: Nhân viên (staff) tuyệt đối không được hủy món COOKING hoặc SERVED
    if (item.status !== 'QUEUED' && currentStaffRole !== 'admin' && currentStaffRole !== 'operator') {
      setErrorMessage(
        'Nhân viên chỉ được hủy món chưa xong. Món đã làm xong hoặc đã mang ra cần nhờ chủ quán hủy.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('order_items')
        .update({
          status: 'CANCELLED',
          cancelled_at: nowIso,
          cancelled_by: validCurrentStaffId,
          cancel_reason:
            item.status === 'QUEUED'
              ? 'Khách đổi ý hủy món khi đang chờ bếp'
              : 'Admin hủy món',
        })
        .eq('id', item.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Không thể hủy món');
      }

      const nextItems = orderItems.map((i) => (i.id === data.id ? data : i));
      setOrderItems(nextItems);
      await recalculateSessionTotal(activeTableSession.id, nextItems);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi hủy món');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canConfirmActiveTableBill = useMemo(() => {
    if (!activeTableSession) return false;
    if ((currentStaffRole === 'admin' || currentStaffRole === 'operator')) return true;
    if (!activeTableSession.assigned_staff_id || !validCurrentStaffId) {
      return false;
    }
    return activeTableSession.assigned_staff_id === validCurrentStaffId;
  }, [activeTableSession, currentStaffRole, validCurrentStaffId]);

  // ==========================================================================
  // 8. CHỐT THANH TOÁN & ĐÓNG PHIÊN BÀN (CLOSED)
  // Chỉ Chủ quán (admin) hoặc Nhân viên phụ trách bàn đó mới được xác nhận
  // ==========================================================================
  async function handleCloseSessionBill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTable || !activeTableSession || isSubmitting) return;

    if (!canConfirmActiveTableBill) {
      setErrorMessage(
        'Chỉ Chủ quán hoặc Nhân viên phụ trách bàn này mới được xác nhận thanh toán & đóng bàn.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const validTotal = activeTableOrders
        .filter((i) => i.status !== 'CANCELLED')
        .reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

      const nowIso = new Date().toISOString();

      const { data: closedSession, error: sessionErr } = await supabase
        .from('table_sessions')
        .update({
          status: 'CLOSED',
          payment_method: checkoutPaymentMethod,
          total_amount: validTotal,
          closed_at: nowIso,
        })
        .eq('id', activeTableSession.id)
        .select('*')
        .single();

      if (sessionErr || !closedSession) {
        throw new Error(sessionErr?.message ?? 'Không thể chốt thanh toán');
      }

      const { data: freedTable, error: tableErr } = await supabase
        .from('tables')
        .update({
          status: 'AVAILABLE',
          current_session_id: null,
        })
        .eq('id', activeTable.id)
        .select('*')
        .single();

      if (tableErr || !freedTable) {
        throw new Error(tableErr?.message ?? 'Không thể giải phóng bàn');
      }

      setSessions((prev) =>
        prev.map((s) => (s.id === closedSession.id ? closedSession : s))
      );
      setTables((prev) =>
        prev.map((t) => (t.id === freedTable.id ? freedTable : t))
      );
      setIsCheckoutModalOpen(false);
      setActiveTableId(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi đóng phiên bàn'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const returnableDrinkItems = useMemo(() => {
    return activeTableOrders.filter((i) => {
      if (i.status === 'CANCELLED') return false;
      const m = menuMap.get(i.menu_item_id);
      return (
        i.station === 'BAR_INSTANT' ||
        m?.category === 'BEER' ||
        m?.category === 'DRINK'
      );
    });
  }, [activeTableOrders, menuMap]);

  return (
    <div className="min-h-screen bg-soft text-ink p-3 sm:p-6 space-y-6">
      {/* Top Bar Nhân viên chạy bàn */}
      <div role="status" className="border-b border-line px-4 py-2 text-sm text-amber-800">
        {live.connected ? 'Đã kết nối thông báo nội bộ' : 'Đang kết nối lại thông báo...'}
        {live.alerts.length > 0 && <span> - {live.alerts[0].message} ({live.alerts.length})</span>}
      </div>
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface border border-line rounded-2xl p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h1 className="text-xl font-bold text-amber-800">
              123Dzô • Phục vụ
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-emerald-500/15 text-emerald-800 border border-emerald-500/30">
              {staffRoleLabel[currentStaffRole]}
            </span>
          </div>
          <p className="text-xs text-muted-ink mt-0.5">
            Mở bàn sinh QR động, nhận chuông báo món chín & xử lý chuyển bàn / trả bia thừa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void playNotificationSound('/sounds/ting-ting.mp3')}
            className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-stone-200 text-xs font-semibold text-ink border border-line"
          >
            <Volume2 className="h-4 w-4 text-amber-800" />
            Kiểm tra chuông
          </button>

          {(currentStaffRole === 'admin' || currentStaffRole === 'operator') && (
            <>
              <Link
                href="/admin"
                className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-bold text-amber-800 transition-colors"
              >
                <BarChart3 className="h-4 w-4 text-amber-800" />
                Quản lý quán
              </Link>
              <Link
                href="/kitchen"
                className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-stone-200 border border-line text-xs font-semibold text-orange-800 transition-colors"
              >
                <ChefHat className="h-4 w-4 text-orange-800" />
                Bếp
              </Link>
            </>
          )}

          <div className="pl-1 flex items-center">
            {currentStaffRole === 'operator' && <Link href="/operator" className="min-h-12 flex items-center px-3 text-xs text-amber-800">Bàn giao hệ thống</Link>}
            <OnboardingGuideModal role={currentStaffRole} />
            <UserButton />
          </div>
        </div>
      </header>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-50/70 border border-red-500/50 text-red-800 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 text-red-800 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* KHAY THÔNG BÁO MÓN CHÍN / ĐỒ UỐNG CHỜ BƯNG (STATUS === 'READY') */}
      <section className="bg-surface border border-amber-500/40 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-amber-800 animate-bounce" />
            <h2 className="font-bold text-base sm:text-lg text-ink">
              Món chín & Đồ uống chờ bưng ra bàn ({readyOrderItems.length})
            </h2>
          </div>
        </div>

        {readyOrderItems.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-ink">
            Hiện không có món nào đang chờ bưng. Khi Bếp nấu xong hoặc khách gọi Bia, chuông sẽ tự động kêu!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {readyOrderItems.map((item) => {
              const menu = menuMap.get(item.menu_item_id);
              const session = sessionMap.get(item.session_id);
              const table = session?.table_id
                ? tableMap.get(session.table_id)
                : undefined;
              const waitMinutes = getElapsedMinutes(
                item.ready_at ?? item.created_at
              );
              const isOverdueFallback = waitMinutes >= 2;

              return (
                <div
                  key={item.id}
                  className={cn(
                    'p-3.5 rounded-xl border flex flex-col justify-between gap-3',
                    isOverdueFallback
                      ? 'bg-red-50/40 border-red-500/60'
                      : 'bg-soft border-amber-500/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-500 text-ink">
                        {table?.table_number ??
                          (session?.session_type === 'TAKEAWAY'
                            ? `Mang về (${session.customer_name ?? 'Khách'})`
                            : 'Bàn')}
                      </span>
                      <h3 className="font-bold text-base text-ink mt-1.5">
                        {item.quantity}x {menu?.name ?? 'Món gọi'}
                      </h3>
                      {item.note && (
                        <p className="text-xs text-amber-800 mt-0.5">
                          Ghi chú: {item.note}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                          isOverdueFallback
                            ? 'bg-red-500/20 text-red-800'
                            : 'bg-emerald-500/20 text-emerald-800'
                        )}
                      >
                        <Clock className="h-3 w-3" />
                        {waitMinutes === 0 ? 'Vừa xong' : `${waitMinutes} phút`}
                      </span>
                      {isOverdueFallback && (
                        <span className="block text-[10px] text-red-800 font-semibold mt-1">
                          Quá 2p - Cần hỗ trợ bưng!
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleServeOrderItem(item)}
                    className="min-h-12 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white font-bold text-sm transition-all"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {session?.session_type === 'TAKEAWAY' ? 'Đã giao khách' : 'Đã bưng lên bàn'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SƠ ĐỒ BÀN TRỰC QUAN & CHI TIẾT BÀN ĐANG CHỌN */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cột trái: Sơ đồ bàn */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-3.5 content-start">
          {[...tables].sort((a,b) => a.table_number.localeCompare(b.table_number, 'vi', {numeric:true})).map((table) => {
            const session = sessionByTableId.get(table.id);
            const isOccupied = table.status === 'OCCUPIED' && Boolean(session);
            const isRequestingBill = session?.status === 'REQUEST_BILL';
            const isSelected = activeTableId === table.id;
            const assignedStaff = session?.assigned_staff_id
              ? staffMap.get(session.assigned_staff_id)
              : undefined;
            const readyCount = session
              ? orderItems.filter(
                  (i) => i.session_id === session.id && i.status === 'READY'
                ).length
              : 0;

            return (
              <div
                key={table.id}
                onClick={() => {
                  if (isOccupied) {
                    setActiveTableId(table.id);
                  }
                }}
                className={cn(
                  'p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-all',
                  isOccupied ? 'cursor-pointer' : '',
                  isRequestingBill
                    ? 'bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/40'
                    : isOccupied
                    ? 'bg-amber-500/10 border-amber-500/40'
                    : 'bg-surface border-line',
                  isSelected ? 'ring-2 ring-amber-400' : ''
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <h3 className="text-lg font-extrabold text-ink">
                      {table.table_number}
                    </h3>
                    <span className="text-[11px] text-muted-ink">
                      {assignedStaff
                        ? `NV: ${assignedStaff.full_name}`
                        : isOccupied
                        ? 'Chưa gán NV'
                        : 'Bàn trống'}
                    </span>
                  </div>

                  {readyCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-ink">
                      {readyCount} món chín
                    </span>
                  )}
                </div>

                {isOccupied && session ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={cn(
                          'font-semibold',
                          isRequestingBill
                            ? 'text-rose-400 animate-pulse'
                            : 'text-amber-800'
                        )}
                      >
                        {isRequestingBill
                          ? '🔔 GỌI TÍNH TIỀN'
                          : 'Đang nhậu (ACTIVE)'}
                      </span>
                      <span className="font-bold text-sm text-ink">
                        {formatVND(session.total_amount)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQrModalSession(session);
                        }}
                        className="min-h-12 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-muted hover:bg-stone-200 text-xs font-semibold text-amber-800 border border-line"
                      >
                        <QrCode className="h-4 w-4" />
                        Mã QR
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTableId(table.id);
                        }}
                        className="min-h-12 inline-flex items-center justify-center px-2.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-ink"
                      >
                        Chi tiết
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleOpenTable(table)}
                    className="min-h-12 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition-colors"
                  >
                    <QrCode className="h-4 w-4" />
                    Mở bàn & Tạo QR
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Cột phải: Bảng điều khiển chi tiết của Bàn đang chọn */}
        <div className="lg:col-span-5 bg-surface border border-line rounded-2xl p-5 space-y-5 h-fit">
          {!activeTable || !activeTableSession ? (
            <div className="py-12 text-center text-muted-ink text-sm">
              Chọn một bàn đang mở ở bên trái để Order hộ khách, Chuyển bàn, Trả bia thừa hoặc Chốt thanh toán.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between border-b border-line pb-4">
                <div>
                  <span className="text-xs text-amber-800 font-semibold">
                    Đang quản lý phiên nhậu
                  </span>
                  <h2 className="text-2xl font-extrabold text-ink">
                    {activeTable.table_number}
                  </h2>
                  <p className="text-xs text-muted-ink mt-0.5">
                    Bàn đang phục vụ
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xs text-muted-ink block">
                    Tạm tính hiện tại
                  </span>
                  <span className="text-2xl font-black text-amber-800">
                    {formatVND(activeTableSession.total_amount)}
                  </span>
                </div>
              </div>

              {/* Cụm nút nghiệp vụ chính (Cao tối thiểu 48px) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setQrModalSession(activeTableSession)}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 border border-amber-500/30 text-xs font-bold"
                >
                  <QrCode className="h-4 w-4" />
                  Hiện QR Bàn
                </button>

                <button
                  type="button"
                  onClick={() => setIsOrderModalOpen(true)}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                >
                  <PlusCircle className="h-4 w-4" />
                  Order hộ khách
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const firstDrink = returnableDrinkItems[0];
                    setSelectedReturnOrderItemId(firstDrink?.id ?? '');
                    setReturnBeerQuantity('1');
                    setIsReturnBeerModalOpen(true);
                  }}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-800 border border-sky-500/30 text-xs font-bold"
                >
                  <RotateCcw className="h-4 w-4" />
                  Trả bia thừa
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTargetTransferTableId(
                      availableTablesForTransfer[0]?.id ?? ''
                    );
                    setIsTransferModalOpen(true);
                  }}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-muted hover:bg-stone-200 text-ink border border-line text-xs font-semibold"
                >
                  <ArrowRightLeft className="h-4 w-4 text-amber-800" />
                  Chuyển bàn
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTargetHandoverStaffId(
                      activeTableSession.assigned_staff_id ??
                        staffProfiles[0]?.id ??
                        ''
                    );
                    setIsHandoverModalOpen(true);
                  }}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-muted hover:bg-stone-200 text-ink border border-line text-xs font-semibold"
                >
                  <UserCheck className="h-4 w-4 text-emerald-800" />
                  Bàn giao bàn
                </button>

                <button
                  type="button"
                  disabled={!canConfirmActiveTableBill}
                  title={
                    canConfirmActiveTableBill
                      ? 'Xác nhận thanh toán & Đóng bàn'
                      : 'Chỉ Chủ quán hoặc Nhân viên phụ trách bàn này mới được xác nhận thanh toán'
                  }
                  onClick={() => setIsCheckoutModalOpen(true)}
                  className={cn(
                    'min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-extrabold',
                    canConfirmActiveTableBill
                      ? 'bg-amber-500 hover:bg-amber-400 text-ink'
                      : 'bg-muted text-muted-ink cursor-not-allowed'
                  )}
                >
                  <Receipt className="h-4 w-4" />
                  Chốt & Thanh toán
                </button>
              </div>

              {/* Danh sách món đã gọi của bàn */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-ink">
                  Danh sách món của bàn ({activeTableOrders.length})
                </h3>

                <div className="divide-y divide-line/80 max-h-96 overflow-y-auto pr-1">
                  {activeTableOrders.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-ink">
                      Bàn chưa gọi món nào.
                    </p>
                  ) : (
                    activeTableOrders.map((oi) => {
                      const menu = menuMap.get(oi.menu_item_id);
                      const canCancel =
                        oi.status === 'QUEUED' ||
                        ((currentStaffRole === 'admin' || currentStaffRole === 'operator') &&
                          oi.status !== 'CANCELLED');

                      return (
                        <div
                          key={oi.id}
                          className="py-3 flex items-center justify-between gap-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-ink flex items-center gap-2">
                              <span>
                                {oi.quantity}x {menu?.name ?? 'Món ăn'}
                              </span>
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-full text-[10px] font-bold',
                                  oi.status === 'SERVED'
                                    ? 'bg-muted text-ink'
                                    : oi.status === 'READY'
                                    ? 'bg-emerald-500/20 text-emerald-800'
                                    : oi.status === 'COOKING'
                                    ? 'bg-orange-500/20 text-orange-800'
                                    : oi.status === 'CANCELLED'
                                    ? 'bg-red-500/20 text-red-800 line-through'
                                    : 'bg-amber-500/20 text-amber-800'
                                )}
                              >
                                {orderStatusLabel[oi.status]}
                              </span>
                            </div>
                            <div className="text-xs text-muted-ink">
                              {formatVND(oi.unit_price * oi.quantity)}
                              {oi.note ? ` • Ghi chú: ${oi.note}` : ''}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {oi.status === 'READY' && (
                              <button
                                type="button"
                                onClick={() => handleServeOrderItem(oi)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                              >
                                Bưng ngay
                              </button>
                            )}
                            {canCancel && (
                              <button
                                type="button"
                                onClick={() => handleCancelQueuedItem(oi)}
                                title="Hủy món chưa xong"
                                className="p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-800"
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MODAL HIỂN THỊ MÃ QR ĐỘNG THẬT TO CHO KHÁCH QUÉT (MỤC 3.1) */}
      {/* ==================================================================== */}
      {qrModalSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-amber-500/50 rounded-3xl max-w-md w-full p-6 text-center space-y-5">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-800 text-xs font-bold">
                Mã QR Động Theo Phiên
              </span>
              <button
                type="button"
                onClick={() => setQrModalSession(null)}
                className="p-1 text-muted-ink hover:text-ink"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div>
              <h3 className="text-2xl font-black text-ink">
                {qrModalSession.table_id
                  ? tableMap.get(qrModalSession.table_id)?.table_number ?? 'Bàn'
                  : 'Phiên gọi món'}
              </h3>
              <p className="text-xs text-muted-ink mt-1">
                Đưa màn hình này cho khách quét để vào thẳng thực đơn của bàn
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl inline-block mx-auto shadow-xl">
              <QRCodeSVG
                value={`${originUrl}/customer/order/${qrModalSession.session_token}`}
                size={256}
                level="H"
                includeMargin={false}
              />
            </div>

            <div className="space-y-2">
              <p className="font-mono text-xs text-muted-ink break-all">
                {originUrl}/customer/order/{qrModalSession.session_token}
              </p>
              <a
                href={`/customer/order/${qrModalSession.session_token}`}
                target="_blank"
                rel="noreferrer"
                className="min-h-12 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-muted hover:bg-stone-200 text-amber-800 font-bold text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                Mở trực tiếp trang gọi món của bàn này
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL ORDER HỘ KHÁCH */}
      {/* ==================================================================== */}
      {isOrderModalOpen && activeTable && activeTableSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                Order hộ khách • {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsOrderModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <input
              type="text"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Tìm nhanh mồi nhậu, bia, nước ngọt..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
            />

            <div className="flex-1 overflow-y-auto divide-y divide-line space-y-2 pr-1">
              {menuItems
                .filter(
                  (m) =>
                    m.is_available &&
                    m.name.toLowerCase().includes(orderSearch.toLowerCase())
                )
                .map((m) => (
                  <div
                    key={m.id}
                    className="pt-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div>
                      <div className="font-bold text-sm text-ink flex items-center gap-2">
                        <span>{m.name}</span>
                        <span className="text-xs font-semibold text-amber-800">
                          {formatVND(m.price)}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-ink">
                          {m.station === 'BAR_INSTANT' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-800">
                              <Beer className="h-3 w-3" /> Lấy ngay
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-orange-800">
                              <UtensilsCrossed className="h-3 w-3" /> Bếp nấu
                            </span>
                          )}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={selectedMenuNote[m.id] ?? ''}
                        onChange={(e) =>
                          setSelectedMenuNote((prev) => ({
                            ...prev,
                            [m.id]: e.target.value,
                          }))
                        }
                        placeholder="Ghi chú (ít cay, không hành, ướp lạnh...)"
                        className="mt-1 w-full sm:w-64 px-2.5 py-1 rounded bg-soft border border-line text-xs text-ink"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={selectedMenuQty[m.id] ?? 1}
                        onChange={(e) =>
                          setSelectedMenuQty((prev) => ({
                            ...prev,
                            [m.id]: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="w-16 px-2.5 py-2 rounded-lg bg-soft border border-line text-center text-sm font-bold text-ink"
                      />
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleStaffAddOrderItem(m)}
                        className="min-h-12 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-ink font-bold text-xs"
                      >
                        + Thêm vào bàn
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL CHUYỂN BÀN (MỤC 6.3) */}
      {/* ==================================================================== */}
      {isTransferModalOpen && activeTable && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                Chuyển bàn từ {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleTransferTable} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1.5">
                  Chọn bàn trống cần chuyển tới *
                </label>
                <select
                  required
                  value={targetTransferTableId}
                  onChange={(e) => setTargetTransferTableId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                >
                  {availableTablesForTransfer.length === 0 ? (
                    <option value="">-- Không còn bàn trống --</option>
                  ) : (
                    availableTablesForTransfer.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.table_number}
                      </option>
                    ))
                  )}
                </select>
                <p className="text-xs text-muted-ink mt-2">
                  Mã QR phiên của khách vẫn giữ nguyên hiệu lực, các món đang nấu trong Bếp sẽ tự động đổi sang số bàn mới.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="min-h-12 px-4 py-2 rounded-xl bg-muted text-ink text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmitting || availableTablesForTransfer.length === 0
                  }
                  className="min-h-12 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-ink font-bold text-sm"
                >
                  Xác nhận chuyển bàn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL BÀN GIAO BÀN CHO ĐỒNG NGHIỆP */}
      {/* ==================================================================== */}
      {isHandoverModalOpen && activeTable && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                Bàn giao {activeTable.table_number} cho đồng nghiệp
              </h3>
              <button
                type="button"
                onClick={() => setIsHandoverModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleHandoverTable} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1.5">
                  Chọn nhân viên nhận bàn *
                </label>
                <select
                  required
                  value={targetHandoverStaffId}
                  onChange={(e) => setTargetHandoverStaffId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                >
                  {staffProfiles
                    .filter(
                      (s) =>
                        s.is_active &&
                        (s.role === 'staff' || s.role === 'admin' || s.role === 'operator')
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} ({staffRoleLabel[s.role]})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  className="min-h-12 px-4 py-2 rounded-xl bg-muted text-ink text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-12 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm"
                >
                  Xác nhận bàn giao
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL TRẢ LẠI BIA THỪA (MỤC 6.2) */}
      {/* ==================================================================== */}
      {isReturnBeerModalOpen && activeTable && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                Trả lại bia / đồ uống thừa • {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsReturnBeerModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {returnableDrinkItems.length === 0 ? (
              <p className="text-sm text-muted-ink py-4">
                Bàn này chưa có dòng bia hoặc đồ uống nào để trả lại.
              </p>
            ) : (
              <form onSubmit={handleReturnBeer} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1.5">
                    Chọn dòng bia / đồ uống trong hóa đơn *
                  </label>
                  <select
                    required
                    value={selectedReturnOrderItemId}
                    onChange={(e) =>
                      setSelectedReturnOrderItemId(e.target.value)
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                  >
                    {returnableDrinkItems.map((item) => {
                      const m = menuMap.get(item.menu_item_id);
                      return (
                        <option key={item.id} value={item.id}>
                          {m?.name ?? 'Đồ uống'} (Đã gọi: {item.quantity})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1.5">
                    Số lượng khách trả lại *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={returnBeerQuantity}
                    onChange={(e) => setReturnBeerQuantity(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                  />
                  <p className="text-xs text-muted-ink mt-1.5">
                    Bia trả lại được trừ khỏi hóa đơn và cộng lại vào kho.
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsReturnBeerModalOpen(false)}
                    className="min-h-12 px-4 py-2 rounded-xl bg-muted text-ink text-sm"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="min-h-12 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-ink font-bold text-sm"
                  >
                    Hoàn trả bia & Cập nhật hóa đơn
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL CHỐT THANH TOÁN & ĐÓNG PHIÊN BÀN */}
      {/* ==================================================================== */}
      {isCheckoutModalOpen && activeTable && activeTableSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                Chốt thanh toán • {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsCheckoutModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCloseSessionBill} className="space-y-4">
              <div className="p-4 rounded-xl bg-soft border border-line flex items-center justify-between">
                <span className="text-sm text-muted-ink">Tổng thanh toán:</span>
                <span className="text-2xl font-black text-amber-800">
                  {formatVND(activeTableSession.total_amount)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1.5">
                  Phương thức thanh toán *
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCheckoutPaymentMethod('CASH')}
                    className={cn(
                      'min-h-12 p-3 rounded-xl border text-sm font-bold',
                      checkoutPaymentMethod === 'CASH'
                        ? 'bg-amber-500 text-ink border-amber-500'
                        : 'bg-soft text-ink border-line'
                    )}
                  >
                    Tiền mặt
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckoutPaymentMethod('VIETQR')}
                    className={cn(
                      'min-h-12 p-3 rounded-xl border text-sm font-bold',
                      checkoutPaymentMethod === 'VIETQR'
                        ? 'bg-amber-500 text-ink border-amber-500'
                        : 'bg-soft text-ink border-line'
                    )}
                  >
                    Chuyển khoản
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCheckoutModalOpen(false)}
                  className="min-h-12 px-4 py-2 rounded-xl bg-muted text-ink text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-12 px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm"
                >
                  Xác nhận đã thu tiền & Đóng bàn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
