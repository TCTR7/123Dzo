'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ShoppingBag,
  UtensilsCrossed,
  Search,
  Phone,
  User,
  QrCode,
  CheckCircle2,
  Clock,
  Flame,
  Plus,
  Minus,
  Copy,
  Sparkles,
  History,
  X,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatVND, cn } from '@/lib/utils';
import type {
  MenuCategory,
  MenuItemRow,
  OrderItemRow,
  TableSessionRow,
} from '@/types/database.types';

interface TakeawayOrderViewProps {
  initialMenuItems: MenuItemRow[];
}

interface LocalTakeawayCartItem {
  menuItem: MenuItemRow;
  quantity: number;
  note: string;
}

interface StoredTakeawayRecord {
  sessionId: string;
  sessionToken: string;
  paymentCode: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  openedAt: string;
}

const TAKEAWAY_STORAGE_KEY = '123dzo-takeaway-orders-by-phone';
const COOLDOWN_SECONDS = 5;

const VIETQR_BANK_ID =
  process.env.NEXT_PUBLIC_VIETQR_BANK_ID ?? 'MB';
const VIETQR_ACCOUNT_NO =
  process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO ?? '0987654321';
const VIETQR_ACCOUNT_NAME =
  process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME ?? 'QUAN NHAU 123DZO';

