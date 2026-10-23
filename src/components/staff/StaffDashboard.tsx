'use client';
import { PushControls } from '@/components/ui/PushControls';
import { SoundControls } from '@/components/ui/SoundControls';

import type { PublicMenuItem as MenuItemRow, StaffDirectoryEntry as StaffProfileRow, StaffSession as TableSessionRow } from '@/lib/data/read-contracts';
import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { pendingBeerReturn, submitBeerReturn, acknowledgeBeerReturn } from '@/lib/returns/client';
import { pendingSessionAction, submitSessionAction, acknowledgeSessionAction, SessionActionError } from '@/lib/sessions/client';
import type { SessionCommand } from '@/lib/sessions/contracts';
import { useSessionBill } from '@/lib/sessions/use-session-bill';
import { useItemActions } from '@/lib/item-actions/use-item-actions';
import { ItemActionFeedback } from '@/components/staff/ItemActionFeedback';
import { UserButton } from '@clerk/nextjs';
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
  X,
  Clock,
  ExternalLink,
  BarChart3,
  ChefHat,
} from 'lucide-react';
import { acknowledgeOrder, pendingOrder, submitOrder, OrderSubmissionError } from '@/lib/orders/client';
import type { DisplayOrderItem as OrderItemRow } from '@/lib/orders/contracts';
import { useServerRefresh } from '@/lib/data/use-server-refresh';
import { useSnapshotSound } from '@/lib/data/use-snapshot-sound';
import {
  formatVND,
  getElapsedMinutes,
  cn,
} from '@/lib/utils';
import type {
  IngredientRow,
  PaymentMethod,
  StaffRole,
  TableRow,
  ZoneRow,
} from '@/types/database.types';

interface StaffDashboardProps {
  initialZones: ZoneRow[];
  initialTables: TableRow[];
  initialSessions: TableSessionRow[];
  initialOrderItems: OrderItemRow[];
  menuItems: MenuItemRow[];
  initialIngredients?: IngredientRow[];
  staffProfiles: StaffProfileRow[];
  currentStaffId: string | null;
  currentStaffRole: StaffRole;
}

