'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { OnboardingGuideModal } from '@/components/shared/OnboardingGuideModal';
import {
  ChefHat,
  Flame,
  Layers,
  Clock,
  CheckCircle2,
  Ban,
  Sun,
  Volume2,
  Search,
  AlertTriangle,
  X,
  BarChart3,
  LayoutGrid,
} from 'lucide-react';
import { useAppEvents } from '@/lib/use-app-events';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  playNotificationSound,
  formatDurationFromSeconds,
  cn,
} from '@/lib/utils';
import type {
  MenuItemRow,
  OrderItemRow,
  StaffRole,
  TableRow,
  TableSessionRow,
} from '@/types/database.types';

interface KitchenKdsBoardProps {
  initialKitchenOrders: OrderItemRow[];
  initialActiveSessions: TableSessionRow[];
  tables: TableRow[];
  initialMenuItems: MenuItemRow[];
  currentStaffRole?: StaffRole;
}

interface BatchGroup {
  menuItemId: string;
  menuItem: MenuItemRow | undefined;
  totalQuantity: number;
  oldestCreatedAt: string;
  items: OrderItemRow[];
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

export function KitchenKdsBoard({
  initialKitchenOrders,
  initialActiveSessions,
  tables: initialTables,
  initialMenuItems,
  currentStaffRole = 'kitchen',
}: KitchenKdsBoardProps) {
  const supabase = createSupabaseBrowserClient();
  const [tables, setTables] = useState(initialTables);

  const [orders, setOrders] = useState<OrderItemRow[]>(initialKitchenOrders);
  const [sessions, setSessions] = useState<TableSessionRow[]>(
    initialActiveSessions
  );
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);

