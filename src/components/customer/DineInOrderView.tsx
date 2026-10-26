'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
import { useAppEvents } from '@/lib/use-app-events';
import type { KitchenQueueEntry } from '@/lib/services/snapshots';
import { useCartStore } from '@/lib/store/useCartStore';
import {
  formatVND,
  cn,
} from '@/lib/utils';
import type {
  MenuCategory,
  MenuItemRow,
  OrderItemRow,
  PaymentMethod,
  TableRow,
  TableSessionRow,
  ZoneRow,
} from '@/types/database.types';

interface DineInOrderViewProps {
  initialSession: TableSessionRow;
  table: TableRow | null;
  zone: ZoneRow | null;
  initialMenuItems: MenuItemRow[];
  initialSessionOrders: OrderItemRow[];
  initialGlobalKitchenQueue: KitchenQueueEntry[];
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

export function DineInOrderView({
  initialSession,
  table,
  zone,
  initialMenuItems,
  initialSessionOrders,
  initialGlobalKitchenQueue,
}: DineInOrderViewProps) {

  const [session, setSession] = useState<TableSessionRow>(initialSession);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  const [sessionOrders, setSessionOrders] =
    useState<OrderItemRow[]>(initialSessionOrders);
  const [globalKitchenQueue, setGlobalKitchenQueue] = useState<KitchenQueueEntry[]>(
    initialGlobalKitchenQueue
  );


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
    addItem,
    updateQuantity,
    updateNote,
    clearCart,
    getTotalQuantity,
    getTotalAmount,
    canSubmitOrder,
    recordOrderSubmission,
  } = useCartStore();

  useEffect(() => {
    setSessionToken(initialSession.session_token);
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
  }, [initialSession.session_token, setSessionToken]);

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



  // ==========================================================================
  // LẮNG NGHE SUPABASE REALTIME (ORDER_ITEMS, TABLE_SESSIONS, MENU_ITEMS)
  // The SSE hook closes its EventSource when the view unmounts.
  // ==========================================================================
  useAppEvents((snapshot) => {
    if (snapshot.sessions[0]) setSession(snapshot.sessions[0]);
    setSessionOrders(snapshot.orders); setMenuItems(snapshot.menu);
    setGlobalKitchenQueue(snapshot.queue);
  }, { token: initialSession.session_token });

  // ==========================================================================
  // CÔNG THỨC TÍNH VỊ TRÍ HÀNG ĐỢI CHUẨN MỤC 5.3 PRD_SPEC.MD
  // Vị trí chờ = (Tổng số order_items toàn quán có status = 'QUEUED'
  //               VÀ station = 'KITCHEN' VÀ created_at < X.created_at) + 1
  // ==========================================================================
  const getQueuePositionForOrderItem = useMemo(() => {
    const activeKitchenQueue = globalKitchenQueue.filter(
      (item) => item.status === 'QUEUED' && item.station === 'KITCHEN'
    );

    return (targetItem: OrderItemRow): number => {
      const targetCreatedMs = new Date(targetItem.created_at).getTime();
      const aheadCount = activeKitchenQueue.filter((other) => {
        if (other.id === targetItem.id) return false;
        const otherMs = new Date(other.created_at).getTime();
        return otherMs < targetCreatedMs;
      }).length;

      return aheadCount + 1;
    };
  }, [globalKitchenQueue]);

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
    () => sessionOrders.filter((i) => i.status !== 'CANCELLED'),
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
    if (isSubmitting || cartItems.length === 0) return;

    const now = Date.now();
    if (
      cooldownSeconds > 0 ||
      now - lastSubmitTimestampRef.current < COOLDOWN_SECONDS * 1000
    ) {
      setFeedbackMessage({
        type: 'error',
        text: `Vui lòng đợi ${
          cooldownSeconds || COOLDOWN_SECONDS
        } giây trước khi gửi lượt đặt món tiếp theo.`,
      });
      return;
    }

    if (!canSubmitOrder()) {
      setFeedbackMessage({
        type: 'error',
        text: 'Bạn thao tác quá nhanh (tối đa 2 lần đặt trong 10 giây). Vui lòng chờ giây lát.',
      });
      return;
    }