const QUEUED_CANCEL_REASON = 'Khách đổi ý khi món đang chờ bếp';
export function StaffDashboard({
  initialZones,
  initialTables,
  initialSessions,
  initialOrderItems,
  menuItems,
  staffProfiles,
  currentStaffId,
  currentStaffRole,
}: StaffDashboardProps) {
  const router = useRouter();
  const itemActions = useItemActions(currentStaffId);
  const [cancelTarget, setCancelTarget] = useState<OrderItemRow | null>(null);
  const [itemCancelReason, setItemCancelReason] = useState('');
  useEffect(() => { if (itemActions.pending) setCancelTarget(null); }, [itemActions.pending]);
  const returnSubmitLock = useRef(false);
  const [unconfirmedReturn, setUnconfirmedReturn] = useState(false);
  const [returnJournalBlocked, setReturnJournalBlocked] = useState(false);
  const [returnUnusedConfirmed, setReturnUnusedConfirmed] = useState(false);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const sessionActionLock = useRef(false);
  const [sessionActionPending, setSessionActionPending] = useState(false);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);

  const [zones, setZones] = useState<ZoneRow[]>(initialZones);
  useEffect(() => { setZones(initialZones); }, [initialZones]);
  const [tables, setTables] = useState<TableRow[]>(initialTables);
  const [sessions, setSessions] = useState<TableSessionRow[]>(initialSessions);
  const [orderItems, setOrderItems] =
    useState<OrderItemRow[]>(initialOrderItems);

  const [selectedZoneId, setSelectedZoneId] = useState<string>('ALL');
  const [workScope, setWorkScope] = useState<'MY'|'ALL'>(currentStaffRole==='admin'?'ALL':'MY');
  const [servingItemId,setServingItemId]=useState<string|null>(null);
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

  const [isSubmittingOther, setIsSubmitting] = useState<boolean>(false);
  const isSubmitting = isSubmittingOther || itemActions.busy;
  const orderSubmitLock=useRef(false);
  const [unconfirmedStaffOrder,setUnconfirmedStaffOrder]=useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [originUrl, setOriginUrl] = useState<string>('');

  useEffect(() => {
    if (!currentStaffId) return;
    try { setSessionActionPending(pendingSessionAction({ mode: 'staff', identity: currentStaffId }) !== null); }
    catch (error) { setSessionActionPending(true); setErrorMessage(error instanceof Error ? error.message : 'Không đọc được thao tác bàn.'); }
  }, [currentStaffId]);
  useEffect(() => {
    const opened = initialSessions.find((row) => row.id === openedSessionId);
    if (opened) { setQrModalSession(opened); setOpenedSessionId(null); }
  }, [initialSessions, openedSessionId]);

  async function runSessionCommand(command?: SessionCommand) {
    if (!currentStaffId || sessionActionLock.current || isSubmitting || unconfirmedReturn || returnJournalBlocked ||
      (command && (sessionActionPending || itemActions.blocked))) return;
    sessionActionLock.current = true;
    setIsSubmitting(true); setErrorMessage(null);
    const scope = { mode: 'staff' as const, identity: currentStaffId };
    try {
      const { result } = await submitSessionAction(scope, command);
      acknowledgeSessionAction(scope, result.operationId);
      if (result.action === 'OPEN') setOpenedSessionId(result.sessionId);
      setActiveTableId(result.action === 'CLOSE' ? null : result.tableId);
      setIsTransferModalOpen(false); setIsHandoverModalOpen(false); setIsCheckoutModalOpen(false);
      setPaymentReceived(false); router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Chưa xác nhận thao tác bàn.');
      if (error instanceof SessionActionError && error.totalAmount !== undefined && command && 'sessionId' in command.input) {
        const id = command.input.sessionId, total = error.totalAmount;
        setSessions((previous) => previous.map((row) => row.id === id ? { ...row, total_amount: total } : row));
        setPaymentReceived(false);
      } else router.refresh();
    } finally {
      try { setSessionActionPending(pendingSessionAction(scope) !== null); } catch { setSessionActionPending(true); }
      sessionActionLock.current = false; setIsSubmitting(false);
    }
  }

  useEffect(() => { setOrderItems(initialOrderItems); }, [initialOrderItems]);
  useEffect(() => { setSessions(initialSessions); }, [initialSessions]);
  useEffect(() => { setTables(initialTables); }, [initialTables]);
  useEffect(() => {
    setUnconfirmedReturn(false);
    setReturnJournalBlocked(false);
    if (!currentStaffId) { setReturnJournalBlocked(true); return; }
    try { setUnconfirmedReturn(pendingBeerReturn(currentStaffId) !== null); }
    catch (error) {
      setReturnJournalBlocked(true);
      setErrorMessage(error instanceof Error ? error.message : 'Không đọc được lượt trả bia.');
    }
  }, [currentStaffId]);

  async function runBeerReturn() {
    if (!currentStaffId || returnSubmitLock.current || returnJournalBlocked || isSubmitting) return;
    returnSubmitLock.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    setReturnNotice(null);
    try {
      const item = orderItems.find((row) => row.id === selectedReturnOrderItemId);
      if (!unconfirmedReturn && (!activeTableSession || !item || !returnUnusedConfirmed)) {
        throw new Error('Chọn dòng bia và xác nhận hàng còn nguyên, chưa sử dụng.');
      }
      const result = await submitBeerReturn(currentStaffId, unconfirmedReturn ? undefined : {
        sessionId: activeTableSession!.id, orderItemId: item!.id, quantity: Number(returnBeerQuantity),
        expectedQuantity: item!.quantity, confirmedUnused: true,
      });
      acknowledgeBeerReturn(currentStaffId, result.operationId);
      setIsReturnBeerModalOpen(false);
      setReturnUnusedConfirmed(false);
      setReturnNotice('Đã xác nhận trả bia. Số lượng và hóa đơn được tải lại từ quán.');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Chưa xác nhận được trả bia.');
      // Refresh expected quantity after a confirmed rejection, never apply a replay snapshot locally.
      router.refresh();
    } finally {
      try {
        const pending = pendingBeerReturn(currentStaffId) !== null;
        setUnconfirmedReturn(pending);
        if (pending) setIsReturnBeerModalOpen(false);
      } catch { setReturnJournalBlocked(true); }
      returnSubmitLock.current = false;
      setIsSubmitting(false);
    }
  }

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

  useServerRefresh(15000, currentStaffId);
  useSnapshotSound([
    ...initialOrderItems.filter(item => item.quantity > 0 && item.status === 'READY' && initialSessions.some(session => session.id === item.session_id &&
      (session.status === 'ACTIVE' || session.status === 'REQUEST_BILL') && session.assigned_staff_id === currentStaffId)).map(item => `ready:${item.id}`),
    ...initialSessions.filter(session => session.status === 'REQUEST_BILL' && session.assigned_staff_id === currentStaffId).map(session => `bill:${session.id}`),
  ]);

  // Danh sách các món đã chín / đồ uống lấy ngay (status === 'READY') đang chờ bưng
  const readyOrderItems = useMemo(() => {
    return orderItems
      .filter((item) => {
        const session=sessionMap.get(item.session_id);
        return item.quantity>0&&item.status==='READY'&&item.ready_at&&session&&
          (session.status==='ACTIVE'||session.status==='REQUEST_BILL')&&(workScope==='ALL'||session.assigned_staff_id===currentStaffId);
      })
      .sort((a, b) => {
        const timeA = new Date(a.ready_at ?? a.created_at).getTime();
        const timeB = new Date(b.ready_at ?? b.created_at).getTime();
        return timeA - timeB;
      });
  }, [orderItems, sessionMap, workScope, currentStaffId]);

  const filteredTables = useMemo(() => {
    if (selectedZoneId === 'ALL') return tables;
    return tables.filter((t) => t.zone_id === selectedZoneId);
  }, [tables, selectedZoneId]);

  const activeTable = activeTableId ? tableMap.get(activeTableId) ?? null : null;
  const activeTableSession = activeTable
    ? sessionByTableId.get(activeTable.id) ?? null
    : null;
  const billDetail = useSessionBill(activeTableSession?.id ?? null, initialOrderItems);
  useEffect(() => { setPaymentReceived(false); }, [activeTableSession?.id, activeTableSession?.total_amount, checkoutPaymentMethod]);
  useEffect(() => {
    const bill = billDetail.data;
    if (!bill) return;
    setOrderItems((previous) => [...previous.filter((row) => row.session_id !== bill.sessionId), ...bill.items]);
    setSessions((previous) => previous.map((row) => row.id === bill.sessionId ? { ...row, total_amount: bill.totalAmount, status: bill.status, closed_at: bill.closedAt } : row));
  }, [billDetail.data]);

  useEffect(()=>{
    if (!activeTableSession?.id || !currentStaffId) { setUnconfirmedStaffOrder(false); return; }
    try {
      setUnconfirmedStaffOrder(pendingOrder({mode:'staff',identity:currentStaffId,sessionId:activeTableSession.id})!==null);
    } catch(error) {
      setUnconfirmedStaffOrder(true);
      setErrorMessage(error instanceof Error?error.message:'Không khôi phục được lượt gọi hộ.');
    }
  },[activeTableSession?.id,currentStaffId]);

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
    await runSessionCommand({action:'OPEN',input:{tableId:table.id}});
  }

  // ==========================================================================
  // 2. BẤM "ĐÃ BƯNG LÊN BÀN" (CẬP NHẬT SERVED_AT & SERVED_BY_STAFF_ID - MỤC 2.2 & 3.3)
  // ==========================================================================
  async function handleServeOrderItem(item: OrderItemRow) {
    if (isSubmitting || itemActions.blocked || item.quantity <= 0 || item.status !== 'READY' || unconfirmedReturn || sessionActionPending) return;
    setServingItemId(item.id);
    try {await itemActions.run({action:'SERVE',reason:'',items:[{id:item.id,sessionId:item.session_id,expectedStatus:'READY',expectedQuantity:item.quantity}]});}
    finally {setServingItemId(null);}
  }

  // ==========================================================================
  // 3. ORDER HỘ KHÁCH (SNAPSHOT PRICE & BAR_INSTANT -> READY NGAY)
  // ==========================================================================
  async function handleStaffAddOrderItem(menuItem?: MenuItemRow) {
    if (!activeTableSession || !currentStaffId || isSubmitting || orderSubmitLock.current || unconfirmedReturn || itemActions.blocked || sessionActionPending || sessionActionLock.current) return;
    if (unconfirmedStaffOrder && menuItem) return;
    if (!unconfirmedStaffOrder && !menuItem) return;
    const scope={mode:'staff' as const,identity:currentStaffId,sessionId:activeTableSession.id};
    orderSubmitLock.current=true;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const {result,submittedLines,recovered}=await submitOrder(scope,menuItem?[{menu_item_id:menuItem.id,quantity:Math.max(1,selectedMenuQty[menuItem.id]??1),
        note:selectedMenuNote[menuItem.id]??'',expected_price:menuItem.price}]:[]);
      setOrderItems((previous)=>{
        const existing=new Set(previous.map((item)=>item.id));
        return [...result.items.filter((item)=>!existing.has(item.id)),...previous];
      });
      // Session total is calculated by the RPC, never by a truncated browser list.
      if (!recovered) setSessions((previous)=>previous.map((item)=>item.id===result.sessionId?{...item,total_amount:result.totalAmount}:item));
      acknowledgeOrder(scope,result.operationId);
      setUnconfirmedStaffOrder(false);
      setSelectedMenuQty((previous)=>{
        const next={...previous};
        submittedLines.forEach((line)=>{next[line.menu_item_id]=1;});
        return next;
      });
      setSelectedMenuNote((previous)=>{
        const next={...previous};
        submittedLines.forEach((line)=>{next[line.menu_item_id]='';});
        return next;
      });
    } catch(error) {
      try { setUnconfirmedStaffOrder(pendingOrder(scope)!==null); } catch { setUnconfirmedStaffOrder(true); }
      setErrorMessage(error instanceof OrderSubmissionError && error.code==='PRICE_CHANGED'
        ? 'Giá món đã đổi. Vui lòng tải lại trang và kiểm tra trước khi gọi hộ.'
        : error instanceof Error?error.message:'Chưa xác nhận được lượt gọi hộ.');
    } finally {
      orderSubmitLock.current=false;
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 4. CHUYỂN BÀN (MỤC 6.3 - GIỮ NGUYÊN SESSION_TOKEN & CẬP NHẬT TABLE_ID)
  // ==========================================================================
  async function handleTransferTable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTableSession || !activeTable || !targetTransferTableId) return;
    await runSessionCommand({action:'TRANSFER',input:{sessionId:activeTableSession.id,expectedTableId:activeTable.id,targetTableId:targetTransferTableId}});
  }

  // ==========================================================================
  // 5. BÀN GIAO BÀN CHO ĐỒNG NGHIỆP (US-S04)
  // ==========================================================================
  async function handleHandoverTable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTableSession || !targetHandoverStaffId) return;
    await runSessionCommand({action:'HANDOVER',input:{sessionId:activeTableSession.id,expectedAssignedStaffId:activeTableSession.assigned_staff_id,assignedStaffId:targetHandoverStaffId}});
  }

  // ==========================================================================
  // 6. TRẢ LẠI BIA THỪA (MỤC 6.2 - TRỪ ORDER_ITEMS, CỘNG KHO & GHI LOG RETURN_BEER)
  // ==========================================================================
  async function handleReturnBeer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await runBeerReturn();
  }

  // ==========================================================================
  // 7. HỦY MÓN ĐANG CHỜ (QUEUED) - TUÂN THỦ NGHIÊM NGẶT RBAC MỤC 7
  // ==========================================================================
  async function handleCancelQueuedItem(item: OrderItemRow) {
    if (isSubmitting || itemActions.blocked || item.quantity <= 0 || item.status === 'CANCELLED' || unconfirmedReturn || sessionActionPending) return;
    if (item.status !== 'QUEUED') {
      if (currentStaffRole === 'admin') { setCancelTarget(item); setItemCancelReason(''); }
      return;
    }
    await itemActions.run({action:'CANCEL',reason:QUEUED_CANCEL_REASON,items:[{id:item.id,sessionId:item.session_id,expectedStatus:'QUEUED',expectedQuantity:item.quantity}]});
  }

  async function confirmAdvancedCancel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const item=cancelTarget;
    if (!item || item.status==='CANCELLED' || isSubmitting || !itemCancelReason.trim()) return;
    if (await itemActions.run({action:'CANCEL',reason:itemCancelReason,items:[{id:item.id,sessionId:item.session_id,expectedStatus:item.status,expectedQuantity:item.quantity}]})) setCancelTarget(null);
  }

  // ==========================================================================
  // 8. CHỐT THANH TOÁN & ĐÓNG PHIÊN BÀN (CLOSED)
  // ==========================================================================
  async function handleCloseSessionBill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeTableSession || !paymentReceived || !billDetail.data || billDetail.loading || billDetail.error) return;
    await runSessionCommand({action:'CLOSE',input:{sessionId:activeTableSession.id,paymentMethod:checkoutPaymentMethod,expectedTotal:activeTableSession.total_amount,confirmedReceived:true}});
  }

  const returnableDrinkItems = useMemo(() => {
    return activeTableOrders.filter((i) => {
      if (i.quantity <= 0 || !['READY','SERVED'].includes(i.status)) return false;
      const m = menuMap.get(i.menu_item_id);
      return (
        i.station === 'BAR_INSTANT' &&
        (m?.category === 'BEER' || m?.category === 'DRINK')
      );
    });
  }, [activeTableOrders, menuMap]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-3 sm:p-6 space-y-6">
      {/* Top Bar Nhân viên chạy bàn */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h1 className="text-xl font-bold text-amber-400">
              123Dzô • Việc cần làm
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Role: {currentStaffRole}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Mở bàn sinh QR động, nhận chuông báo món chín & xử lý chuyển bàn / trả bia thừa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/staff/payments" className="min-h-12 inline-flex items-center px-4 rounded-xl border border-amber-500 text-amber-200 font-bold">Xác nhận thu tiền</Link>
          <SoundControls />
          {currentStaffId && <PushControls key={currentStaffId} userId={currentStaffId} />}

          {currentStaffRole === 'admin' && (
            <>
              <Link
                href="/admin"
                className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-bold text-amber-300 transition-colors"
              >
                <BarChart3 className="h-4 w-4 text-amber-400" />
                Về Quản Trị (/admin)
              </Link>
              <Link
                href="/kitchen"
                className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-orange-300 transition-colors"
              >
                <ChefHat className="h-4 w-4 text-orange-400" />
                Bếp KDS (/kitchen)
              </Link>
            </>
          )}

          <div className="pl-1 flex items-center">
            <UserButton />
          </div>
        </div>
      </header>

      <ItemActionFeedback pending={itemActions.pending} busy={itemActions.busy} error={itemActions.error} recover={() => itemActions.run()} />
      {cancelTarget && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-label="Hủy món đã chuẩn bị" className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md space-y-4">
          <h3 className="text-lg font-bold">Lý do hủy món đã chuẩn bị</h3>
          <form onSubmit={confirmAdvancedCancel} className="space-y-4">
            <fieldset disabled={itemActions.blocked} className="space-y-4">
              <label className="block">Lý do hủy *
                <textarea required maxLength={500} value={itemCancelReason} onChange={(event) => setItemCancelReason(event.target.value)} className="w-full rounded-lg p-3 bg-zinc-800" />
              </label>
              {itemActions.error && <p role="alert" className="text-red-300">{itemActions.error}</p>}
              <p className="text-sm text-zinc-400">Hủy món không tự hoàn kho. Bia còn nguyên cần dùng chức năng trả bia.</p>
              <button type="button" onClick={() => setCancelTarget(null)} className="min-h-12 px-4">Quay lại</button>
              <button type="submit" disabled={!itemCancelReason.trim()} className="min-h-12 px-4 rounded-lg bg-red-700">Xác nhận hủy món</button>
            </fieldset>
          </form>
        </div>
      </div>}
      {billDetail.loading && <p role="status">Đang tải đầy đủ món của bàn...</p>}
      {billDetail.error && <p role="alert" className="text-red-300">{billDetail.error}</p>}
      {sessionActionPending && (
        <div role="status" className="rounded-xl border border-amber-500 p-4 space-y-2">
          <p>Có thao tác bàn chưa xác nhận. Kiểm tra trước khi thực hiện tiếp.</p>
          <button type="button" disabled={isSubmitting} onClick={() => void runSessionCommand()}
            className="min-h-12 px-4 rounded-lg bg-amber-500 text-zinc-950 disabled:opacity-50">Kiểm tra thao tác bàn vừa gửi</button>
        </div>
      )}
      {unconfirmedReturn && (
        <div role="status" className="rounded-xl border border-amber-500 p-4 space-y-2">
          <p>Có lượt trả bia chưa xác nhận. Kiểm tra lượt này trước khi thao tác tiếp.</p>
          <button type="button" disabled={isSubmitting} onClick={() => void runBeerReturn()}
            className="min-h-12 px-4 rounded-lg bg-amber-500 text-zinc-950 disabled:opacity-50">
            {isSubmitting ? 'Đang kiểm tra...' : 'Kiểm tra lượt trả bia vừa gửi'}
          </button>
        </div>
      )}
      {returnNotice && <p role="status" className="text-emerald-400">{returnNotice}</p>}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 text-red-300 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" aria-label="Phạm vi công việc">
        <button type="button" aria-pressed={workScope==='MY'} onClick={()=>setWorkScope('MY')} className="min-h-12 px-4 rounded-xl border border-zinc-600">Bàn của tôi</button>
        <button type="button" aria-pressed={workScope==='ALL'} onClick={()=>setWorkScope('ALL')} className="min-h-12 px-4 rounded-xl border border-zinc-600">Hỗ trợ toàn quán</button>
      </div>
      {/* KHAY THÔNG BÁO MÓN CHÍN / ĐỒ UỐNG CHỜ BƯNG (STATUS === 'READY') */}
      <section className="bg-zinc-900 border border-amber-500/40 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-amber-400 animate-bounce" />
            <h2 className="font-bold text-base sm:text-lg text-zinc-100">
              Món chín & Đồ uống chờ bưng ra bàn ({readyOrderItems.length})
            </h2>
          </div>
        </div>

        {readyOrderItems.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-500">
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
                      ? 'bg-red-950/40 border-red-500/60'
                      : 'bg-zinc-950 border-amber-500/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-500 text-zinc-950">
                        {table?.table_number ??
                          (session?.session_type === 'TAKEAWAY'
                            ? `Mang về (${session.customer_name ?? 'Khách'})`
                            : 'Bàn')}
                      </span>
                      <h3 className="font-bold text-base text-zinc-100 mt-1.5">
                        {item.quantity}x {menu?.name ?? 'Món gọi'}
                      </h3>
                      {item.note && (
                        <p className="text-xs text-amber-300 mt-0.5">
                          Ghi chú: {item.note}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                          isOverdueFallback
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        )}
                      >
                        <Clock className="h-3 w-3" />
                        {waitMinutes === 0 ? 'Vừa xong' : `${waitMinutes} phút`}
                      </span>
                      {isOverdueFallback && (
                        <span className="block text-[10px] text-red-400 font-semibold mt-1">
                          Quá 2p - Cần hỗ trợ bưng!
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending}
                    onClick={() => handleServeOrderItem(item)}
                    className="min-h-12 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-bold text-sm transition-all"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {servingItemId===item.id?'Đang xác nhận món này…':'Đã bưng lên bàn'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* BỘ LỌC KHU VỰC (ZONES) */}
      <section aria-label="Yêu cầu tính tiền" className="space-y-3 rounded-2xl border border-amber-500/40 p-4">
        <h2 className="text-lg font-bold">Bàn chờ tính tiền</h2>
        {sessions.filter(session=>session.status==='REQUEST_BILL'&&(workScope==='ALL'||session.assigned_staff_id===currentStaffId)).map(session=><button key={session.id} type="button" disabled={!session.table_id} onClick={()=>{setActiveTableId(session.table_id);document.getElementById('staff-table-detail')?.scrollIntoView({block:'start'});}} className="min-h-12 px-4 py-3 mr-2 rounded-xl border border-amber-500 text-left">
          {session.table_id?tableMap.get(session.table_id)?.table_number:'Mang về'} · {formatVND(session.total_amount)} · Xem hóa đơn
        </button>)}
        {!sessions.some(session=>session.status==='REQUEST_BILL'&&(workScope==='ALL'||session.assigned_staff_id===currentStaffId))&&<p className="text-zinc-300">Không có bàn đang chờ tính tiền.</p>}
      </section>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSelectedZoneId('ALL')}
          className={cn(
            'min-h-12 px-4 py-2.5 rounded-xl text-sm font-semibold border shrink-0 transition-colors',
            selectedZoneId === 'ALL'
              ? 'bg-amber-500 text-zinc-950 border-amber-500'
              : 'bg-zinc-900 text-zinc-300 border-zinc-800'
          )}
        >
          Tất cả khu vực ({tables.length})
        </button>
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => setSelectedZoneId(zone.id)}
            className={cn(
              'min-h-12 px-4 py-2.5 rounded-xl text-sm font-semibold border shrink-0 transition-colors',
              selectedZoneId === zone.id
                ? 'bg-amber-500 text-zinc-950 border-amber-500'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800'
            )}
          >
            {zone.name}
          </button>
        ))}
      </div>

      {/* SƠ ĐỒ BÀN TRỰC QUAN & CHI TIẾT BÀN ĐANG CHỌN */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cột trái: Sơ đồ bàn */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-3.5 content-start">
          {filteredTables.map((table) => {
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
                    : 'bg-zinc-900 border-zinc-800',
                  isSelected ? 'ring-2 ring-amber-400' : ''
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div>
                    <h3 className="text-lg font-extrabold text-zinc-100">
                      {table.table_number}
                    </h3>
                    <span className="text-[11px] text-zinc-400">
                      {assignedStaff
                        ? `NV: ${assignedStaff.full_name}`
                        : isOccupied
                        ? 'Chưa gán NV'
                        : 'Bàn trống'}
                    </span>
                  </div>

                  {readyCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-zinc-950">
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
                            : 'text-amber-300'
                        )}
                      >
                        {isRequestingBill
                          ? '🔔 GỌI TÍNH TIỀN'
                          : 'Đang nhậu (ACTIVE)'}
                      </span>
                      <span className="font-bold text-sm text-zinc-100">
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
                        className="min-h-12 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-amber-300 border border-zinc-700"
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
                        className="min-h-12 inline-flex items-center justify-center px-2.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-xs font-bold text-zinc-950"
                      >
                        Chi tiết
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending}
                    onClick={() => handleOpenTable(table)}
                    className="min-h-12 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors"
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
        <div id="staff-table-detail" className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-5 h-fit">
          {!activeTable || !activeTableSession ? (
            <div className="py-12 text-center text-zinc-500 text-sm">
              Chọn một bàn đang mở ở bên trái để Order hộ khách, Chuyển bàn, Trả bia thừa hoặc Chốt thanh toán.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
                <div>
                  <span className="text-xs text-amber-400 font-semibold">
                    Đang quản lý phiên nhậu
                  </span>
                  <h2 className="text-2xl font-extrabold text-zinc-100">
                    {activeTable.table_number}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Mã phiên: <code className="text-zinc-200">{activeTableSession.session_token}</code>
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xs text-zinc-400 block">
                    Tạm tính hiện tại
                  </span>
                  <span className="text-2xl font-black text-amber-400">
                    {formatVND(activeTableSession.total_amount)}
                  </span>
                </div>
              </div>

              {/* Cụm nút nghiệp vụ chính (Cao tối thiểu 48px) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setQrModalSession(activeTableSession)}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold"
                >
                  <QrCode className="h-4 w-4" />
                  Hiện QR Bàn
                </button>

                <button
                  type="button"
                  onClick={() => setIsOrderModalOpen(true)}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
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
                    setReturnUnusedConfirmed(false);
                  }}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold"
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
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-semibold"
                >
                  <ArrowRightLeft className="h-4 w-4 text-amber-400" />
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
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-semibold"
                >
                  <UserCheck className="h-4 w-4 text-emerald-400" />
                  Bàn giao bàn
                </button>

                <button
                  type="button"
                  onClick={() => { setPaymentReceived(false); setIsCheckoutModalOpen(true); }}
                  className="min-h-12 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-extrabold"
                >
                  <Receipt className="h-4 w-4" />
                  Chốt & Đóng bill
                </button>
              </div>

              {/* Danh sách món đã gọi của bàn */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Danh sách món của bàn ({activeTableOrders.length})
                </h3>

                <div className="divide-y divide-zinc-800/80 max-h-96 overflow-y-auto pr-1">
                  {activeTableOrders.length === 0 ? (
                    <p className="py-6 text-center text-xs text-zinc-500">
                      Bàn chưa gọi món nào.
                    </p>
                  ) : (
                    activeTableOrders.map((oi) => {
                      const menu = menuMap.get(oi.menu_item_id);
                      const canCancel = oi.quantity > 0 && (
                        oi.status === 'QUEUED' ||
                        (currentStaffRole === 'admin' &&
                          oi.status !== 'CANCELLED'));

                      return (
                        <div
                          key={oi.id}
                          className="py-3 flex items-center justify-between gap-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-zinc-100 flex items-center gap-2">
                              <span>
                                {oi.quantity}x {menu?.name ?? 'Món ăn'}
                              </span>
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-full text-[10px] font-bold',
                                  oi.status === 'SERVED'
                                    ? 'bg-zinc-800 text-zinc-300'
                                    : oi.status === 'READY'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : oi.status === 'COOKING'
                                    ? 'bg-orange-500/20 text-orange-300'
                                    : oi.status === 'CANCELLED'
                                    ? 'bg-red-500/20 text-red-400 line-through'
                                    : 'bg-amber-500/20 text-amber-300'
                                )}
                              >
                                {oi.quantity === 0 ? 'Đã trả hết' : oi.status}
                              </span>
                            </div>
                            <div className="text-xs text-zinc-400">
                              {formatVND(oi.unit_price * oi.quantity)}
                              {oi.note ? ` • Ghi chú: ${oi.note}` : ''}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {oi.quantity > 0 && oi.status === 'READY' && (
                              <button
                                type="button"
                                onClick={() => handleServeOrderItem(oi)}
                                disabled={itemActions.blocked || isSubmitting}
                                className="min-h-12 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                              >
                                Bưng ngay
                              </button>
                            )}
                            {canCancel && (
                              <button
                                type="button"
                                onClick={() => handleCancelQueuedItem(oi)}
                                title={oi.status === 'QUEUED' ? 'Hủy món đang chờ (QUEUED)' : 'Hủy món (cần lý do)'}
                                disabled={itemActions.blocked || isSubmitting}
                                className="min-h-12 min-w-12 p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300"
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-amber-500/50 rounded-3xl max-w-md w-full p-6 text-center space-y-5">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold">
                Mã QR Động Theo Phiên
              </span>
              <button
                type="button"
                onClick={() => setQrModalSession(null)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div>
              <h3 className="text-2xl font-black text-zinc-100">
                {qrModalSession.table_id
                  ? tableMap.get(qrModalSession.table_id)?.table_number ?? 'Bàn'
                  : 'Phiên gọi món'}
              </h3>
              <p className="text-xs text-zinc-400 mt-1">
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
              <p className="font-mono text-xs text-zinc-400 break-all">
                {originUrl}/customer/order/{qrModalSession.session_token}
              </p>
              <a
                href={`/customer/order/${qrModalSession.session_token}`}
                target="_blank"
                rel="noreferrer"
                className="min-h-12 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold text-sm"
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                Order hộ khách • {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsOrderModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {unconfirmedStaffOrder && (
              <div role="status" className="rounded-lg border border-amber-500 p-3 text-sm">
                <p>Có lượt gọi hộ chưa xác nhận. Kiểm tra lượt này trước khi thêm món mới.</p>
                <button type="button" disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending} onClick={()=>handleStaffAddOrderItem()} className="min-h-12 px-3 text-amber-300">
                  Kiểm tra lượt gọi hộ trước
                </button>
              </div>
            )}
            {errorMessage && <p role="alert" className="text-sm text-red-300">{errorMessage}</p>}
            <input
              type="text"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Tìm nhanh mồi nhậu, bia, nước ngọt..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
            />

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800 space-y-2 pr-1">
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
                      <div className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                        <span>{m.name}</span>
                        <span className="text-xs font-semibold text-amber-400">
                          {formatVND(m.price)}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                          {m.station === 'BAR_INSTANT' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <Beer className="h-3 w-3" /> Lấy ngay
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-orange-400">
                              <UtensilsCrossed className="h-3 w-3" /> Bếp nấu
                            </span>
                          )}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={selectedMenuNote[m.id] ?? ''}
                        disabled={isSubmitting || unconfirmedStaffOrder}
                        onChange={(e) =>
                          setSelectedMenuNote((prev) => ({
                            ...prev,
                            [m.id]: e.target.value,
                          }))
                        }
                        placeholder="Ghi chú (ít cay, không hành, ướp lạnh...)"
                        className="mt-1 w-full sm:w-64 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={selectedMenuQty[m.id] ?? 1}
                        disabled={isSubmitting || unconfirmedStaffOrder}
                        onChange={(e) =>
                          setSelectedMenuQty((prev) => ({
                            ...prev,
                            [m.id]: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="w-16 px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-center text-sm font-bold text-zinc-100"
                      />
                      <button
                        type="button"
                        disabled={isSubmitting || unconfirmedStaffOrder}
                        onClick={() => handleStaffAddOrderItem(m)}
                        className="min-h-12 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs"
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                Chuyển bàn từ {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleTransferTable} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Chọn bàn trống cần chuyển tới *
                </label>
                <select
                  required
                  value={targetTransferTableId}
                  onChange={(e) => setTargetTransferTableId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
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
                <p className="text-xs text-zinc-400 mt-2">
                  Mã QR phiên của khách vẫn giữ nguyên hiệu lực, các món đang nấu trong Bếp sẽ tự động đổi sang số bàn mới.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="min-h-12 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmitting || availableTablesForTransfer.length === 0
                  }
                  className="min-h-12 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm"
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                Bàn giao {activeTable.table_number} cho đồng nghiệp
              </h3>
              <button
                type="button"
                onClick={() => setIsHandoverModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleHandoverTable} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Chọn nhân viên nhận bàn *
                </label>
                <select
                  required
                  value={targetHandoverStaffId}
                  onChange={(e) => setTargetHandoverStaffId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                >
                  {staffProfiles
                    .filter(
                      (s) =>
                        s.is_active &&
                        (s.role === 'staff' || s.role === 'admin')
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} ({s.role})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  className="min-h-12 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending}
                  className="min-h-12 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                Trả lại bia / đồ uống thừa • {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsReturnBeerModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {returnableDrinkItems.length === 0 ? (
              <p className="text-sm text-zinc-400 py-4">
                Bàn này chưa có dòng bia hoặc đồ uống nào để trả lại.
              </p>
            ) : (
              <form onSubmit={handleReturnBeer} className="space-y-4">
                <fieldset disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending} className="space-y-4">
                {errorMessage && <p role="alert" className="text-red-300">{errorMessage}</p>}
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Chọn dòng bia / đồ uống trong bill *
                  </label>
                  <select
                    required
                    value={selectedReturnOrderItemId}
                    onChange={(e) =>
                      setSelectedReturnOrderItemId(e.target.value)
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
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
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Số lượng khách trả lại *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={returnBeerQuantity}
                    onChange={(e) => setReturnBeerQuantity(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  />
                  <p className="text-xs text-zinc-400 mt-1.5">
                    Chỉ nhận lại bia, đồ uống còn nguyên chưa dùng. Quán sẽ giảm tiền trên bill và hoàn số lượng về kho.
                  </p>
                </div>

                <label className="min-h-12 flex items-center gap-3 text-sm">
                  <input type="checkbox" required checked={returnUnusedConfirmed}
                    onChange={(event) => setReturnUnusedConfirmed(event.target.checked)} />
                  Tôi đã kiểm tra: hàng còn nguyên, chưa sử dụng.
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsReturnBeerModalOpen(false)}
                    className="min-h-12 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending}
                    className="min-h-12 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-sm"
                  >
                    Hoàn trả bia & Cập nhật bill
                  </button>
                </div>
                </fieldset>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL CHỐT THANH TOÁN & ĐÓNG PHIÊN BÀN */}
      {/* ==================================================================== */}
      {isCheckoutModalOpen && activeTable && activeTableSession && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                Chốt thanh toán • {activeTable.table_number}
              </h3>
              <button
                type="button"
                onClick={() => setIsCheckoutModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCloseSessionBill} className="space-y-4">
              {errorMessage && <p role="alert" className="text-red-300">{errorMessage}</p>}
              <label className="min-h-12 flex items-center gap-3 text-sm">
                <input type="checkbox" required checked={paymentReceived} onChange={(event) => setPaymentReceived(event.target.checked)} />
                Tôi đã nhận đủ tiền hoặc đối chiếu giao dịch chuyển khoản thực tế.
              </label>
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                <span className="text-sm text-zinc-400">Tổng thanh toán:</span>
                <span className="text-2xl font-black text-amber-400">
                  {formatVND(activeTableSession.total_amount)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Phương thức thanh toán *
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCheckoutPaymentMethod('CASH')}
                    className={cn(
                      'min-h-12 p-3 rounded-xl border text-sm font-bold',
                      checkoutPaymentMethod === 'CASH'
                        ? 'bg-amber-500 text-zinc-950 border-amber-500'
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800'
                    )}
                  >
                    Tiền mặt (CASH)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckoutPaymentMethod('VIETQR')}
                    className={cn(
                      'min-h-12 p-3 rounded-xl border text-sm font-bold',
                      checkoutPaymentMethod === 'VIETQR'
                        ? 'bg-amber-500 text-zinc-950 border-amber-500'
                        : 'bg-zinc-950 text-zinc-300 border-zinc-800'
                    )}
                  >
                    Chuyển khoản (VIETQR)
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCheckoutModalOpen(false)}
                  className="min-h-12 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || itemActions.blocked || unconfirmedReturn || returnJournalBlocked || sessionActionPending}
                  className="min-h-12 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm"
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