  const [is86DrawerOpen, setIs86DrawerOpen] = useState<boolean>(false);
  const [drawerSearch, setDrawerSearch] = useState<string>('');
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [groupSame, setGroupSame] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  // ==========================================================================
  // 1. TÍCH HỢP SCREEN WAKE LOCK API CHỐNG TẮT MÀN HÌNH TABLET BẾP (MỤC 10.2)
  // ==========================================================================
  useEffect(() => {
    let isMounted = true;

    async function requestScreenWakeLock() {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        return;
      }
      try {
        const sentinel = (await navigator.wakeLock.request(
          'screen'
        )) as unknown as WakeLockSentinelLike;
        if (isMounted) {
          wakeLockRef.current = sentinel;
          setIsWakeLockActive(true);
        }
      } catch {
        if (isMounted) {
          setIsWakeLockActive(false);
        }
      }
    }

    void requestScreenWakeLock();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void requestScreenWakeLock();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        void wakeLockRef.current.release().catch(() => undefined);
      }
    };
  }, []);

  const tableMap = useMemo(() => {
    const map = new Map<string, TableRow>();
    tables.forEach((t) => map.set(t.id, t));
    return map;
  }, [tables]);

  const sessionMap = useMemo(() => {
    const map = new Map<string, TableSessionRow>();
    sessions.forEach((s) => map.set(s.id, s));
    return map;
  }, [sessions]);

  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItemRow>();
    menuItems.forEach((m) => map.set(m.id, m));
    return map;
  }, [menuItems]);

  // ==========================================================================
  // 2. LẮNG NGHE SUPABASE REALTIME & DỌN DẸP KÊNH (MỤC 2.2 AGENTS.MD)
  // ==========================================================================
  const live = useAppEvents((snapshot) => {
    setOrders(snapshot.orders); setSessions(snapshot.sessions); setMenuItems(snapshot.menu); setTables(snapshot.tables);
  }, { sound: true, view: 'kitchen' });

  // Chỉ hiển thị đơn của các phiên đã kích hoạt (ACTIVE / REQUEST_BILL)
  // Tuyệt đối chặn đơn Mang về đang PENDING_PAYMENT hoặc bàn đã CLOSED (Mục 3.2 AGENTS.md)
  const validKitchenOrders = useMemo(() => {
    return orders.filter((item) => {
      if (item.station !== 'KITCHEN') return false;
      const sess = sessionMap.get(item.session_id);
      if (!sess) return false;
      if (sess.status !== 'ACTIVE' && sess.status !== 'REQUEST_BILL') {
        return false;
      }
      return item.status === 'QUEUED' || item.status === 'COOKING';
    });
  }, [orders, sessionMap]);

  // Hàng đợi FIFO (QUEUED) sắp xếp từ cũ nhất đến mới nhất
  const fifoQueuedOrders = useMemo(() => {
    return [...validKitchenOrders]
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
  }, [validKitchenOrders]);

  // Cột trái: Gom nhóm các món QUEUED trùng menu_item_id (Batch Cooking View)
  const batchGroups = useMemo<BatchGroup[]>(() => {
    const map = new Map<string, OrderItemRow[]>();
    fifoQueuedOrders.forEach((item) => {
      const key = groupSame ? item.menu_item_id : item.id;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });

    const groups: BatchGroup[] = [];
    map.forEach((items) => {
      const menuItemId = items[0].menu_item_id;
      const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
      const oldestCreatedAt =
        items[0]?.created_at ?? new Date().toISOString();
      groups.push({
        menuItemId,
        menuItem: menuMap.get(menuItemId),
        totalQuantity,
        oldestCreatedAt,
        items,
      });
    });

    return groups.sort((a,b) => Date.parse(a.oldestCreatedAt) - Date.parse(b.oldestCreatedAt));
  }, [fifoQueuedOrders, menuMap, groupSame]);

  function getSessionTableLabel(sessionId: string): string {
    const sess = sessionMap.get(sessionId);
    if (!sess) return 'Bàn';
    if (sess.session_type === 'TAKEAWAY') {
      return `Mang về #${sess.customer_name ?? 'Khách'}`;
    }
    if (sess.table_id) {
      return tableMap.get(sess.table_id)?.table_number ?? 'Bàn';
    }
    return 'Bàn';
  }

  // ==========================================================================
  // 3. BẤM "NẤU GỘP CẢ MẺ" (BATCH COOKING) HOẶC "NHẬN NẤU ĐƠN LẺ"
  // Bắt buộc ghi nhận cooking_started_at và batch_id (nếu nấu gộp) (Mục 3.3 AGENTS.md)
  // ==========================================================================
  async function handleCompleteCooking(targetItems: OrderItemRow[]) {
    if (isSubmitting || targetItems.length === 0) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const nowIso = new Date().toISOString();
    const itemIds = targetItems.map((i) => i.id);

    try {
      const { data, error } = await supabase
        .from('order_items')
        .update({
          status: 'READY',
          ready_at: nowIso,
        })
        .in('id', itemIds)
        .select('*');

      if (error || !data) {
        throw new Error(
          error?.message ?? 'Chưa báo xong món được. Hãy thử lại.'
        );
      }

      const completedIds = new Set(data.map((d) => d.id));
      setOrders((prev) => prev.filter((item) => !completedIds.has(item.id)));

    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi hoàn thành món'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // 5. BÁO HẾT MÓN NHANH (86ING) NGAY TRÊN MÀN HÌNH BẾP (US-K03)
  // ==========================================================================
  async function handleToggle86MenuItem(menuItem: MenuItemRow) {
    if (togglingId) return; setTogglingId(menuItem.id);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .update({ is_available: !menuItem.is_available })
        .eq('id', menuItem.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(
          error?.message ?? 'Không thể cập nhật trạng thái Tạm hết hàng'
        );
      }

      setMenuItems((prev) =>
        prev.map((m) => (m.id === data.id ? data : m))
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi báo hết món'
      );
    } finally { setTogglingId(null); }
  }

  const outOfStockCount = useMemo(
    () => menuItems.filter((m) => !m.is_available).length,
    [menuItems]
  );

  return (
    <div className="min-h-screen bg-soft text-ink p-4 lg:p-6 flex flex-col gap-5">
      {/* Top Header KDS Tablet */}
      <div role="status" className="border-b border-line px-4 py-2 text-sm text-amber-800">
        {live.connected ? 'Đã kết nối thông báo nội bộ' : 'Đang kết nối lại thông báo...'}
        {live.alerts.length > 0 && <span> - {live.alerts[0].message} ({live.alerts.length})</span>}
      </div>
      <header className="bg-surface border border-line rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-orange-500/15 border border-orange-500/40 flex items-center justify-center text-orange-800">
            <ChefHat className="h-7 w-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-black text-ink">
                123Dzô • Bếp
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-orange-500/15 text-orange-800 border border-orange-500/30">
                {currentStaffRole === 'kitchen' ? 'Đầu bếp' : currentStaffRole === 'admin' ? 'Chủ quán' : 'Người bàn giao'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
                  isWakeLockActive
                    ? 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30'
                    : 'bg-muted text-muted-ink border-line'
                )}
              >
                <Sun className="h-3.5 w-3.5" />
                {isWakeLockActive
                  ? 'Đang giữ sáng màn hình'
                  : 'Giữ màn hình mở khi làm việc'}
              </span>
            </div>
            <p className="text-xs text-muted-ink mt-0.5">
              <strong>{fifoQueuedOrders.length} lượt món cần làm</strong> · Xong món nào, bấm xong món đó.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void playNotificationSound('/sounds/ting-ting.mp3')}
            className="min-h-12 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-stone-200 text-xs font-semibold text-ink border border-line"
          >
            <Volume2 className="h-4 w-4 text-amber-800" />
            Thử chuông Bếp
          </button>

          <button
            type="button"
            onClick={() => setIs86DrawerOpen(true)}
            className="min-h-12 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-800 border border-red-500/40 text-xs font-bold"
          >
            <Ban className="h-4 w-4" />
            Báo hết món nhanh
            {outOfStockCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px]">
                {outOfStockCount}
              </span>
            )}
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
                href="/staff"
                className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-stone-200 border border-line text-xs font-semibold text-emerald-800 transition-colors"
              >
                <LayoutGrid className="h-4 w-4 text-emerald-800" />
                Phục vụ bàn
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
            className="text-red-800 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* BỐ CỤC 2 CỘT LỚN CHO MÀN HÌNH NGANG TABLET (MỤC 13.3 PRD_SPEC.MD) */}
      {/* ==================================================================== */}
      <section className="neu-card p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">LÀM MÓN THẬT NHẸ NHÀNG</p><h2 className="mt-2 text-2xl font-bold">Món cần làm</h2><p className="mt-2 text-muted-ink">Món gọi trước nằm trên. Xem ghi chú của từng bàn trước khi làm.</p></div><label className="neu-button flex min-h-12 items-center gap-3 px-4"><input type="checkbox" checked={groupSame} onChange={e => setGroupSame(e.target.checked)} />Gộp món giống nhau</label></div>
        {!batchGroups.length ? <p className="py-16 text-center text-muted-ink">Đã xong hết món. Có món mới sẽ tự hiện ở đây.</p> :
          <div className="grid gap-4 xl:grid-cols-2">{batchGroups.map((g,index) => <article key={g.items[0].id} className={'neu-card p-5 space-y-4 ' + (index === 0 ? 'tone-peach ring-1 ring-orange-300' : '')}>
            <div className="flex items-center gap-3"><span className="neu-inset flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-bold text-teal-800">#{index + 1}</span><h3 className="text-xl font-bold">{g.totalQuantity} × {g.menuItem?.name ?? 'Món ăn'}</h3></div>
            <ul className="space-y-2">{g.items.map(item => <li key={item.id} className="neu-inset flex flex-wrap items-center justify-between gap-3 rounded-xl p-3"><div><strong>{getSessionTableLabel(item.session_id)} · {item.quantity} phần</strong>{item.note && <p className="mt-1 font-semibold text-orange-800">Ghi chú: {item.note}</p>}</div>{g.items.length > 1 && <button disabled={isSubmitting} onClick={() => void handleCompleteCooking([item])} className="neu-button min-h-12 px-4 text-sm">Xong phần này</button>}</li>)}</ul>
            <button disabled={isSubmitting} onClick={() => void handleCompleteCooking(g.items)} className="neu-button min-h-14 w-full bg-teal-700 px-5 py-4 text-lg font-bold text-white">{isSubmitting ? 'Đang lưu…' : g.items.length > 1 ? 'Xong tất cả phần này' : 'Xong món'}</button>
          </article>)}</div>}
      </section>

      {is86DrawerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex justify-end">
          <div className="bg-surface border-l border-line max-w-md w-full h-full p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-800" />
                <h3 className="text-lg font-extrabold text-ink">
                  Báo hết món nhanh
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIs86DrawerOpen(false)}
                className="p-1 text-muted-ink hover:text-ink"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="relative">
              <Search className="h-4 w-4 text-muted-ink absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={drawerSearch}
                onChange={(e) => setDrawerSearch(e.target.value)}
                placeholder="Tìm món cần khóa / mở bán..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-soft border border-line text-sm text-ink"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-line pr-1">
              {menuItems
                .filter((m) =>
                  m.name.toLowerCase().includes(drawerSearch.toLowerCase())
                )
                .map((m) => (
                  <div
                    key={m.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-sm text-ink">
                        {m.name}
                      </div>
                      <span className="text-xs text-muted-ink">
                        {m.station === 'KITCHEN' ? 'Món Bếp' : 'Quầy / Bia'}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={Boolean(togglingId)}
                      onClick={() => handleToggle86MenuItem(m)}
                      className={cn(
                        'min-h-12 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors',
                        m.is_available
                          ? 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30'
                          : 'bg-red-500/20 text-red-800 border-red-500/40'
                      )}
                    >
                      {m.is_available ? 'Đang còn hàng' : 'Tạm hết món'}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
