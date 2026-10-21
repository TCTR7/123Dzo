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
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useCartStore } from '@/lib/store/useCartStore';
import {
  formatVND,
  formatDurationFromSeconds,
  cn,
} from '@/lib/utils';
import type {
  IngredientRow,
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
  initialGlobalKitchenQueue: OrderItemRow[];
  initialIngredients: IngredientRow[];
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
  initialIngredients,
}: DineInOrderViewProps) {
  const supabase = createSupabaseBrowserClient();

  const [session, setSession] = useState<TableSessionRow>(initialSession);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  const [sessionOrders, setSessionOrders] =
    useState<OrderItemRow[]>(initialSessionOrders);
  const [globalKitchenQueue, setGlobalKitchenQueue] = useState<OrderItemRow[]>(
    initialGlobalKitchenQueue
  );
  const [ingredients, setIngredients] =
    useState<IngredientRow[]>(initialIngredients);

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
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

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
      setNowMs(Date.now());
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemRow>();
    menuItems.forEach((m) => map.set(m.id, m));
    return map;
  }, [menuItems]);

  const ingredientMap = useMemo(() => {
    const map = new Map<string, IngredientRow>();
    ingredients.forEach((i) => map.set(i.id, i));
    return map;
  }, [ingredients]);

  // ==========================================================================
  // LẮNG NGHE SUPABASE REALTIME (ORDER_ITEMS, TABLE_SESSIONS, MENU_ITEMS)
  // Bắt buộc removeChannel trong cleanup của useEffect (Mục 2.2 AGENTS.md)
  // ==========================================================================
  useEffect(() => {
    const channel = supabase
      .channel(`dine-in-session-${initialSession.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = payload.new as OrderItemRow;
            if (newItem.session_id === initialSession.id) {
              setSessionOrders((prev) => {
                if (prev.some((i) => i.id === newItem.id)) return prev;
                return [newItem, ...prev];
              });
            }
            if (
              newItem.station === 'KITCHEN' &&
              newItem.status === 'QUEUED'
            ) {
              setGlobalKitchenQueue((prev) => {
                if (prev.some((i) => i.id === newItem.id)) return prev;
                return [...prev, newItem];
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = payload.new as OrderItemRow;
            if (updatedItem.session_id === initialSession.id) {
              setSessionOrders((prev) =>
                prev.map((i) => (i.id === updatedItem.id ? updatedItem : i))
              );
            }
            setGlobalKitchenQueue((prev) => {
              const exists = prev.some((i) => i.id === updatedItem.id);
              if (
                updatedItem.station === 'KITCHEN' &&
                updatedItem.status === 'QUEUED'
              ) {
                return exists
                  ? prev.map((i) =>
                      i.id === updatedItem.id ? updatedItem : i
                    )
                  : [...prev, updatedItem];
              }
              return prev.filter((i) => i.id !== updatedItem.id);
            });
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string }).id;
            if (deletedId) {
              setSessionOrders((prev) =>
                prev.filter((i) => i.id !== deletedId)
              );
              setGlobalKitchenQueue((prev) =>
                prev.filter((i) => i.id !== deletedId)
              );
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'table_sessions',
          filter: `id=eq.${initialSession.id}`,
        },
        (payload) => {
          const updatedSession = payload.new as TableSessionRow;
          setSession(updatedSession);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'menu_items',
        },
        (payload) => {
          const updatedMenu = payload.new as MenuItemRow;
          setMenuItems((prev) =>
            prev.map((m) => (m.id === updatedMenu.id ? updatedMenu : m))
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, initialSession.id]);

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
      // 1. KIỂM TRA BẢO MẬT ANTI-FRAUD (Mục 3.2 AGENTS.md):
      // Bắt buộc kiểm tra trực tiếp trên DB xem table_sessions.status === 'ACTIVE'
      const { data: freshSession, error: sessionError } = await supabase
        .from('table_sessions')
        .select('*')
        .eq('id', session.id)
        .eq('session_token', session.session_token)
        .single();

      if (sessionError || !freshSession) {
        throw new Error('Phiên gọi món không hợp lệ hoặc không tồn tại.');
      }

      if (freshSession.status !== 'ACTIVE') {
        setSession(freshSession);
        throw new Error(
          freshSession.status === 'CLOSED'
            ? 'Phiên bàn này đã đóng thanh toán. Mã QR đã hết hiệu lực.'
            : 'Bàn đang chờ thanh toán hoặc chưa kích hoạt, không thể gọi thêm món.'
        );
      }

      // 2. Lấy dữ liệu menu_items mới nhất từ DB để lấy đúng Snapshot Price và kiểm tra 86ing
      const cartMenuIds = cartItems.map((c) => c.menu_item_id);
      const { data: freshMenuItems, error: menuErr } = await supabase
        .from('menu_items')
        .select('*')
        .in('id', cartMenuIds);

      if (menuErr || !freshMenuItems) {
        throw new Error('Không thể kiểm tra thực đơn mới nhất.');
      }

      const freshMenuMap = new Map<string, MenuItemRow>();
      freshMenuItems.forEach((m) => freshMenuMap.set(m.id, m));

      for (const c of cartItems) {
        const dbMenu = freshMenuMap.get(c.menu_item_id);
        if (!dbMenu || !dbMenu.is_available) {
          throw new Error(
            `Món "${c.name}" vừa tạm hết hàng (86). Vui lòng xóa khỏi giỏ hàng.`
          );
        }
      }

      const nowIso = new Date().toISOString();

      // 3. Chuẩn bị danh sách order_items:
      // - Snapshot Price: copy price -> unit_price, cost_price -> unit_cost_price
      // - Phân luồng: BAR_INSTANT -> status = 'READY', ready_at = NOW()
      //               KITCHEN -> status = 'QUEUED', ready_at = null
      const rowsToInsert = cartItems.map((c) => {
        const dbMenu = freshMenuMap.get(c.menu_item_id)!;
        const isBarInstant = dbMenu.station === 'BAR_INSTANT';

        return {
          session_id: freshSession.id,
          menu_item_id: dbMenu.id,
          quantity: c.quantity,
          note: c.note.trim() || null,
          station: dbMenu.station,
          status: isBarInstant ? ('READY' as const) : ('QUEUED' as const),
          unit_price: dbMenu.price,
          unit_cost_price: dbMenu.cost_price,
          created_at: nowIso,
          ready_at: isBarInstant ? nowIso : null,
        };
      });

      const { data: insertedOrders, error: insertError } = await supabase
        .from('order_items')
        .insert(rowsToInsert)
        .select('*');

      if (insertError || !insertedOrders) {
        throw new Error(
          insertError?.message ?? 'Không thể gửi đơn gọi món vào hệ thống.'
        );
      }

      // 4. Tự động trừ kho nguyên liệu nếu món có linked_ingredient_id và gọi thông báo nếu là BAR_INSTANT
      for (const inserted of insertedOrders) {
        const dbMenu = freshMenuMap.get(inserted.menu_item_id);
        if (dbMenu?.linked_ingredient_id) {
          const ing = ingredientMap.get(dbMenu.linked_ingredient_id);
          if (ing) {
            const newStock = Math.max(
              0,
              ing.stock_quantity - inserted.quantity
            );
            const { data: updatedIng } = await supabase
              .from('ingredients')
              .update({ stock_quantity: newStock })
              .eq('id', ing.id)
              .select('*')
              .single();

            if (updatedIng) {
              setIngredients((prev) =>
                prev.map((item) =>
                  item.id === updatedIng.id ? updatedIng : item
                )
              );
            }

            await supabase.from('inventory_logs').insert({
              ingredient_id: ing.id,
              type: 'EXPORT_SALE',
              quantity_change: -inserted.quantity,
              total_cost: inserted.quantity * ing.unit_cost,
              note: `Khách đặt tại ${table?.table_number ?? 'Bàn'}: ${
                inserted.quantity
              }x ${dbMenu.name}`,
              created_by: freshSession.assigned_staff_id,
            });
          }
        }

        if (inserted.station === 'BAR_INSTANT') {
          void fetch('/api/push/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderItemId: inserted.id,
              sessionId: freshSession.id,
              title: `${table?.table_number ?? 'Bàn'}: Khách gọi đồ uống lấy ngay`,
              body: `${inserted.quantity}x ${dbMenu?.name ?? 'Đồ uống'}`,
            }),
          }).catch(() => undefined);
        }
      }

      // 5. Cập nhật tổng tiền tạm tính trên table_sessions
      const addedSum = insertedOrders.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0
      );
      const updatedTotal = liveBillTotalAmount + addedSum;

      const { data: updatedSessionData } = await supabase
        .from('table_sessions')
        .update({ total_amount: updatedTotal })
        .eq('id', freshSession.id)
        .select('*')
        .single();

      if (updatedSessionData) {
        setSession(updatedSessionData);
      }

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
      const { data, error } = await supabase
        .from('table_sessions')
        .update({
          status: 'REQUEST_BILL',
          payment_method: selectedPaymentMethod,
          total_amount: liveBillTotalAmount,
        })
        .eq('id', session.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(
          error?.message ?? 'Không thể gửi yêu cầu gọi tính tiền.'
        );
      }

      setSession(data);

      void fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          title: `${table?.table_number ?? 'Bàn'} gọi tính tiền!`,
          body: `Tổng: ${formatVND(liveBillTotalAmount)} (${selectedPaymentMethod})`,
        }),
      }).catch(() => undefined);

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
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold text-zinc-100">
            {session.status === 'CLOSED'
              ? 'Phiên nhậu đã kết thúc'
              : 'Phiên bàn chưa kích hoạt'}
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-28 max-w-lg mx-auto border-x border-zinc-900">
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
              123Dzô • Thực đơn & Tiến độ Bếp
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

        {/* Thanh chuyển đổi 3 Tab (Thực đơn | Tiến độ Bếp | Hóa đơn) */}
        <div className="grid grid-cols-3 gap-1.5 bg-zinc-900 p-1 rounded-2xl border border-zinc-800">
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
                ? 'bg-amber-500 text-zinc-950 shadow'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <Receipt className="h-4 w-4" />
            Hóa đơn ({validBillOrders.length})
          </button>
        </div>
      </header>

      {/* Thông báo phản hồi */}
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
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                Bàn đang gửi yêu cầu thanh toán (`REQUEST_BILL`). Vui lòng báo nhân viên nếu muốn gọi thêm mồi/bia.
              </span>
            </div>
          )}

          {/* Tìm kiếm & Lọc danh mục */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="h-4 w-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm món nhậu, bia, nước ngọt..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100"
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
                      ? 'bg-amber-500 text-zinc-950 border-amber-500'
                      : 'bg-zinc-900 text-zinc-300 border-zinc-800'
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
                    'p-3.5 rounded-2xl border bg-zinc-900 flex gap-3.5 items-center transition-all',
                    item.is_available
                      ? 'border-zinc-800'
                      : 'border-zinc-800/50 opacity-60'
                  )}
                >
                  <div className="h-20 w-20 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UtensilsCrossed className="h-6 w-6 text-zinc-700" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {item.station === 'BAR_INSTANT' ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-bold">
                          Mang ra ngay
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 text-[10px] font-bold">
                          ~{item.prep_time_minutes} phút
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-sm text-zinc-100 mt-1 truncate">
                      {item.name}
                    </h3>

                    <div className="text-amber-400 font-extrabold text-sm mt-1">
                      {formatVND(item.price)}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {!item.is_available ? (
                      <span className="px-2.5 py-1.5 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-bold">
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
                        className="min-h-12 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-extrabold text-xs inline-flex items-center gap-1.5 active:scale-95 transition-transform"
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
          <div className="p-3.5 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ChefHat className="h-5 w-5 text-amber-400" />
              <div>
                <h2 className="text-sm font-bold text-zinc-100">
                  Trạng thái món ăn thời gian thực
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Tự động cập nhật vị trí xếp hàng trong Bếp & đồng hồ nấu
                </p>
              </div>
            </div>
          </div>

          {sessionOrders.length === 0 ? (
            <div className="py-12 text-center bg-zinc-900 border border-zinc-800 rounded-2xl text-zinc-500 text-sm">
              Bàn chưa gọi món nào. Hãy qua tab Thực đơn để chọn mồi & bia nhé!
            </div>
          ) : (
            <div className="space-y-3">
              {sessionOrders.map((order) => {
                const menu = menuMap.get(order.menu_item_id);
                const prepMinutes = menu?.prep_time_minutes ?? 10;

                // Tính vị trí hàng đợi theo đúng công thức Mục 5.3 nếu đang QUEUED ở KITCHEN
                const queuePosition =
                  order.status === 'QUEUED' && order.station === 'KITCHEN'
                    ? getQueuePositionForOrderItem(order)
                    : null;

                // Tính đồng hồ đếm ngược thời gian nấu khi status === 'COOKING'
                let remainingCookSeconds = 0;
                let progressPercent = 0;
                if (order.status === 'COOKING' && order.cooking_started_at) {
                  const startedMs = new Date(
                    order.cooking_started_at
                  ).getTime();
                  const totalPrepSeconds = Math.max(60, prepMinutes * 60);
                  const elapsedSeconds = Math.max(
                    0,
                    Math.floor((nowMs - startedMs) / 1000)
                  );
                  remainingCookSeconds = Math.max(
                    0,
                    totalPrepSeconds - elapsedSeconds
                  );
                  progressPercent = Math.min(
                    100,
                    Math.round((elapsedSeconds / totalPrepSeconds) * 100)
                  );
                }

                // Ước lượng số phút hoàn thành khi đang QUEUED
                const estimatedWaitMinutes =
                  queuePosition !== null
                    ? Math.max(
                        prepMinutes,
                        Math.ceil(queuePosition * (prepMinutes * 0.6))
                      )
                    : 0;

                return (
                  <div
                    key={order.id}
                    className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-base text-zinc-100">
                            {order.quantity}x {menu?.name ?? 'Món ăn'}
                          </span>
                          {order.batch_id && order.status === 'COOKING' && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                              Nấu gộp mẻ nhanh
                            </span>
                          )}
                        </div>
                        {order.note && (
                          <p className="text-xs text-zinc-400 mt-0.5">
                            Ghi chú: {order.note}
                          </p>
                        )}
                      </div>

                      {/* Nhãn trạng thái */}
                      {order.status === 'QUEUED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Đang chờ bếp
                        </span>
                      )}
                      {order.status === 'COOKING' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40 animate-pulse">
                          🔥 Bếp đang nấu
                        </span>
                      )}
                      {order.status === 'READY' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          ✨ Món đã chín
                        </span>
                      )}
                      {order.status === 'SERVED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-300">
                          ✓ Đã lên bàn
                        </span>
                      )}
                      {order.status === 'CANCELLED' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400">
                          Đã hủy
                        </span>
                      )}
                    </div>

                    {/* Hiển thị chi tiết Vị trí hàng đợi (Mục 5.3) */}
                    {order.status === 'QUEUED' && queuePosition !== null && (
                      <div className="p-3 rounded-xl bg-zinc-950 border border-amber-500/30 flex items-center justify-between">
                        <div>
                          <span className="text-xs text-zinc-400 block">
                            Vị trí trong hàng đợi Bếp toàn quán:
                          </span>
                          <span className="text-sm font-extrabold text-amber-400">
                            Đang xếp thứ #{queuePosition}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-zinc-400 block">
                            Dự kiến hoàn thành
                          </span>
                          <span className="text-sm font-bold text-zinc-200">
                            ~{estimatedWaitMinutes} phút nữa
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Hiển thị Đồng hồ đếm ngược thời gian nấu khi COOKING */}
                    {order.status === 'COOKING' && (
                      <div className="p-3 rounded-xl bg-zinc-950 border border-orange-500/40 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-orange-300 font-semibold inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            Thời gian nấu còn lại:
                          </span>
                          <span className="font-mono text-base font-black text-amber-400">
                            {remainingCookSeconds > 0
                              ? formatDurationFromSeconds(remainingCookSeconds)
                              : 'Sắp ra đĩa!'}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {order.status === 'READY' && (
                      <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 shrink-0" />
                        <span>
                          {order.station === 'BAR_INSTANT'
                            ? 'Đã báo nhân viên lấy đồ uống mang ra bàn!'
                            : 'Đầu bếp đã nấu xong, nhân viên đang bưng ra bàn!'}
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 className="font-bold text-base text-zinc-100">
                Chi tiết hóa đơn tại bàn
              </h2>
              <span className="text-xs text-zinc-400">
                {validBillOrders.length} lượt gọi
              </span>
            </div>

            {validBillOrders.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                Chưa có món ăn nào trong hóa đơn.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/80 text-sm">
                {validBillOrders.map((item) => {
                  const menu = menuMap.get(item.menu_item_id);
                  return (
                    <div
                      key={item.id}
                      className="py-2.5 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-zinc-100">
                          {item.quantity}x {menu?.name ?? 'Món gọi'}
                        </span>
                        <span className="block text-xs text-zinc-500">
                          Đơn giá: {formatVND(item.unit_price)}
                        </span>
                      </div>
                      <span className="font-bold text-zinc-100">
                        {formatVND(item.unit_price * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-300">
                Tổng cộng tạm tính:
              </span>
              <span className="text-2xl font-black text-amber-400">
                {formatVND(liveBillTotalAmount)}
              </span>
            </div>
          </div>

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
                Chuyển khoản QR (VIETQR)
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
                Tiền mặt (CASH)
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
              className="min-h-12 w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
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
        <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 max-w-lg mx-auto">
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
      {isCartDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center">
          <div className="bg-zinc-900 border-t border-zinc-800 rounded-t-3xl max-w-lg w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-extrabold text-zinc-100">
                Giỏ hàng của {table?.table_number ?? 'Bàn'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCartDrawerOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800 space-y-3 pr-1">
              {cartItems.map((item) => (
                <div
                  key={`${item.menu_item_id}-${item.note}`}
                  className="pt-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-sm text-zinc-100">
                        {item.name}
                      </h4>
                      <span className="text-xs font-semibold text-amber-400">
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
                        className="h-9 w-9 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-200"
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
                        className="h-9 w-9 rounded-xl bg-amber-500 text-zinc-950 flex items-center justify-center font-bold"
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
                    className="w-full px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                  />
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Tổng lượt gọi này:</span>
                <span className="text-xl font-black text-amber-400">
                  {formatVND(totalCartMoney)}
                </span>
              </div>

              <button
                type="button"
                disabled={isSubmitting || cooldownSeconds > 0 || !canOrderMore}
                onClick={handleSubmitOrder}
                className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-amber-500/40 rounded-3xl max-w-sm w-full p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">
                Chia sẻ Phiên gọi món cùng bàn
              </span>
              <button
                type="button"
                onClick={() => setIsShareQrOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <h3 className="text-xl font-black text-zinc-100">
              {table?.table_number ?? 'Bàn nhậu'}
            </h3>
            <p className="text-xs text-zinc-400">
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