    setIsSubmitting(true);
    setFeedbackMessage(null);

    try {
      const response = await fetch('/api/customer/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.session_token, items: cartItems.map((item) => ({ menu_item_id: item.menu_item_id, quantity: item.quantity, note: item.note })) }),
      });
      const result = await response.json() as { error?: string; orders: OrderItemRow[] };
      if (!response.ok) throw new Error(result.error || 'Không gửi được món.');
      const insertedOrders = result.orders;
      setSessionOrders((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const uniqueInserted = insertedOrders.filter(
          (io) => !existingIds.has(io.id)
        );
        return [...uniqueInserted, ...prev];
      });

      const kitchenInserted = insertedOrders.filter(
        (io) => io.station === 'KITCHEN' && io.status === 'QUEUED'
      );
      if (kitchenInserted.length > 0) {
        setGlobalKitchenQueue((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const uniqueKitchen = kitchenInserted.filter(
            (k) => !existingIds.has(k.id)
          );
          return [...prev, ...uniqueKitchen];
        });
      }

      // Ghi nhận mốc thời gian gửi đơn & kích hoạt Cooldown 5 giây
      recordOrderSubmission();
      lastSubmitTimestampRef.current = Date.now();
      setCooldownSeconds(COOLDOWN_SECONDS);
      clearCart();
      setIsCartDrawerOpen(false);
      setActiveTab('PROGRESS');
      setFeedbackMessage({
        type: 'success',
        text: 'Đã gửi món thành công! Bạn có thể theo dõi trực tiếp tiến độ Bếp bên dưới.',
      });
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Có lỗi xảy ra khi gửi đơn gọi món.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // YÊU CẦU THANH TOÁN ("GỌI TÍNH TIỀN" - US-C04)
  // ==========================================================================
  async function handleRequestBill() {
    if (isSubmitting || session.status === 'CLOSED') return;

    setIsSubmitting(true);
    setFeedbackMessage(null);

    try {
      const response = await fetch('/api/customer/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.session_token, paymentMethod: selectedPaymentMethod }),
      });
      const result = await response.json() as { error?: string; session: TableSessionRow };
      if (!response.ok) throw new Error(result.error || 'Không gửi được yêu cầu tính tiền.');
      setSession(result.session);

      setFeedbackMessage({
        type: 'success',
        text: 'Đã báo Nhân viên mang hóa đơn ra bàn! Vui lòng đợi trong giây lát.',
      });
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Lỗi khi gửi yêu cầu tính tiền.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // CHẶN HOÀN TOÀN NẾU PHIÊN BÀN ĐÃ ĐÓNG (CLOSED) HOẶC CHƯA KÍCH HOẠT (PENDING_PAYMENT)
  // ==========================================================================
  if (session.status === 'CLOSED' || session.status === 'PENDING_PAYMENT') {
    return (
      <div className="min-h-screen bg-soft text-ink flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface border border-line rounded-3xl p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-800">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-ink">
            {session.status === 'CLOSED'
              ? 'Phiên nhậu đã kết thúc'
              : 'Phiên bàn chưa kích hoạt'}
          </h1>
          <p className="text-sm text-muted-ink leading-relaxed">
            {session.status === 'CLOSED'
              ? 'Bàn này đã thanh toán xong và mã QR theo phiên đã được vô hiệu hóa để bảo mật. Vui lòng nhờ nhân viên mở phiên bàn mới nếu bạn muốn gọi món.'
              : 'Đơn hàng chưa được kích hoạt thanh toán.'}
          </p>
        </div>
      </div>
    );
  }

  const totalCartItems = getTotalQuantity();
  const totalCartMoney = getTotalAmount();
  const canOrderMore = session.status === 'ACTIVE';

  return (
    <div className="min-h-screen bg-soft text-ink pb-28 max-w-lg mx-auto border-x border-line">
      {/* Header Thông tin Bàn & Nút Chia sẻ QR cho bạn nhậu cùng bàn */}
      <header className="sticky top-0 z-30 bg-soft/90 backdrop-blur-md border-b border-line px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-500 text-ink">
                {table?.table_number ?? 'Bàn nhậu'}
              </span>

            </div>
            <h1 className="text-base font-bold text-ink mt-1">
              123Dzô • Thực đơn & Tiến độ Bếp
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setIsShareQrOpen(true)}
            className="min-h-12 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface hover:bg-muted text-amber-800 border border-amber-500/40 text-xs font-bold shrink-0"
          >
            <QrCode className="h-4 w-4" />
            Hiện QR bàn
          </button>
        </div>

        {/* Thanh chuyển đổi 3 Tab (Thực đơn | Tiến độ Bếp | Hóa đơn) */}
        <div className="grid grid-cols-3 gap-1.5 bg-surface p-1 rounded-2xl border border-line">
          <button
            type="button"
            onClick={() => setActiveTab('MENU')}
            className={cn(
              'min-h-12 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all',
              activeTab === 'MENU'
                ? 'bg-amber-500 text-ink shadow'
                : 'text-muted-ink hover:text-ink'
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
                ? 'bg-amber-500 text-ink shadow'
                : 'text-muted-ink hover:text-ink'
            )}
          >
            <Flame className="h-4 w-4" />
            Tiến độ Bếp
            {validBillOrders.some(
              (o) => o.status === 'QUEUED' || o.status === 'COOKING'
            ) && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('BILL')}
            className={cn(
              'min-h-12 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all',
              activeTab === 'BILL'
                ? 'bg-amber-500 text-ink shadow'
                : 'text-muted-ink hover:text-ink'
            )}
          >
            <Receipt className="h-4 w-4" />
            Hóa đơn ({validBillOrders.length})
          </button>
        </div>
      </header>
      {sessionOrders.some(i => i.status === 'READY') && <div role="status" aria-live="polite" className="m-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"><strong>Món đã sẵn sàng, đã báo nhân viên mang ra:</strong><ul className="mt-2">{sessionOrders.filter(i => i.status === 'READY').map(i => <li key={i.id}>{i.quantity} × {menuMap.get(i.menu_item_id)?.name ?? 'Món của bạn'}</li>)}</ul></div>}


      {/* Thông báo phản hồi */}
      {feedbackMessage && (
        <div
          className={cn(
            'mx-4 mt-3 p-3.5 rounded-2xl border text-xs font-medium flex items-center justify-between gap-2',
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50/70 border-emerald-500/40 text-emerald-800'
              : 'bg-red-50/70 border-red-500/40 text-red-800'
          )}
        >
          <span>{feedbackMessage.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="p-1"
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
          {!canOrderMore && (
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-800 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-800 shrink-0" />
              <span>
                Bàn đang chờ thanh toán. Vui lòng báo nhân viên nếu muốn gọi thêm mồi/bia.
              </span>
            </div>
          )}

          {/* Tìm kiếm & Lọc danh mục */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="h-4 w-4 text-muted-ink absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm món nhậu, bia, nước ngọt..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-line text-sm text-ink"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSelectedCategory(tab.key)}
                  className={cn(
                    'min-h-12 px-4 py-2 rounded-xl text-xs font-bold border shrink-0 transition-colors',
                    selectedCategory === tab.key
                      ? 'bg-amber-500 text-ink border-amber-500'
                      : 'bg-surface text-ink border-line'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Danh sách món ăn */}
          <div className="space-y-3">
            {filteredMenuItems.map((item) => {
              const inCartQty = cartItems
                .filter((c) => c.menu_item_id === item.id)
                .reduce((s, c) => s + c.quantity, 0);

              return (
                <div
                  key={item.id}
                  className={cn(
                    'p-3.5 rounded-2xl border bg-surface flex gap-3.5 items-center transition-all',
                    item.is_available
                      ? 'border-line'
                      : 'border-line/50 opacity-60'
                  )}
                >
                  <div className="h-20 w-20 rounded-xl bg-soft border border-line overflow-hidden shrink-0 flex items-center justify-center">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UtensilsCrossed className="h-6 w-6 text-ink" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {item.station === 'BAR_INSTANT' ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-800 text-[10px] font-bold">
                          Mang ra ngay
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-orange-500/15 text-orange-800 text-[10px] font-bold">
                          Bếp làm khi nhận món
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-sm text-ink mt-1 truncate">
                      {item.name}
                    </h3>

                    <div className="text-amber-800 font-extrabold text-sm mt-1">
                      {formatVND(item.price)}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {!item.is_available ? (
                      <span className="px-2.5 py-1.5 rounded-xl bg-red-500/15 text-red-800 border border-red-500/30 text-xs font-bold">
                        Tạm hết
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canOrderMore}
                        onClick={() =>
                          addItem({
                            menu_item_id: item.id,
                            name: item.name,
                            category: item.category,
                            station: item.station,
                            unit_price: item.price,
                            unit_cost_price: item.cost_price,
                            image_url: item.image_url,
                          })
                        }
                        className="min-h-12 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-ink font-extrabold text-xs inline-flex items-center gap-1.5 active:scale-95 transition-transform"
                      >
                        <Plus className="h-4 w-4" />
                        {inCartQty > 0 ? `Thêm (${inCartQty})` : 'Chọn'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: TIẾN ĐỘ BẾP REALTIME (VỊ TRÍ HÀNG ĐỢI MỤC 5.3 & ĐỒNG HỒ ĐẾM NGƯỢC) */}
      {/* ==================================================================== */}
      {activeTab === 'PROGRESS' && (
        <div className="p-4 space-y-4">
          <div className="p-3.5 rounded-2xl bg-surface border border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ChefHat className="h-5 w-5 text-amber-800" />
              <div>
                <h2 className="text-sm font-bold text-ink">
                  Trạng thái món ăn thời gian thực
                </h2>
                <p className="text-[11px] text-muted-ink">
                  Món xong sẽ tự báo ở đây. Nhân viên sẽ mang ra bàn.
                </p>
              </div>
            </div>
          </div>

          {sessionOrders.length === 0 ? (
            <div className="py-12 text-center bg-surface border border-line rounded-2xl text-muted-ink text-sm">
              Bàn chưa gọi món nào. Hãy qua tab Thực đơn để chọn mồi & bia nhé!
            </div>
          ) : (
            <div className="space-y-3">
              {sessionOrders.map((order) => {
                const menu = menuMap.get(order.menu_item_id);
                const queuePosition = order.status === 'QUEUED' && order.station === 'KITCHEN' ? getQueuePositionForOrderItem(order) : null;
                return (
                  <div
                    key={order.id}
                    className="p-4 rounded-2xl bg-surface border border-line space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-base text-ink">
                            {order.quantity}x {menu?.name ?? 'Món ăn'}
                          </span>
                          {order.batch_id && order.status === 'COOKING' && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 text-[10px] font-bold">
                              Nấu gộp mẻ nhanh
                            </span>
                          )}
                        </div>
                        {order.note && (
                          <p className="text-xs text-muted-ink mt-0.5">
                            Ghi chú: {order.note}
                          </p>
                        )}
                      </div>

                      {/* Nhãn trạng thái */}
                      {order.status === 'QUEUED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-800 border border-amber-500/30">
                          Bếp đã nhận món
                        </span>
                      )}
                      {order.status === 'COOKING' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-orange-500/20 text-orange-800 border border-orange-500/40 animate-pulse">
                          🔥 Bếp đang nấu
                        </span>
                      )}
                      {order.status === 'READY' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-800 border border-emerald-500/40">
                          ✨ Món đã chín
                        </span>
                      )}
                      {order.status === 'SERVED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-muted text-ink">
                          ✓ Đã lên bàn
                        </span>
                      )}
                      {order.status === 'CANCELLED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-800">
                          Đã hủy
                        </span>
                      )}
                    </div>

                    {/* Hiển thị chi tiết Vị trí hàng đợi (Mục 5.3) */}
                    {order.status === 'QUEUED' && queuePosition !== null && (
                      <div className="p-3 rounded-xl bg-soft border border-amber-500/30 flex items-center justify-between">
                        <div>
                          <span className="text-xs text-muted-ink block">
                            Vị trí trong hàng đợi Bếp toàn quán:
                          </span>
                          <span className="text-sm font-extrabold text-amber-800">
                            Đang xếp thứ #{queuePosition}
                          </span>
                        </div>
                      </div>
                    )}

                    {order.status === 'READY' && (
                      <div className="p-2.5 rounded-xl bg-emerald-50/40 border border-emerald-500/30 text-xs text-emerald-800 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 shrink-0" />
                        <span>
                          {order.station === 'BAR_INSTANT'
                            ? 'Đã báo nhân viên lấy đồ uống mang ra bàn!'
                            : 'Món đã xong, đã báo nhân viên mang ra bàn!'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: HÓA ĐƠN & CHIA TIỀN CAMPUCHIA + NÚT GỌI TÍNH TIỀN */}
      {/* ==================================================================== */}
      {activeTab === 'BILL' && (
        <div className="p-4 space-y-5">
          {/* Bảng kê hóa đơn tạm tính */}
          <div className="bg-surface border border-line rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="font-bold text-base text-ink">
                Chi tiết hóa đơn tại bàn
              </h2>
              <span className="text-xs text-muted-ink">
                {validBillOrders.length} lượt gọi
              </span>
            </div>

            {validBillOrders.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-ink">
                Chưa có món ăn nào trong hóa đơn.
              </p>
            ) : (
              <div className="divide-y divide-line/80 text-sm">
                {validBillOrders.map((item) => {
                  const menu = menuMap.get(item.menu_item_id);
                  return (
                    <div
                      key={item.id}
                      className="py-2.5 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-ink">
                          {item.quantity}x {menu?.name ?? 'Món gọi'}
                        </span>
                        <span className="block text-xs text-muted-ink">
                          Đơn giá: {formatVND(item.unit_price)}
                        </span>
                      </div>
                      <span className="font-bold text-ink">
                        {formatVND(item.unit_price * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-line flex items-center justify-between">
              <span className="text-sm font-bold text-ink">
                Tổng cộng tạm tính:
              </span>
              <span className="text-2xl font-black text-amber-800">
                {formatVND(liveBillTotalAmount)}
              </span>
            </div>
          </div>

          {/* Tiện ích Chia tiền Campuchia theo số người */}
          <div className="bg-surface border border-amber-500/30 rounded-2xl p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-800" />
              <div>
                <h3 className="font-bold text-sm text-ink">
                  Chia tiền Campuchia (Chia đều theo đầu người)
                </h3>
                <p className="text-xs text-muted-ink">
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
                  className="min-h-12 w-12 rounded-xl bg-muted hover:bg-stone-200 flex items-center justify-center text-ink font-bold"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="px-4 py-2 rounded-xl bg-soft border border-line text-center min-w-[90px]">
                  <span className="text-lg font-black text-amber-800">
                    {campuchiaCount}
                  </span>
                  <span className="text-xs text-muted-ink block">người</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCampuchiaCount((c) => c + 1)}
                  className="min-h-12 w-12 rounded-xl bg-muted hover:bg-stone-200 flex items-center justify-center text-ink font-bold"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="text-right">
                <span className="text-xs text-muted-ink block">
                  Mỗi người đóng:
                </span>
                <span className="text-xl font-black text-emerald-800">
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
                      ? 'bg-amber-500 text-ink border-amber-500'
                      : 'bg-soft text-muted-ink border-line'
                  )}
                >
                  {num} người
                </button>
              ))}
            </div>
          </div>

          {/* Khu vực Gọi tính tiền (US-C04) */}
          <div className="bg-surface border border-line rounded-2xl p-4 space-y-4">
            <h3 className="font-bold text-sm text-ink">
              Yêu cầu Thanh toán tại bàn
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedPaymentMethod('VIETQR')}
                className={cn(
                  'min-h-12 p-3 rounded-xl border text-xs font-bold',
                  selectedPaymentMethod === 'VIETQR'
                    ? 'bg-amber-500/20 text-amber-800 border-amber-500'
                    : 'bg-soft text-muted-ink border-line'
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
                    ? 'bg-amber-500/20 text-amber-800 border-amber-500'
                    : 'bg-soft text-muted-ink border-line'
                )}
              >
                Tiền mặt
              </button>
            </div>

            <button
              type="button"
              disabled={
                isSubmitting ||
                liveBillTotalAmount === 0 ||
                session.status === 'REQUEST_BILL'
              }
              onClick={handleRequestBill}
              className="min-h-12 w-full py-3.5 px-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-5 w-5" />
              {session.status === 'REQUEST_BILL'
                ? 'Đã gọi tính tiền • Nhân viên đang ra bàn'
                : 'Bấm Gọi Tính Tiền'}
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* THANH GIỎ HÀNG NỔI PHÍA DƯỚI MÀN HÌNH */}
      {/* ==================================================================== */}
      {totalCartItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-soft/95 backdrop-blur border-t border-line max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => setIsCartDrawerOpen(true)}
            className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-ink font-extrabold text-sm flex items-center justify-between shadow-lg"
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
      {isCartDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-end justify-center">
          <div className="bg-surface border-t border-line rounded-t-3xl max-w-lg w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-extrabold text-ink">
                Giỏ hàng của {table?.table_number ?? 'Bàn'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCartDrawerOpen(false)}
                className="p-1 text-muted-ink hover:text-ink"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-line space-y-3 pr-1">
              {cartItems.map((item) => (
                <div
                  key={`${item.menu_item_id}-${item.note}`}
                  className="pt-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-sm text-ink">
                        {item.name}
                      </h4>
                      <span className="text-xs font-semibold text-amber-800">
                        {formatVND(item.unit_price * item.quantity)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.menu_item_id,
                            item.quantity - 1,
                            item.note
                          )
                        }
                        className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-ink"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-7 text-center font-bold text-sm">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.menu_item_id,
                            item.quantity + 1,
                            item.note
                          )
                        }
                        className="h-9 w-9 rounded-xl bg-amber-500 text-ink flex items-center justify-center font-bold"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={item.note}
                    onChange={(e) =>
                      updateNote(item.menu_item_id, e.target.value)
                    }
                    placeholder="Ghi chú cho bếp (VD: ít cay, không hành...)"
                    className="w-full px-3 py-1.5 rounded-lg bg-soft border border-line text-xs text-ink"
                  />
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-line space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-ink">Tổng lượt gọi này:</span>
                <span className="text-xl font-black text-amber-800">
                  {formatVND(totalCartMoney)}
                </span>
              </div>

              <button
                type="button"
                disabled={isSubmitting || cooldownSeconds > 0 || !canOrderMore}
                onClick={handleSubmitOrder}
                className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <Send className="h-4 w-4" />
                {isSubmitting
                  ? 'Đang gửi thực đơn vào Bếp...'
                  : cooldownSeconds > 0
                  ? `Vui lòng đợi ${cooldownSeconds}s...`
                  : 'Xác nhận Đặt món ngay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL HIỆN QR CHO BẠN NHẬU CÙNG BÀN QUÉT CHUNG (US-C02) */}
      {/* ==================================================================== */}
      {isShareQrOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-amber-500/40 rounded-3xl max-w-sm w-full p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-800">
                Chia sẻ Phiên gọi món cùng bàn
              </span>
              <button
                type="button"
                onClick={() => setIsShareQrOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <h3 className="text-xl font-black text-ink">
              {table?.table_number ?? 'Bàn nhậu'}
            </h3>
            <p className="text-xs text-muted-ink">
              Đưa mã QR này cho bạn nhậu ngồi cùng bàn quét để cùng chọn mồi và xem tiến độ Bếp!
            </p>

            <div className="bg-white p-5 rounded-2xl inline-block mx-auto">
              <QRCodeSVG
                value={`${originUrl}/customer/order/${session.session_token}`}
                size={220}
                level="H"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
