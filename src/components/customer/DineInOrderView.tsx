'use client';
import { BillPanel } from './BillPanel';
import { CustomerShell } from './CustomerShell';
import { MenuCatalog } from './MenuCatalog';
import { CartSheet } from './CartSheet';
import { OrderProgress } from './OrderProgress';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';

import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useRouter } from 'next/navigation';
import { pendingSessionAction, submitSessionAction, acknowledgeSessionAction } from '@/lib/sessions/client';
import {
  UtensilsCrossed,
  Flame,
  Receipt,
  QrCode,
  ShoppingBag,
  Plus,
  Minus,
  Clock,
  CheckCircle2,
  ChefHat,
  Beer,
  Users,
  Sparkles,
  AlertCircle,
  Search,
  Send,
  Lock,
  X,
} from 'lucide-react';
import { useDineInSnapshot } from '@/lib/data/use-dine-in-snapshot';
import type { GuestSession as TableSessionRow, PublicMenuItem as MenuItemRow } from '@/lib/data/read-contracts';
import { useCartStore } from '@/lib/store/useCartStore';
import { acknowledgeOrder, pendingOrder, recoverOrder, submitOrder, OrderSubmissionError } from '@/lib/orders/client';
import type { DisplayOrderItem as OrderItemRow } from '@/lib/orders/contracts';
import {
  formatVND,
  formatDurationFromSeconds,
  cn,
} from '@/lib/utils';
import type {
  MenuCategory,
  PaymentMethod,
} from '@/types/database.types';

interface DineInOrderViewProps {
  initialSession: TableSessionRow;
  table: { table_number: string } | null;
  zone: { name: string } | null;
  initialMenuItems: MenuItemRow[];
  initialSessionOrders: OrderItemRow[];
  initialQueuePositions: Record<string, number>;
}

type CustomerTab = 'MENU' | 'PROGRESS' | 'BILL';

const CATEGORY_TABS: { key: MenuCategory | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'FOOD', label: 'Mồi nhậu' },
  { key: 'BEER', label: 'Bia' },
  { key: 'DRINK', label: 'Đồ uống' },
  { key: 'OTHER', label: 'Khác' },
];

const COOLDOWN_SECONDS = 5; // Chống bấm đúp & Rate limit 5 giây
const BILL_REQUEST_ACCEPTED = 'Quán đã ghi nhận yêu cầu tính tiền. Vui lòng chờ nhân viên xác nhận.';
const BILL_REQUEST_UNKNOWN = 'Chưa xác nhận được yêu cầu tính tiền. Hãy kiểm tra lượt vừa gửi.';
// A delayed read must not reopen ordering after this device has observed bill request.
function mergeSession(current: TableSessionRow, next: TableSessionRow): TableSessionRow {
  return current.id === next.id && current.status === 'REQUEST_BILL' && next.status === 'ACTIVE'
    ? { ...next, status: current.status } : next;
}

