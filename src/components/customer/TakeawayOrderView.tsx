'use client';
import { sessionStatusLabel } from '@/lib/ui-labels';
import { buildPaymentQr, type PaymentSettings } from '@/lib/payments/vietqr';

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
import { useAppEvents } from '@/lib/use-app-events';
import { formatVND, cn } from '@/lib/utils';
import type {
  MenuCategory,
  MenuItemRow,
  OrderItemRow,
  TableSessionRow,
} from '@/types/database.types';

interface TakeawayOrderViewProps {
  initialMenuItems: MenuItemRow[];
  initialPaymentSettings: PaymentSettings | null;
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

function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '').replace(/[^0-9]/g, '');
}

export function TakeawayOrderView({
  initialMenuItems, initialPaymentSettings,
}: TakeawayOrderViewProps) {

  const [paymentSettings, setPaymentSettings] = useState(initialPaymentSettings);
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
  // useAppEvents closes the EventSource when switching sessions or unmounting.
  // ==========================================================================
  useAppEvents((snapshot) => {
    if (snapshot.sessions[0]) setCurrentSession(snapshot.sessions[0]);
    setCurrentOrderItems(snapshot.orders); setMenuItems(snapshot.menu);
  }, { token: currentSession?.session_token, enabled: Boolean(currentSession) });

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
    if (!paymentSettings) { setErrorMessage('Quán chưa nhận đặt mang về lúc này. Vui lòng thử lại sau.'); return; }

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
      const response = await fetch('/api/customer/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: trimmedName, customerPhone: cleanedPhone, items: cart.map((entry) => ({ menu_item_id: entry.menuItem.id, quantity: entry.quantity, note: entry.note })) }),
      });
      const result = await response.json() as { error?: string; session: TableSessionRow; orders: OrderItemRow[]; paymentSettings: PaymentSettings };
      if (!response.ok) throw new Error(result.error || 'Không tạo được đơn mang về.');
      setPaymentSettings(result.paymentSettings);
      const createdSession = result.session;
      const insertedItems = result.orders;
      const verifiedTotalAmount = createdSession.total_amount;
      const paymentCode = createdSession.payment_code || '';
      const nowIso = createdSession.opened_at;

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
      // Phone filters local records; possession of the secret token authorizes a read.
      const matching = savedRecords.filter((record) => normalizePhone(record.customerPhone) === cleaned);
      const sessionsData: TableSessionRow[] = [];
      for (const record of matching.slice(0, 10)) {
        const response = await fetch(`/api/customer/session?token=${encodeURIComponent(record.sessionToken)}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const snapshot = await response.json() as { sessions: TableSessionRow[] };
        if (snapshot.sessions[0]) sessionsData.push(snapshot.sessions[0]);
      }
      setLookedUpSessions(sessionsData);
      if (sessionsData[0]) await handleSelectSessionToTrack(sessionsData[0]);
      else setErrorMessage('Không có đơn đã lưu trên thiết bị này. Dùng đường dẫn theo dõi có mã phiên hoặc liên hệ quán.');
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
    const response = await fetch(`/api/customer/session?token=${encodeURIComponent(targetSession.session_token)}`, { cache: 'no-store' });
    if (!response.ok) { setErrorMessage('Không đọc được đơn.'); return; }
    const snapshot = await response.json() as { orders: OrderItemRow[] };
    setCurrentOrderItems(snapshot.orders);
  }

  const vietQrPayload = useMemo(() => {
    if (!currentSession?.payment_code || !paymentSettings) return null;
    try { return buildPaymentQr(paymentSettings, Math.round(currentSession.total_amount), currentSession.payment_code); } catch { return null; }
  }, [currentSession, paymentSettings]);

  return (
    <div className="min-h-screen bg-soft text-ink max-w-2xl mx-auto border-x border-line pb-24">
      {!paymentSettings && <div role="status" className="m-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Quán chưa nhận đặt mang về lúc này. <button onClick={() => window.location.reload()} className="underline">Tải lại</button></div>}
      {/* Header */}
      <header className="sticky top-0 z-30 bg-soft/90 backdrop-blur border-b border-line p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-ink text-xs font-extrabold">
              123Dzô • Đặt Mang Về
            </span>
            <h1 className="text-lg font-black text-ink mt-1">
              Chọn món ngon, nhận mang về
            </h1>
          </div>
        </div>

        {/* Chuyển đổi giữa Đặt đơn mới & Tra cứu đơn bằng SĐT */}
        <div className="grid grid-cols-2 gap-2 bg-surface p-1 rounded-2xl border border-line">
          <button
            type="button"
            onClick={() => setActiveView('ORDER')}
            className={cn(
              'min-h-12 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all',
              activeView === 'ORDER'
                ? 'bg-amber-500 text-ink'
                : 'text-muted-ink hover:text-ink'
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
                ? 'bg-amber-500 text-ink'
                : 'text-muted-ink hover:text-ink'
            )}
          >
            <History className="h-4 w-4" />
            Tra cứu đơn bằng SĐT ({savedRecords.length})
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="mx-4 mt-4 p-3.5 rounded-2xl bg-red-50/70 border border-red-500/40 text-red-800 text-xs flex items-center justify-between">
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
        <section className="m-4 p-5 rounded-3xl bg-surface border border-amber-500/40 space-y-4">
          <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
            <div>
              <span className="text-xs text-muted-ink">
                Mã đơn mang về:{' '}
                <strong className="text-amber-800 font-mono">
                  {currentSession.payment_code}
                </strong>
              </span>
              <h2 className="text-lg font-black text-ink mt-0.5">
                Khách hàng: {currentSession.customer_name} (
                {currentSession.customer_phone})
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setCurrentSession(null)}
              className="text-xs text-muted-ink hover:text-ink underline"
            >
              Đặt đơn khác
            </button>
          </div>

          {currentSession.status === 'PENDING_PAYMENT' ? (
            <div className="space-y-4 text-center">
              <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-800 text-xs">
                Quét mã <strong>VietQR</strong> bên dưới để thanh toán{' '}
                <strong>{formatVND(currentSession.total_amount)}</strong>. Ngay
                sau khi bạn chuyển khoản, <strong>Chủ quán</strong> xác nhận đã
                nhận tiền là đơn hàng sẽ lập tức chuyển sang{' '}
                <strong>đang phục vụ</strong> và đẩy thẳng vào Bếp chế biến!
              </div>

              <div className="bg-white p-4 rounded-2xl inline-block mx-auto shadow-lg">
                {vietQrPayload ? <QRCodeSVG value={vietQrPayload} size={256} marginSize={4} aria-label="Mã chuyển khoản đơn hàng" /> : <p className="max-w-xs text-sm text-red-800">Chưa tạo được mã chuyển khoản. Vui lòng liên hệ quán.</p>}
                {paymentSettings && <p className="mt-3 text-sm text-slate-800">{paymentSettings.bankName} · {paymentSettings.accountNumber}<br />{paymentSettings.accountName}</p>}
              </div>

              <div className="p-3.5 rounded-2xl bg-soft border border-line text-left space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-ink">Số tiền chuyển khoản:</span>
                  <span className="font-black text-base text-amber-800">
                    {formatVND(currentSession.total_amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-ink">
                    Nội dung chuyển khoản (Bắt buộc):
                  </span>
                  <div className="flex items-center gap-1.5">
                    <code className="px-2 py-1 rounded bg-surface text-emerald-800 font-bold">
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
                      className="p-1.5 rounded bg-muted hover:bg-stone-200 text-ink"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {copiedCode && (
                  <p className="text-[11px] text-emerald-800 text-right">
                    Đã sao chép mã nội dung chuyển khoản!
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-500/40 text-emerald-800 text-xs flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-800 shrink-0" />
                <div>
                  <strong className="block text-sm text-emerald-800">
                    Quán đã nhận tiền!
                  </strong>
                  <span>
                    {currentOrderItems.some(i => i.status !== 'CANCELLED') && currentOrderItems.filter(i => i.status !== 'CANCELLED').every(i => ['READY','SERVED'].includes(i.status)) ? 'Các món đã xong, bạn có thể ghé quán nhận món!' : 'Quán đang làm món. Món xong sẽ tự báo ở đây.'}
                  </span>
                </div>
              </div>

              <div className="divide-y divide-line text-sm">
                {currentOrderItems.map((item) => {
                  const menu = menuMap.get(item.menu_item_id);
                  return (
                    <div
                      key={item.id}
                      className="py-3 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-ink">
                          {item.quantity}x {menu?.name ?? 'Món ăn'}
                        </span>
                        {item.note && (
                          <span className="block text-xs text-muted-ink">
                            Ghi chú: {item.note}
                          </span>
                        )}
                      </div>

                      {item.status === 'QUEUED' && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-800 text-xs font-bold inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Bếp đã nhận món
                        </span>
                      )}
                      {item.status === 'COOKING' && (
                        <span className="px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-800 text-xs font-bold inline-flex items-center gap-1 animate-pulse">
                          <Flame className="h-3.5 w-3.5" />
                          Bếp đang nấu
                        </span>
                      )}
                      {item.status === 'READY' && (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-800 text-xs font-bold inline-flex items-center gap-1">
                          <Sparkles className="h-3.5 w-3.5" />
                          Món này đã xong
                        </span>
                      )}
                      {item.status === 'SERVED' && (
                        <span className="px-2.5 py-1 rounded-full bg-muted text-ink text-xs font-bold">
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
              <Search className="h-4 w-4 text-muted-ink absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mồi nhậu, bia mang về..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-line text-sm text-ink"
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
                      ? 'bg-amber-500 text-ink border-amber-500'
                      : 'bg-surface text-ink border-line'
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
                    'p-3.5 rounded-2xl bg-surface border flex items-center gap-3.5',
                    item.is_available
                      ? 'border-line'
                      : 'border-line/50 opacity-60'
                  )}
                >
                  <div className="h-16 w-16 rounded-xl bg-soft border border-line overflow-hidden shrink-0 flex items-center justify-center">
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
                    <h3 className="font-bold text-sm text-ink">
                      {item.name}
                    </h3>
                    <span className="text-xs text-muted-ink">
                      {item.station === 'BAR_INSTANT' ? 'Đồ uống & Món lấy ngay' : 'Món bếp làm'}
                    </span>
                    <div className="text-sm font-extrabold text-amber-800 mt-0.5">
                      {formatVND(item.price)}
                    </div>
                  </div>

                  {!item.is_available ? (
                    <span className="px-2.5 py-1.5 rounded-xl bg-red-500/15 text-red-800 text-xs font-bold">
                      Tạm hết
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddToCart(item)}
                      className="min-h-12 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-ink font-extrabold text-xs inline-flex items-center gap-1"
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
              className="bg-surface border border-amber-500/40 rounded-3xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-amber-800" />
                  <h2 className="font-extrabold text-base text-ink">
                    Giỏ hàng Mang về ({cart.length} món)
                  </h2>
                </div>
                <span className="text-lg font-black text-amber-800">
                  {formatVND(totalCartAmount)}
                </span>
              </div>

              <div className="divide-y divide-line space-y-3">
                {cart.map((c) => (
                  <div key={c.menuItem.id} className="pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-sm text-ink">
                          {c.menuItem.name}
                        </span>
                        <span className="block text-xs text-amber-800 font-semibold">
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
                          className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center"
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
                          className="h-9 w-9 rounded-xl bg-amber-500 text-ink flex items-center justify-center font-bold"
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
                      className="w-full px-3 py-1.5 rounded-lg bg-soft border border-line text-xs text-ink"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-line">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Tên người nhận *
                  </label>
                  <div className="relative">
                    <User className="h-4 w-4 text-muted-ink absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="VD: Anh Minh"
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Số điện thoại (để tra cứu đơn) *
                  </label>
                  <div className="relative">
                    <Phone className="h-4 w-4 text-muted-ink absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="VD: 0909123456"
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || cooldownSeconds > 0 || !paymentSettings}
                className="min-h-12 w-full py-3.5 px-5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <QrCode className="h-5 w-5" />
                {isSubmitting
                  ? 'Đang tạo đơn…'
                  : cooldownSeconds > 0
                  ? `Đợi ${cooldownSeconds}s...`
                  : `Đặt món & Lấy mã chuyển khoản (${formatVND(
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
            className="bg-surface border border-line rounded-2xl p-4 space-y-3"
          >
            <label className="block text-xs font-semibold text-ink">
              Nhập Số điện thoại đã đặt mang về để xem tiến độ Bếp:
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="h-4 w-4 text-muted-ink absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={lookupPhone}
                  onChange={(e) => setLookupPhone(e.target.value)}
                  placeholder="Nhập SĐT của bạn (VD: 0909123456)..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-12 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-ink font-extrabold text-xs shrink-0"
              >
                Tra cứu ngay
              </button>
            </div>
          </form>

          {/* Danh sách đơn lưu trên trình duyệt (localStorage) */}
          {savedRecords.length > 0 && (
            <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-ink">
                Đơn đặt gần đây trên thiết bị này (localStorage)
              </h3>
              <div className="space-y-2">
                {savedRecords.map((rec) => (
                  <div
                    key={rec.sessionId}
                    className="p-3.5 rounded-xl bg-soft border border-line flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-sm text-ink">
                        Mã TT: <span className="text-amber-800 font-mono">{rec.paymentCode}</span>
                      </div>
                      <div className="text-xs text-muted-ink">
                        {rec.customerName} • {rec.customerPhone} •{' '}
                        {formatVND(rec.totalAmount)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const response = await fetch(`/api/customer/session?token=${encodeURIComponent(rec.sessionToken)}`, { cache: 'no-store' });
                          if (!response.ok) throw new Error('Không đọc được đơn trên thiết bị này.');
                          const snapshot = await response.json() as { sessions: TableSessionRow[] };
                          if (snapshot.sessions[0]) await handleSelectSessionToTrack(snapshot.sessions[0]);
                        } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Không đọc được đơn.'); }
                      }}
                      className="px-3.5 py-2 rounded-xl bg-muted hover:bg-stone-200 text-xs font-bold text-amber-800"
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
            <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-ink">
                Kết quả tra cứu theo SĐT ({lookedUpSessions.length})
              </h3>
              <div className="space-y-2">
                {lookedUpSessions.map((sess) => (
                  <div
                    key={sess.id}
                    className="p-3.5 rounded-xl bg-soft border border-line flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-sm text-ink flex items-center gap-2">
                        <span>{sess.payment_code}</span>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-bold',
                            sess.status === 'ACTIVE'
                              ? 'bg-emerald-500/20 text-emerald-800'
                              : sess.status === 'PENDING_PAYMENT'
                              ? 'bg-amber-500/20 text-amber-800'
                              : 'bg-muted text-muted-ink'
                          )}
                        >
                          {sessionStatusLabel[sess.status]}
                        </span>
                      </div>
                      <div className="text-xs text-muted-ink mt-0.5">
                        {new Date(sess.opened_at).toLocaleString('vi-VN')} •{' '}
                        <strong className="text-amber-800">
                          {formatVND(sess.total_amount)}
                        </strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectSessionToTrack(sess)}
                      className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-ink text-xs font-extrabold"
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