function generateTakeawayToken(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let token = 'tw_';
  for (let i = 0; i < 10; i += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function generatePaymentCode(): string {
  const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  return `DZO${timePart}${randomSuffix}`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

export function TakeawayOrderView({
  initialMenuItems,
}: TakeawayOrderViewProps) {
  const supabase = createSupabaseBrowserClient();

  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  const [activeView, setActiveView] = useState<'ORDER' | 'LOOKUP'>('ORDER');
  const [selectedCategory, setSelectedCategory] = useState<
    MenuCategory | 'ALL'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Giỏ hàng đặt mang về
  const [cart, setCart] = useState<LocalTakeawayCartItem[]>([]);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');

  // Phiên đơn hàng mang về đang theo dõi
  const [currentSession, setCurrentSession] =
    useState<TableSessionRow | null>(null);
  const [currentOrderItems, setCurrentOrderItems] = useState<OrderItemRow[]>(
    []
  );

  // Ô tra cứu đơn hàng bằng SĐT từ localStorage & Supabase
  const [lookupPhone, setLookupPhone] = useState<string>('');
  const [savedRecords, setSavedRecords] = useState<StoredTakeawayRecord[]>([]);
  const [lookedUpSessions, setLookedUpSessions] = useState<TableSessionRow[]>(
    []
  );

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const lastSubmitRef = useRef<number>(0);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemRow>();
    menuItems.forEach((m) => map.set(m.id, m));
    return map;
  }, [menuItems]);

  // Đọc danh sách đơn mang về đã lưu trong localStorage khi mở trang
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(TAKEAWAY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredTakeawayRecord[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSavedRecords(parsed);
          const latest = parsed[0];
          if (latest) {
            setLookupPhone(latest.customerPhone);
            setCustomerPhone(latest.customerPhone);
            setCustomerName(latest.customerName);
          }
        }
      }
    } catch {
      // Bỏ qua nếu localStorage trống hoặc lỗi parse
    }
  }, []);

  // Bộ đếm ngược Cooldown chống bấm đúp
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // ==========================================================================
  // LẮNG NGHE SUPABASE REALTIME CHO PHIÊN MANG VỀ ĐANG THEO DÕI
  // Bắt buộc removeChannel trong cleanup của useEffect (Mục 2.2 AGENTS.md)
  // ==========================================================================
  useEffect(() => {
    if (!currentSession) return;

    const channel = supabase
      .channel(`takeaway-session-${currentSession.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'table_sessions',
          filter: `id=eq.${currentSession.id}`,
        },
        (payload) => {
          const updated = payload.new as TableSessionRow;
          setCurrentSession(updated);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items',
          filter: `session_id=eq.${currentSession.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newItem = payload.new as OrderItemRow;
            setCurrentOrderItems((prev) => {
              if (prev.some((i) => i.id === newItem.id)) return prev;
              return [...prev, newItem];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedItem = payload.new as OrderItemRow;
            setCurrentOrderItems((prev) =>
              prev.map((i) => (i.id === updatedItem.id ? updatedItem : i))
            );
          }
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
  }, [supabase, currentSession]);

  function saveOrderToLocalStorage(record: StoredTakeawayRecord) {
    if (typeof window === 'undefined') return;
    try {
      const next = [
        record,
        ...savedRecords.filter((r) => r.sessionId !== record.sessionId),
      ].slice(0, 20);
      setSavedRecords(next);
      window.localStorage.setItem(TAKEAWAY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Bỏ qua lỗi quota localStorage
    }
  }

  function handleAddToCart(menuItem: MenuItemRow) {
    if (!menuItem.is_available) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.menuItem.id === menuItem.id);
      if (idx > -1) {
        const updated = [...prev];
        const current = updated[idx];
        if (current) {
          updated[idx] = { ...current, quantity: current.quantity + 1 };
        }
        return updated;
      }
      return [...prev, { menuItem, quantity: 1, note: '' }];
    });
  }

  function handleUpdateCartQuantity(menuItemId: string, nextQty: number) {
    setCart((prev) => {
      if (nextQty <= 0) {
        return prev.filter((c) => c.menuItem.id !== menuItemId);
      }
      return prev.map((c) =>
        c.menuItem.id === menuItemId ? { ...c, quantity: nextQty } : c
      );
    });
  }

  function handleUpdateCartNote(menuItemId: string, note: string) {
    setCart((prev) =>
      prev.map((c) =>
        c.menuItem.id === menuItemId ? { ...c, note } : c
      )
    );
  }

  const totalCartAmount = useMemo(
    () =>
      cart.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0),
    [cart]
  );

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

  // ==========================================================================
  // TẠO ĐƠN MANG VỀ (SESSION_TYPE = 'TAKEAWAY', STATUS = 'PENDING_PAYMENT')
  // Đơn PENDING_PAYMENT hoàn toàn KHÔNG xuất hiện trên màn hình Bếp cho tới khi Webhook xác nhận
  // ==========================================================================
  async function handleCreateTakeawayOrder(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    if (isSubmitting || cart.length === 0) return;

    const now = Date.now();
    if (
      cooldownSeconds > 0 ||
      now - lastSubmitRef.current < COOLDOWN_SECONDS * 1000
    ) {
      setErrorMessage(
        `Vui lòng đợi ${cooldownSeconds || COOLDOWN_SECONDS} giây trước khi gửi lại.`
      );
      return;
    }

    const trimmedName = customerName.trim();
    const cleanedPhone = normalizePhone(customerPhone);

    if (!trimmedName) {
      setErrorMessage('Vui lòng nhập tên của bạn để quán tiện xưng hô.');
      return;
    }

    if (cleanedPhone.length < 9 || cleanedPhone.length > 12) {
      setErrorMessage('Vui lòng nhập số điện thoại hợp lệ (9 - 11 chữ số).');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Kiểm tra lại giá và trạng thái còn hàng (is_available) từ bảng menu_items
      const menuIds = cart.map((c) => c.menuItem.id);
      const { data: freshMenus, error: menuErr } = await supabase
        .from('menu_items')
        .select('*')
        .in('id', menuIds);

      if (menuErr || !freshMenus) {
        throw new Error('Không thể kiểm tra thực đơn hiện tại.');
      }

      const freshMenuMap = new Map<string, MenuItemRow>();
      freshMenus.forEach((m) => freshMenuMap.set(m.id, m));

      let verifiedTotalAmount = 0;
      for (const c of cart) {
        const dbMenu = freshMenuMap.get(c.menuItem.id);
        if (!dbMenu || !dbMenu.is_available) {
          throw new Error(
            `Món "${c.menuItem.name}" vừa tạm hết hàng. Vui lòng chọn món khác.`
          );
        }
        verifiedTotalAmount += dbMenu.price * c.quantity;
      }

      const sessionToken = generateTakeawayToken();
      const paymentCode = generatePaymentCode();
      const nowIso = new Date().toISOString();

      // 1. Tạo table_sessions với session_type = 'TAKEAWAY' và status = 'PENDING_PAYMENT'
      const { data: createdSession, error: sessionErr } = await supabase
        .from('table_sessions')
        .insert({
          session_token: sessionToken,
          session_type: 'TAKEAWAY',
          table_id: null,
          assigned_staff_id: null,
          customer_name: trimmedName,
          customer_phone: cleanedPhone,
          status: 'PENDING_PAYMENT',
          payment_method: 'VIETQR',
          payment_code: paymentCode,
          total_amount: verifiedTotalAmount,
          opened_at: nowIso,
        })
        .select('*')
        .single();

      if (sessionErr || !createdSession) {
        throw new Error(
          sessionErr?.message ?? 'Không thể khởi tạo đơn đặt mang về.'
        );
      }

      // 2. Tạo các dòng order_items kèm Snapshot Price (unit_price, unit_cost_price)
      // Lưu ý: Do table_sessions.status === 'PENDING_PAYMENT', màn hình Bếp (/kitchen) chặn hoàn toàn
      // và chỉ hiển thị khi Webhook /api/webhooks/payment chuyển phiên sang ACTIVE
      const orderPayloads = cart.map((c) => {
        const dbMenu = freshMenuMap.get(c.menuItem.id)!;
        return {
          session_id: createdSession.id,
          menu_item_id: dbMenu.id,
          quantity: c.quantity,
          note: c.note.trim() || null,
          station: dbMenu.station,
          status: 'QUEUED' as const,
          unit_price: dbMenu.price,
          unit_cost_price: dbMenu.cost_price,
          created_at: nowIso,
        };
      });

      const { data: insertedItems, error: itemsErr } = await supabase
        .from('order_items')
        .insert(orderPayloads)
        .select('*');

      if (itemsErr || !insertedItems) {
        throw new Error(
          itemsErr?.message ?? 'Không thể lưu danh sách món mang về.'
        );
      }

      // 3. Lưu thông tin đơn vào localStorage theo SĐT để khách tra cứu lại bất cứ lúc nào
      saveOrderToLocalStorage({
        sessionId: createdSession.id,
        sessionToken: createdSession.session_token,
        paymentCode: createdSession.payment_code ?? paymentCode,
        customerName: trimmedName,
        customerPhone: cleanedPhone,
        totalAmount: verifiedTotalAmount,
        openedAt: nowIso,
      });

      lastSubmitRef.current = Date.now();
      setCooldownSeconds(COOLDOWN_SECONDS);
      setCurrentSession(createdSession);
      setCurrentOrderItems(insertedItems);
      setCart([]);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi tạo đơn đặt mang về.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // TRA CỨU ĐƠN HÀNG BẰNG SỐ ĐIỆN THOẠI TỪ LOCALSTORAGE & SUPABASE
  // ==========================================================================
  async function handleLookupByPhone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cleaned = normalizePhone(lookupPhone);
    if (!cleaned) {
      setErrorMessage('Vui lòng nhập số điện thoại cần tra cứu.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Kết hợp các sessionId đã lưu trong localStorage của SĐT này và truy vấn trực tiếp theo customer_phone
      const localMatchingIds = savedRecords
        .filter((r) => normalizePhone(r.customerPhone) === cleaned)
        .map((r) => r.sessionId);

      let query = supabase
        .from('table_sessions')
        .select('*')
        .eq('session_type', 'TAKEAWAY')
        .order('opened_at', { ascending: false })
        .limit(10);

      if (localMatchingIds.length > 0) {
        query = query.or(
          `customer_phone.eq.${cleaned},id.in.(${localMatchingIds.join(',')})`
        );
      } else {
        query = query.eq('customer_phone', cleaned);
      }

      const { data: sessionsData, error } = await query;
      if (error) {
        throw new Error(error.message);
      }

      setLookedUpSessions(sessionsData ?? []);

      if (sessionsData && sessionsData.length > 0) {
        const latest = sessionsData[0]!;
        await handleSelectSessionToTrack(latest);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Không thể tra cứu đơn hàng.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSelectSessionToTrack(targetSession: TableSessionRow) {
    setCurrentSession(targetSession);
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('session_id', targetSession.id)
      .order('created_at', { ascending: true });

    setCurrentOrderItems(items ?? []);
  }

  const vietQrImageUrl = useMemo(() => {
    if (!currentSession || !currentSession.payment_code) return null;
    const amount = Math.round(currentSession.total_amount);
    const info = encodeURIComponent(currentSession.payment_code);
    const accName = encodeURIComponent(VIETQR_ACCOUNT_NAME);
    return `https://img.vietqr.io/image/${VIETQR_BANK_ID}-${VIETQR_ACCOUNT_NO}-compact2.png?amount=${amount}&addInfo=${info}&accountName=${accName}`;
  }, [currentSession]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 max-w-2xl mx-auto border-x border-zinc-900 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-zinc-950 text-xs font-extrabold">
              123Dzô • Đặt Mang Về
            </span>
            <h1 className="text-lg font-black text-zinc-100 mt-1">
              Thanh toán VietQR • Theo dõi Bếp Realtime
            </h1>
          </div>
        </div>

        {/* Chuyển đổi giữa Đặt đơn mới & Tra cứu đơn bằng SĐT */}
        <div className="grid grid-cols-2 gap-2 bg-zinc-900 p-1 rounded-2xl border border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveView('ORDER')}
            className={cn(
              'min-h-12 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all',
              activeView === 'ORDER'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <UtensilsCrossed className="h-4 w-4" />
            Chọn món đặt mang về
          </button>
          <button
            type="button"
            onClick={() => setActiveView('LOOKUP')}
            className={cn(
              'min-h-12 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all',
              activeView === 'LOOKUP'
                ? 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            <History className="h-4 w-4" />
            Tra cứu đơn bằng SĐT ({savedRecords.length})
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="mx-4 mt-4 p-3.5 rounded-2xl bg-red-950/70 border border-red-500/40 text-red-200 text-xs flex items-center justify-between">
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

      {/* ==================================================================== */}
      {/* KHU VỰC HIỂN THỊ MÃ VIETQR ĐỘNG & TIẾN ĐỘ ĐƠN ĐANG THEO DÕI */}
      {/* ==================================================================== */}
      {currentSession && (
        <section className="m-4 p-5 rounded-3xl bg-zinc-900 border border-amber-500/40 space-y-4">
          <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
            <div>
              <span className="text-xs text-zinc-400">
                Mã đơn mang về:{' '}
                <strong className="text-amber-400 font-mono">
                  {currentSession.payment_code}
                </strong>
              </span>
              <h2 className="text-lg font-black text-zinc-100 mt-0.5">
                Khách hàng: {currentSession.customer_name} (
                {currentSession.customer_phone})
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setCurrentSession(null)}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline"
            >
              Đặt đơn khác
            </button>
          </div>

          {currentSession.status === 'PENDING_PAYMENT' ? (
            <div className="space-y-4 text-center">
              <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs">
                Quét mã <strong>VietQR</strong> bên dưới để thanh toán{' '}
                <strong>{formatVND(currentSession.total_amount)}</strong>. Ngay
                sau khi bạn chuyển khoản, <strong>Chủ quán</strong> xác nhận đã
                nhận tiền là đơn hàng sẽ lập tức chuyển sang{' '}
                <strong>ACTIVE</strong> và đẩy thẳng vào Bếp chế biến!
              </div>

              <div className="bg-white p-4 rounded-2xl inline-block mx-auto shadow-lg">
                {vietQrImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={vietQrImageUrl}
                    alt="Mã thanh toán VietQR động"
                    className="w-64 h-auto mx-auto rounded-lg"
                  />
                ) : (
                  <QRCodeSVG
                    value={currentSession.payment_code ?? ''}
                    size={220}
                  />
                )}
              </div>

              <div className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-left space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Số tiền chuyển khoản:</span>
                  <span className="font-black text-base text-amber-400">
                    {formatVND(currentSession.total_amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">
                    Nội dung chuyển khoản (Bắt buộc):
                  </span>
                  <div className="flex items-center gap-1.5">
                    <code className="px-2 py-1 rounded bg-zinc-900 text-emerald-400 font-bold">
                      {currentSession.payment_code}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        if (currentSession.payment_code) {
                          void navigator.clipboard.writeText(
                            currentSession.payment_code
                          );
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 2000);
                        }
                      }}
                      className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {copiedCode && (
                  <p className="text-[11px] text-emerald-400 text-right">
                    Đã sao chép mã nội dung chuyển khoản!
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <strong className="block text-sm text-emerald-300">
                    Đã nhận thanh toán VietQR thành công!
                  </strong>
                  <span>
                    Đơn hàng của bạn đã được đẩy vào Bếp chế biến. Theo dõi tiến độ từng món bên dưới để canh giờ ghé quán lấy đồ nhé!
                  </span>
                </div>
              </div>

              <div className="divide-y divide-zinc-800 text-sm">
                {currentOrderItems.map((item) => {
                  const menu = menuMap.get(item.menu_item_id);
                  return (
                    <div
                      key={item.id}
                      className="py-3 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-zinc-100">
                          {item.quantity}x {menu?.name ?? 'Món ăn'}
                        </span>
                        {item.note && (
                          <span className="block text-xs text-zinc-400">
                            Ghi chú: {item.note}
                          </span>
                        )}
                      </div>

                      {item.status === 'QUEUED' && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Đang chờ bếp
                        </span>
                      )}
                      {item.status === 'COOKING' && (
                        <span className="px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-300 text-xs font-bold inline-flex items-center gap-1 animate-pulse">
                          <Flame className="h-3.5 w-3.5" />
                          Bếp đang nấu
                        </span>
                      )}
                      {item.status === 'READY' && (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold inline-flex items-center gap-1">
                          <Sparkles className="h-3.5 w-3.5" />
                          Đã xong • Mời ghé lấy!
                        </span>
                      )}
                      {item.status === 'SERVED' && (
                        <span className="px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 text-xs font-bold">
                          Đã giao khách
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ==================================================================== */}
      {/* VIEW 1: CHỌN MÓN & ĐẶT MANG VỀ */}
      {/* ==================================================================== */}
      {activeView === 'ORDER' && (
        <div className="p-4 space-y-5">
          {/* Tìm kiếm & Lọc danh mục */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="h-4 w-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mồi nhậu, bia mang về..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {(
                [
                  { key: 'ALL', label: 'Tất cả' },
                  { key: 'FOOD', label: 'Mồi nhậu' },
                  { key: 'BEER', label: 'Bia' },
                  { key: 'DRINK', label: 'Đồ uống' },
                  { key: 'OTHER', label: 'Khác' },
                ] as const
              ).map((tab) => (
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

          {/* Danh sách thực đơn */}
          <div className="space-y-3">
            {filteredMenuItems.map((item) => {
              const inCart = cart.find((c) => c.menuItem.id === item.id);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'p-3.5 rounded-2xl bg-zinc-900 border flex items-center gap-3.5',
                    item.is_available
                      ? 'border-zinc-800'
                      : 'border-zinc-800/50 opacity-60'
                  )}
                >
                  <div className="h-16 w-16 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
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
                    <h3 className="font-bold text-sm text-zinc-100 truncate">
                      {item.name}
                    </h3>
                    <span className="text-xs text-zinc-400">
                      Chuẩn bị: ~{item.prep_time_minutes} phút
                    </span>
                    <div className="text-sm font-extrabold text-amber-400 mt-0.5">
                      {formatVND(item.price)}
                    </div>
                  </div>

                  {!item.is_available ? (
                    <span className="px-2.5 py-1.5 rounded-xl bg-red-500/15 text-red-400 text-xs font-bold">
                      Tạm hết
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddToCart(item)}
                      className="min-h-12 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-extrabold text-xs inline-flex items-center gap-1"
                    >
                      <Plus className="h-4 w-4" />
                      {inCart ? `Đã chọn (${inCart.quantity})` : 'Chọn mua'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Form Giỏ hàng + Nhập Tên & SĐT tạo mã VietQR */}
          {cart.length > 0 && (
            <form
              onSubmit={handleCreateTakeawayOrder}
              className="bg-zinc-900 border border-amber-500/40 rounded-3xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-amber-400" />
                  <h2 className="font-extrabold text-base text-zinc-100">
                    Giỏ hàng Mang về ({cart.length} món)
                  </h2>
                </div>
                <span className="text-lg font-black text-amber-400">
                  {formatVND(totalCartAmount)}
                </span>
              </div>

              <div className="divide-y divide-zinc-800 space-y-3">
                {cart.map((c) => (
                  <div key={c.menuItem.id} className="pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm text-zinc-100">
                          {c.menuItem.name}
                        </span>
                        <span className="block text-xs text-amber-400 font-semibold">
                          {formatVND(c.menuItem.price * c.quantity)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateCartQuantity(
                              c.menuItem.id,
                              c.quantity - 1
                            )
                          }
                          className="h-9 w-9 rounded-xl bg-zinc-800 flex items-center justify-center"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-7 text-center font-bold text-sm">
                          {c.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateCartQuantity(
                              c.menuItem.id,
                              c.quantity + 1
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
                      value={c.note}
                      onChange={(e) =>
                        handleUpdateCartNote(c.menuItem.id, e.target.value)
                      }
                      placeholder="Ghi chú món (ít cay, xin thêm ớt...)"
                      className="w-full px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Tên người nhận *
                  </label>
                  <div className="relative">
                    <User className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="VD: Anh Minh"
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Số điện thoại (để tra cứu đơn) *
                  </label>
                  <div className="relative">
                    <Phone className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="VD: 0909123456"
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || cooldownSeconds > 0}
                className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <QrCode className="h-5 w-5" />
                {isSubmitting
                  ? 'Đang tạo đơn & sinh mã VietQR...'
                  : cooldownSeconds > 0
                  ? `Đợi ${cooldownSeconds}s...`
                  : `Tạo đơn & Lấy mã thanh toán VietQR (${formatVND(
                      totalCartAmount
                    )})`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* VIEW 2: Ô TRA CỨU LẠI ĐƠN HÀNG BẰNG SĐT TỪ LOCALSTORAGE & SUPABASE */}
      {/* ==================================================================== */}
      {activeView === 'LOOKUP' && (
        <div className="p-4 space-y-5">
          <form
            onSubmit={handleLookupByPhone}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3"
          >
            <label className="block text-xs font-semibold text-zinc-300">
              Nhập Số điện thoại đã đặt mang về để xem tiến độ Bếp:
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="h-4 w-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={lookupPhone}
                  onChange={(e) => setLookupPhone(e.target.value)}
                  placeholder="Nhập SĐT của bạn (VD: 0909123456)..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-12 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-extrabold text-xs shrink-0"
              >
                Tra cứu ngay
              </button>
            </div>
          </form>

          {/* Danh sách đơn lưu trên trình duyệt (localStorage) */}
          {savedRecords.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Đơn đặt gần đây trên thiết bị này (localStorage)
              </h3>
              <div className="space-y-2">
                {savedRecords.map((rec) => (
                  <div
                    key={rec.sessionId}
                    className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-sm text-zinc-100">
                        Mã TT: <span className="text-amber-400 font-mono">{rec.paymentCode}</span>
                      </div>
                      <div className="text-xs text-zinc-400">
                        {rec.customerName} • {rec.customerPhone} •{' '}
                        {formatVND(rec.totalAmount)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        const { data } = await supabase
                          .from('table_sessions')
                          .select('*')
                          .eq('id', rec.sessionId)
                          .single();
                        if (data) {
                          await handleSelectSessionToTrack(data);
                        }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-amber-300"
                    >
                      Xem tiến độ
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kết quả tra cứu từ hệ thống */}
          {lookedUpSessions.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Kết quả tra cứu theo SĐT ({lookedUpSessions.length})
              </h3>
              <div className="space-y-2">
                {lookedUpSessions.map((sess) => (
                  <div
                    key={sess.id}
                    className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                        <span>{sess.payment_code}</span>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-bold',
                            sess.status === 'ACTIVE'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : sess.status === 'PENDING_PAYMENT'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-zinc-800 text-zinc-400'
                          )}
                        >
                          {sess.status}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {new Date(sess.opened_at).toLocaleString('vi-VN')} •{' '}
                        <strong className="text-amber-400">
                          {formatVND(sess.total_amount)}
                        </strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectSessionToTrack(sess)}
                      className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-extrabold"
                    >
                      Theo dõi đơn
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