export function DineInOrderView({
  initialSession,
  table,
  zone,
  initialMenuItems,
  initialSessionOrders,
  initialQueuePositions,
}: DineInOrderViewProps) {
  const router = useRouter();
  const billLock = useRef(false);
  const [confirmBill, setConfirmBill] = useState(false);
  const [discardUnsent, setDiscardUnsent] = useState(false);
  const [billPending, setBillPending] = useState(false);
  const billScope = { mode: 'customer' as const, identity: initialSession.id, token: initialSession.session_token };
  useEffect(() => {
    try { setBillPending(pendingSessionAction({ mode: 'customer', identity: initialSession.id }) !== null); }
    catch { setBillPending(true); }
  }, [initialSession.id]);

  const [session, setSession] = useState<TableSessionRow>(initialSession);
  useEffect(() => { setSession(current => mergeSession(current, initialSession)); }, [initialSession]);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  const [sessionOrders, setSessionOrders] =
    useState<OrderItemRow[]>(initialSessionOrders);
  const [queuePositions, setQueuePositions] = useState(initialQueuePositions);
  const snapshotState = useDineInSnapshot(initialSession.session_token, (snapshot) => {
    setSession(current => mergeSession(current, snapshot.session)); setMenuItems(snapshot.menu); setSessionOrders(snapshot.items); setQueuePositions(snapshot.queuePositions);
  });
  useEffect(() => { setMenuItems(initialMenuItems); }, [initialMenuItems]);
  useEffect(() => { setSessionOrders(initialSessionOrders); }, [initialSessionOrders]);
  useEffect(() => { setQueuePositions(initialQueuePositions); }, [initialQueuePositions]);

  const [activeTab, setActiveTab] = useState<CustomerTab>('MENU');
  const [selectedCategory, setSelectedCategory] = useState<
    MenuCategory | 'ALL'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState<boolean>(false);
  const [isShareQrOpen, setIsShareQrOpen] = useState<boolean>(false);

  // Chia tiền Campuchia
  const [campuchiaCount, setCampuchiaCount] = useState<number>(4);
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>(initialSession.payment_method ?? 'VIETQR');

  // Chống bấm đúp & Rate limit 5 giây
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const lastSubmitTimestampRef = useRef<number>(0);
  const submitLock = useRef(false);
  const [unconfirmedOrder, setUnconfirmedOrder] = useState(false);
  const orderScope = { mode: 'customer' as const, identity: 'table', sessionId: session.id, token: session.session_token };

  // Đồng hồ nhảy mỗi giây cho tab Tiến độ Bếp (đếm ngược thời gian nấu)

  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [originUrl, setOriginUrl] = useState<string>('');

  // Zustand Cart Store
  const {
    items: cartItems,
    setSessionToken,
    addItem: addCartItem,
    updateQuantity: changeQuantity,
    updateNote: changeNote,
    acceptSubmittedOrder,
    getTotalQuantity,
    getTotalAmount,
    recordOrderSubmission,
  } = useCartStore();

  const addItem = (...args: Parameters<typeof addCartItem>) => { if (canOrderMore && !isSubmitting && !unconfirmedOrder) addCartItem(...args); };
  const updateQuantity = (...args: Parameters<typeof changeQuantity>) => { if (canOrderMore && !isSubmitting && !unconfirmedOrder) changeQuantity(...args); };
  const updateNote = (...args: Parameters<typeof changeNote>) => { if (canOrderMore && !isSubmitting && !unconfirmedOrder) changeNote(...args); };

  useEffect(() => {
    try {
      if (pendingOrder({ mode:'customer', identity:'table', sessionId:initialSession.id })) {
        setUnconfirmedOrder(true);
        setIsCartDrawerOpen(true);
      }
    } catch (error) {
      setUnconfirmedOrder(true);
      setFeedbackMessage({type:'error',text:error instanceof Error?error.message:'Không khôi phục được lượt đang gửi.'});
    }
  }, [initialSession.id]);

  useEffect(() => {
    setSessionToken(initialSession.session_token);
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
  }, [initialSession.session_token, setSessionToken]);

  useEffect(() => {
    if (!unconfirmedOrder) return;
    let active=true;const controller=new AbortController();
    const recover=async()=>{
      if(document.visibilityState!=='visible'||!navigator.onLine||submitLock.current||billLock.current)return;
      submitLock.current=true;
      try {
        const scope={mode:'customer' as const,identity:'table',sessionId:initialSession.id,token:initialSession.session_token};
        const restored=await recoverOrder(scope,controller.signal);
        if(!active||!restored)return;
        acceptSubmittedOrder(restored.result.operationId,restored.submittedLines);
        acknowledgeOrder(scope,restored.result.operationId);setUnconfirmedOrder(false);
        setSessionOrders(previous=>{const ids=new Set(previous.map(item=>item.id));return [...previous,...restored.result.items.filter(item=>!ids.has(item.id))];});
        setFeedbackMessage({type:'success',text:'Quán đã nhận lượt gọi món. Đã kiểm tra lại thành công.'});router.refresh();
      } catch { /* Keep the pending journal and explicit recovery action. */ }
      finally {submitLock.current=false;}
    };
    window.addEventListener('online',recover);window.addEventListener('focus',recover);document.addEventListener('visibilitychange',recover);
    return()=>{active=false;controller.abort();window.removeEventListener('online',recover);window.removeEventListener('focus',recover);document.removeEventListener('visibilitychange',recover);};
  },[unconfirmedOrder,initialSession.id,initialSession.session_token,acceptSubmittedOrder,router]);

  // Bộ đếm nhịp 1 giây phục vụ đồng hồ đếm ngược thời gian nấu & cooldown 5s
  useEffect(() => {
    const interval = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemRow>();
    menuItems.forEach((m) => map.set(m.id, m));
    return map;
  }, [menuItems]);


  // Only aggregate positions for this table arrive from SQL, never other tables' rows.
  const getQueuePositionForOrderItem = (item: OrderItemRow) => queuePositions[item.id] ?? null;

  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesCat =
        selectedCategory === 'ALL' || item.category === selectedCategory;
      const matchesSearch = item.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  const validBillOrders = useMemo(
    () => sessionOrders.filter((i) => i.quantity > 0 && i.status !== 'CANCELLED'),
    [sessionOrders]
  );

  const liveBillTotalAmount = useMemo(
    () =>
      validBillOrders.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0
      ),
    [validBillOrders]
  );

  const perPersonCampuchia = useMemo(() => {
    const safePeople = Math.max(1, campuchiaCount);
    return Math.ceil(liveBillTotalAmount / safePeople);
  }, [liveBillTotalAmount, campuchiaCount]);

  // ==========================================================================
  // GỬI ĐƠN GỌI MÓN XUỐNG BẾP / QUẦY (CHỐNG BẤM ĐÚP + RATE LIMIT 5 GIÂY + SNAPSHOT PRICE)
  // ==========================================================================
  async function handleSubmitOrder() {
    if ((!unconfirmedOrder && (!canOrderMore || session.status !== 'ACTIVE')) || submitLock.current || billLock.current || billPending || isSubmitting || (!unconfirmedOrder && cartItems.length===0)) return;
    if (!unconfirmedOrder && cooldownSeconds>0) return;
    submitLock.current=true;
    setIsSubmitting(true);
    setFeedbackMessage(null);
    try {
      const {result,submittedLines}=await submitOrder(orderScope,cartItems.map((item)=>({
        menu_item_id:item.menu_item_id,quantity:item.quantity,note:item.note,expected_price:item.unit_price,
      })));
      // Keep advanced realtime states; a replay contains the original accepted states.
      setSessionOrders((previous)=>{
        const existing=new Set(previous.map((item)=>item.id));
        return [...result.items.filter((item)=>!existing.has(item.id)),...previous];
      });
      acceptSubmittedOrder(result.operationId,submittedLines);
      acknowledgeOrder(orderScope,result.operationId);
      setUnconfirmedOrder(false);
      recordOrderSubmission();
      lastSubmitTimestampRef.current=Date.now();
      setCooldownSeconds(COOLDOWN_SECONDS);
      setIsCartDrawerOpen(false);
      setActiveTab('PROGRESS');
      router.refresh();
      setFeedbackMessage({type:'success',text:'Quán đã nhận lượt gọi món của bạn.'});
    } catch(error) {
      if (error instanceof OrderSubmissionError && error.quote) {
        const quote=error.quote;
        useCartStore.setState((state)=>({items:state.items.map((item)=>item.menu_item_id===quote.menuItemId?{...item,unit_price:quote.price}:item)}));
        setMenuItems((items)=>items.map((item)=>item.id===quote.menuItemId?{...item,price:quote.price}:item));
      }
      try { setUnconfirmedOrder(pendingOrder(orderScope)!==null); } catch { setUnconfirmedOrder(true); }
      setFeedbackMessage({type:'error',text:error instanceof Error?error.message:'Chưa xác nhận được lượt gọi món.'});
    } finally {
      submitLock.current=false;
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // YÊU CẦU THANH TOÁN ("GỌI TÍNH TIỀN" - US-C04)
  // ==========================================================================
  async function handleRequestBill() {
    if (billLock.current || isSubmitting || unconfirmedOrder || session.status === 'CLOSED') return;
    if (!billPending && cartItems.length > 0 && !discardUnsent) return;
    billLock.current=true; setIsSubmitting(true); setFeedbackMessage(null);
    try {
      const {result}=await submitSessionAction(billScope,billPending?undefined:{action:'REQUEST_BILL',input:{sessionId:session.id,paymentMethod:selectedPaymentMethod}});
      acknowledgeSessionAction(billScope,result.operationId);
      if (discardUnsent) useCartStore.getState().clearCart();
      setConfirmBill(false);
      setSession((previous)=>previous.status==='ACTIVE'?{...previous,status:'REQUEST_BILL'}:previous);
      setFeedbackMessage({type:'success',text:BILL_REQUEST_ACCEPTED});
      router.refresh();
    } catch(error) {
      setFeedbackMessage({type:'error',text:error instanceof Error?error.message:BILL_REQUEST_UNKNOWN});
    } finally {
      try {setBillPending(pendingSessionAction(billScope)!==null);} catch {setBillPending(true);}
      billLock.current=false; setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // CHẶN HOÀN TOÀN NẾU PHIÊN BÀN ĐÃ ĐÓNG (CLOSED) HOẶC CHƯA KÍCH HOẠT (PENDING_PAYMENT)
  // ==========================================================================
  if (snapshotState.expired || session.status === 'CLOSED' || session.status === 'PENDING_PAYMENT') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-zinc-100">
            {snapshotState.expired || session.status === 'CLOSED'
              ? 'Phiên nhậu đã kết thúc'
              : 'Phiên bàn chưa kích hoạt'}
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {snapshotState.expired || session.status === 'CLOSED'
              ? 'Bàn này đã thanh toán xong và mã QR theo phiên đã được vô hiệu hóa để bảo mật. Vui lòng nhờ nhân viên mở phiên bàn mới nếu bạn muốn gọi món.'
              : 'Đơn hàng chưa được kích hoạt thanh toán.'}
          </p>
        </div>
      </div>
    );
  }

  const totalCartItems = getTotalQuantity();
  const totalCartMoney = getTotalAmount();
  const canOrderMore = session.status === 'ACTIVE' && !billPending && !snapshotState.unavailable && !snapshotState.expired;

  return (
    <CustomerShell><div>
      {snapshotState.unavailable && <p role="alert" className="p-4 text-sm text-amber-300">Chưa cập nhật được thông tin bàn. Tạm dừng gọi thêm món; hãy kiểm tra kết nối hoặc nhờ nhân viên hỗ trợ.</p>}
      {/* Header Thông tin Bàn & Nút Chia sẻ QR cho bạn nhậu cùng bàn */}
      <header className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-500 text-zinc-950">
                {table?.table_number ?? 'Bàn nhậu'}
              </span>
              {zone && (
                <span className="text-xs text-zinc-400 font-medium">
                  • {zone.name}
                </span>
              )}
            </div>
            <h1 className="text-base font-bold text-zinc-100 mt-1">
              123Dzô • Gọi món tại bàn
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setIsShareQrOpen(true)}
            className="min-h-12 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-amber-500/40 text-xs font-bold shrink-0"
          >
            <QrCode className="h-4 w-4" />
            Hiện QR bàn
          </button>
        </div>

      </header>

      {/* Thông báo phản hồi */}
      {billPending && (
        <div role="status" className="p-4 border border-amber-500 rounded-xl">
          <p>Có yêu cầu tính tiền chưa xác nhận. Kiểm tra trước khi thao tác lại.</p>
          <button type="button" disabled={isSubmitting} onClick={handleRequestBill} className="min-h-12 px-4 text-amber-300">Kiểm tra yêu cầu tính tiền</button>
        </div>
      )}
      {unconfirmedOrder && (
        <div role="status" className="mx-4 my-3 rounded-xl border border-amber-500 p-4 text-sm">
          <p>Có lượt gọi món chưa xác nhận. Giỏ tạm khóa để tránh gửi nhầm lượt mới.</p>
          <button type="button" disabled={isSubmitting} onClick={handleSubmitOrder} className="min-h-12 px-4 font-bold text-amber-300">
            Kiểm tra lượt vừa gửi
          </button>
        </div>
      )}
      {feedbackMessage && (
        <div
          className={cn(
            'mx-4 mt-3 p-3.5 rounded-2xl border text-xs font-medium flex items-center justify-between gap-2',
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
              : 'bg-red-950/70 border-red-500/40 text-red-200'
          )}
        >
          <span>{feedbackMessage.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            aria-label="Đóng thông báo" className="min-h-12 min-w-12"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: THỰC ĐƠN (MENU) */}
      {/* ==================================================================== */}
      {activeTab === 'MENU' && (
        <div className="p-4 space-y-4">
          {session.status === 'REQUEST_BILL' && (
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                Bàn đã yêu cầu tính tiền. Vui lòng chờ nhân viên xác nhận.
              </span>
            </div>
          )}

          <MenuCatalog items={menuItems} selected={cartItems} disabled={!canOrderMore || isSubmitting || unconfirmedOrder || billPending} onAdd={item=>addItem({menu_item_id:item.id,name:item.name,category:item.category,station:item.station,unit_price:item.price,image_url:item.image_url})}/>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: TIẾN ĐỘ BẾP REALTIME (VỊ TRÍ HÀNG ĐỢI MỤC 5.3 & ĐỒNG HỒ ĐẾM NGƯỢC) */}
      {/* ==================================================================== */}
      {activeTab === 'PROGRESS' && <div className="p-4"><OrderProgress items={sessionOrders} menu={menuItems} positions={queuePositions}/></div>}

      {/* ==================================================================== */}
      {/* TAB 3: HÓA ĐƠN & CHIA TIỀN CAMPUCHIA + NÚT GỌI TÍNH TIỀN */}
      {/* ==================================================================== */}
      {activeTab === 'BILL' && (
        <div className="p-4 space-y-5">
          <BillPanel items={validBillOrders} menu={menuItems} total={liveBillTotalAmount}/>

          <details><summary className="min-h-12 cursor-pointer py-3">Chia đều tiền (ước tính)</summary>
          {/* Tiện ích Chia tiền Campuchia theo số người */}
          <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-400" />
              <div>
                <h3 className="font-bold text-sm text-zinc-100">
                  Chia tiền Campuchia (Chia đều theo đầu người)
                </h3>
                <p className="text-xs text-zinc-400">
                  Chọn số anh em ngồi chung bàn để tính nhanh mỗi người đóng bao nhiêu
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCampuchiaCount((c) => Math.max(1, c - 1))
                  }
                  className="min-h-12 w-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-100 font-bold"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-center min-w-[90px]">
                  <span className="text-lg font-black text-amber-400">
                    {campuchiaCount}
                  </span>
                  <span className="text-xs text-zinc-400 block">người</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCampuchiaCount((c) => c + 1)}
                  className="min-h-12 w-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-100 font-bold"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="text-right">
                <span className="text-xs text-zinc-400 block">
                  Mỗi người đóng:
                </span>
                <span className="text-xl font-black text-emerald-400">
                  {formatVND(perPersonCampuchia)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[2, 3, 4, 5, 6, 8, 10].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setCampuchiaCount(num)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                    campuchiaCount === num
                      ? 'bg-amber-500 text-zinc-950 border-amber-500'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                  )}
                >
                  {num} người
                </button>
              ))}
            </div>
          </div>

          </details>
          {/* Khu vực Gọi tính tiền (US-C04) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
            <h3 className="font-bold text-sm text-zinc-100">
              Yêu cầu Thanh toán tại bàn
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedPaymentMethod('VIETQR')}
                className={cn(
                  'min-h-12 p-3 rounded-xl border text-xs font-bold',
                  selectedPaymentMethod === 'VIETQR'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                )}
              >
                Chuyển khoản
              </button>
              <button
                type="button"
                onClick={() => setSelectedPaymentMethod('CASH')}
                className={cn(
                  'min-h-12 p-3 rounded-xl border text-xs font-bold',
                  selectedPaymentMethod === 'CASH'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                )}
              >
                Tiền mặt
              </button>
            </div>

            <button
              type="button"
              disabled={
                isSubmitting ||
                unconfirmedOrder ||
                liveBillTotalAmount === 0 ||
                session.status === 'REQUEST_BILL'
              }
              onClick={() => setConfirmBill(true)}
              className="min-h-12 w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-5 w-5" />
              {session.status === 'REQUEST_BILL'
                ? 'Đã gửi yêu cầu tính tiền'
                : 'Bấm Gọi Tính Tiền'}
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* THANH GIỎ HÀNG NỔI PHÍA DƯỚI MÀN HÌNH */}
      {/* ==================================================================== */}
      {totalCartItems > 0 && (
        <div className="fixed bottom-[calc(72px_+_env(safe-area-inset-bottom))] left-0 right-0 z-40 p-3 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 max-w-[640px] mx-auto">
          <button
            type="button"
            onClick={() => setIsCartDrawerOpen(true)}
            className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-extrabold text-sm flex items-center justify-between shadow-lg"
          >
            <span className="inline-flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              Giỏ hàng đã chọn ({totalCartItems} món)
            </span>
            <span>{formatVND(totalCartMoney)} • Xem & Đặt →</span>
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* DRAWER XEM GIỎ HÀNG & GỬI ĐƠN (CHỐNG BẤM ĐÚP 5 GIÂY) */}
      {/* ==================================================================== */}
        {/* Thanh chuyển đổi 3 Tab (Thực đơn | Món đã gọi | Hóa đơn) */}
        <div className="customer-bottom-nav fixed bottom-0 inset-x-0 z-30 max-w-[640px] mx-auto grid grid-cols-3 gap-2 bg-zinc-950 p-2 border-t border-zinc-700">
          <button
            type="button"
            onClick={() => setActiveTab('MENU')}
            className={cn(
              'min-h-12 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all',
              activeTab === 'MENU'
                ? 'bg-amber-500 text-zinc-950 shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <UtensilsCrossed className="h-4 w-4" />
            Thực đơn
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('PROGRESS')}
            className={cn(
              'min-h-12 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all relative',
              activeTab === 'PROGRESS'
                ? 'bg-amber-500 text-zinc-950 shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <Flame className="h-4 w-4" />
            Món đã gọi
            {validBillOrders.some(
              (o) => o.status === 'QUEUED' || o.status === 'COOKING'
            ) && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 " />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('BILL')}
            className={cn(
              'min-h-12 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all',
              activeTab === 'BILL'
                ? 'bg-amber-500 text-zinc-950 shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <Receipt className="h-4 w-4" />
            Hóa đơn ({validBillOrders.length})
          </button>
        </div>

      <CartSheet open={isCartDrawerOpen} onClose={()=>setIsCartDrawerOpen(false)} items={cartItems} tableName={table?.table_number ?? 'Bàn'} locked={isSubmitting} blocked={!canOrderMore||billPending} unknown={unconfirmedOrder} error={feedbackMessage?.type==='error'?feedbackMessage.text:undefined} cooldown={cooldownSeconds} onQuantity={updateQuantity} onNote={updateNote} onSubmit={handleSubmitOrder}/>

      {/* ==================================================================== */}
      {/* MODAL HIỆN QR CHO BẠN NHẬU CÙNG BÀN QUÉT CHUNG (US-C02) */}
      {/* ==================================================================== */}
      <AccessibleDialog open={isShareQrOpen} title={`QR gọi món • ${table?.table_number ?? 'Bàn'}`} onClose={() => setIsShareQrOpen(false)}>
        <p>Chỉ chia sẻ mã này với người đang ngồi cùng bàn.</p>
        <div className="bg-white p-4 rounded-xl w-fit mx-auto"><QRCodeSVG value={`${originUrl}/customer/order/${session.session_token}`} size={192} level="H"/></div>
      </AccessibleDialog>
      <AccessibleDialog open={confirmBill} title="Gọi nhân viên tính tiền" onClose={() => setConfirmBill(false)} locked={isSubmitting}>
        <p>Bàn sẽ tạm dừng gọi thêm món sau khi quán nhận yêu cầu này.</p>
        <p>Tổng tạm tính: <strong>{formatVND(liveBillTotalAmount)}</strong>. Nhân viên sẽ xác nhận hóa đơn cuối cùng.</p>
        <p>Bạn có bia hoặc nước chưa dùng? Hãy nhờ nhân viên kiểm tra và nhận lại trước khi chốt.</p>
        {cartItems.length>0&&<div className="space-y-3 border border-amber-400 rounded-xl p-3">
          <p>Còn món trong giỏ chưa gửi cho quán.</p>
          <button type="button" onClick={()=>{setConfirmBill(false);setIsCartDrawerOpen(true);}} className="min-h-12 px-4 border rounded-xl">Quay lại xem giỏ</button>
          <label className="flex items-center gap-3"><input type="checkbox" checked={discardUnsent} onChange={event=>setDiscardUnsent(event.target.checked)} className="h-6 w-6"/>Bỏ món chưa gửi và tính tiền các món đã gọi</label>
        </div>}
        {feedbackMessage?.type==='error'&&<p role="alert">{feedbackMessage.text}</p>}
        <button type="button" disabled={isSubmitting||(cartItems.length>0&&!discardUnsent)} onClick={handleRequestBill} className="min-h-12 w-full rounded-xl bg-amber-400 text-zinc-950 font-bold disabled:opacity-50">{isSubmitting?'Đang kiểm tra…':'Xác nhận gọi tính tiền'}</button>
      </AccessibleDialog>
    </div></CustomerShell>
  );
}
