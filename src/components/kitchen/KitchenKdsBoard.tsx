'use client';
import { useScreenWakeLock } from '@/lib/pwa/use-wake-lock';
import { effectiveQueueTime } from '@/lib/customer/queue-time';
import { SoundControls } from '@/components/ui/SoundControls';

import type { DisplayOrderItem as OrderItemRow } from '@/lib/orders/contracts';
import type { PublicMenuItem as MenuItemRow, KitchenSession as TableSessionRow } from '@/lib/data/read-contracts';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useMenuActions } from '@/lib/menu/use-menu-actions';
import { MenuActionFeedback } from '@/components/admin/MenuActionFeedback';
import { useItemActions } from '@/lib/item-actions/use-item-actions';
import { ItemActionFeedback } from '@/components/staff/ItemActionFeedback';
import { UserButton } from '@clerk/nextjs';
import {
  ChefHat,
  Flame,
  Layers,
  Clock,
  CheckCircle2,
  Ban,
  Sun,
  Search,
  AlertTriangle,
  X,
  BarChart3,
  LayoutGrid,
} from 'lucide-react';
import { useServerRefresh } from '@/lib/data/use-server-refresh';
import { useSnapshotSound } from '@/lib/data/use-snapshot-sound';
import {
  formatDurationFromSeconds,
  cn,
} from '@/lib/utils';
import type {
  StaffRole,
  TableRow,
} from '@/types/database.types';

interface KitchenKdsBoardProps {
  initialKitchenOrders: OrderItemRow[];
  initialActiveSessions: TableSessionRow[];
  tables: TableRow[];
  initialMenuItems: MenuItemRow[];
  currentStaffRole?: StaffRole;
  currentStaffId: string;
}

interface BatchGroup {
  menuItemId: string;
  menuItem: MenuItemRow | undefined;
  totalQuantity: number;
  oldestCreatedAt: string | null;
  items: OrderItemRow[];
}

interface CookingGroup {
  groupKey: string;
  isBatched: boolean;
  batchId: string | null;
  menuItem: MenuItemRow | undefined;
  totalQuantity: number;
  cookingStartedAt: string;
  items: OrderItemRow[];
}

export function KitchenKdsBoard({
  initialKitchenOrders,
  initialActiveSessions,
  tables,
  initialMenuItems,
  currentStaffRole = 'kitchen',
  currentStaffId,
}: KitchenKdsBoardProps) {
  const itemActions = useItemActions(currentStaffId);
  const menuActions = useMenuActions(currentStaffId);

  const [orders, setOrders] = useState<OrderItemRow[]>(initialKitchenOrders);
  const [sessions, setSessions] = useState<TableSessionRow[]>(
    initialActiveSessions
  );
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  useEffect(() => { setOrders(initialKitchenOrders); }, [initialKitchenOrders]);
  useEffect(() => { setSessions(initialActiveSessions); }, [initialActiveSessions]);
  useEffect(() => { setMenuItems(initialMenuItems); }, [initialMenuItems]);

  const [is86DrawerOpen, setIs86DrawerOpen] = useState<boolean>(false);
  const [queueMode,setQueueMode]=useState<'BATCH'|'FIFO'>('BATCH');
  const [drawerSearch, setDrawerSearch] = useState<string>('');
  const isWakeLockActive = useScreenWakeLock();
  const isSubmitting = itemActions.busy || menuActions.busy;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Bộ đếm thời gian thực mỗi giây cho đồng hồ chờ & đồng hồ nấu trên KDS
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
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

  useServerRefresh(15000, currentStaffId);
  useSnapshotSound(initialKitchenOrders.filter(item => item.quantity > 0 && item.station === 'KITCHEN' && item.status === 'QUEUED' &&
    initialActiveSessions.some(session => session.id === item.session_id && (session.status === 'ACTIVE' || session.status === 'REQUEST_BILL'))).map(item => item.id));

  const validKitchenOrders = useMemo(() => {
    return orders.filter((item) => {
      if (item.quantity <= 0) return false;
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
    return validKitchenOrders
      .filter((item) => item.status === 'QUEUED')
      .sort(
        (a, b) =>
          (effectiveQueueTime(a,sessionMap.get(a.session_id))??Infinity)-(effectiveQueueTime(b,sessionMap.get(b.session_id))??Infinity)
      );
  }, [validKitchenOrders,sessionMap]);

  // Cột trái: Gom nhóm các món QUEUED trùng menu_item_id (Batch Cooking View)
  const batchGroups = useMemo<BatchGroup[]>(() => {
    const map = new Map<string, OrderItemRow[]>();
    fifoQueuedOrders.forEach((item) => {
      const list = map.get(item.menu_item_id) ?? [];
      list.push(item);
      map.set(item.menu_item_id, list);
    });

    const groups: BatchGroup[] = [];
    map.forEach((items, menuItemId) => {
      const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
      const effective=items[0]?effectiveQueueTime(items[0],sessionMap.get(items[0].session_id)):null;
      const oldestCreatedAt=effective===null?null:new Date(effective).toISOString();
      groups.push({
        menuItemId,
        menuItem: menuMap.get(menuItemId),
        totalQuantity,
        oldestCreatedAt,
        items,
      });
    });

    // Ưu tiên nhóm có nhiều đĩa hoặc chờ lâu nhất lên đầu
    return groups.sort((a, b) => {
      if (b.items.length !== a.items.length) {
        return b.items.length - a.items.length;
      }
      return (
        (a.oldestCreatedAt?Date.parse(a.oldestCreatedAt):Infinity) -
        (b.oldestCreatedAt?Date.parse(b.oldestCreatedAt):Infinity)
      );
    });
  }, [fifoQueuedOrders, menuMap, sessionMap]);

  // Các mẻ / món đang nấu (status === 'COOKING')
  const cookingGroups = useMemo<CookingGroup[]>(() => {
    const cookingItems = validKitchenOrders.filter(
      (i) => i.status === 'COOKING'
    );
    const map = new Map<string, OrderItemRow[]>();

    cookingItems.forEach((item) => {
      const key = item.batch_id ? `batch_${item.batch_id}` : `single_${item.id}`;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });

    const groups: CookingGroup[] = [];
    map.forEach((items, groupKey) => {
      const first = items[0];
      if (!first) return;
      groups.push({
        groupKey,
        isBatched: Boolean(first.batch_id) && items.length > 1,
        batchId: first.batch_id,
        menuItem: menuMap.get(first.menu_item_id),
        totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
        cookingStartedAt: first.cooking_started_at ?? first.created_at,
        items,
      });
    });

    return groups.sort(
      (a, b) =>
        new Date(a.cookingStartedAt).getTime() -
        new Date(b.cookingStartedAt).getTime()
    );
  }, [validKitchenOrders, menuMap]);

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
  async function handleStartCooking(targetItems: OrderItemRow[], _isBatch: boolean) {
    if (isSubmitting || itemActions.blocked || menuActions.blocked || !targetItems.length) return;
    await itemActions.run({action:'START',reason:'',items:targetItems.map((item)=>({id:item.id,sessionId:item.session_id,expectedStatus:'QUEUED',expectedQuantity:item.quantity}))});
  }

  // ==========================================================================
  // 4. BẤM "HOÀN THÀNH" (CHUYỂN SANG READY, GHI READY_AT & BẮN WEB PUSH CHO NV)
  // ==========================================================================
  async function handleCompleteCooking(targetItems: OrderItemRow[]) {
    if (isSubmitting || itemActions.blocked || menuActions.blocked || !targetItems.length) return;
    await itemActions.run({action:'READY',reason:'',items:targetItems.map((item)=>({id:item.id,sessionId:item.session_id,expectedStatus:'COOKING',expectedQuantity:item.quantity}))});
  }

  // ==========================================================================
  // 5. BÁO HẾT MÓN NHANH (86ING) NGAY TRÊN MÀN HÌNH BẾP (US-K03)
  // ==========================================================================
  async function handleToggle86MenuItem(menuItem: MenuItemRow) {
    if (itemActions.blocked || menuActions.blocked) return;
    await menuActions.run({ action: 'AVAILABILITY', id: menuItem.id, item: { is_available: !menuItem.is_available }, expected: { is_available: menuItem.is_available } });
  }

  const outOfStockCount = useMemo(
    () => menuItems.filter((m) => !m.is_available).length,
    [menuItems]
  );

  return (
    <div className="operations-app min-h-screen bg-zinc-950 text-zinc-100 p-4 lg:p-6 flex flex-col gap-5" aria-busy={isSubmitting}>
      {/* Top Header KDS Tablet */}
      <header className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-orange-500/15 border border-orange-500/40 flex items-center justify-center text-orange-400">
            <ChefHat className="h-7 w-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-black text-zinc-100">
                123Dzô • Màn hình Điều phối Bếp (KDS Tablet)
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase bg-orange-500/15 text-orange-300 border border-orange-500/30">
                Role: {currentStaffRole}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
                  isWakeLockActive
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                )}
              >
                <Sun className="h-3.5 w-3.5" />
                {isWakeLockActive
                  ? 'Wake Lock: Giữ sáng màn hình'
                  : 'Màn hình có thể tự tắt'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Đang chờ nấu: <strong>{fifoQueuedOrders.length} lượt</strong> •
              Đang đứng bếp: <strong>{cookingGroups.length} mẻ</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <SoundControls />

          <button
            type="button"
            onClick={() => setIs86DrawerOpen(true)}
            className="min-h-12 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40 text-xs font-bold"
          >
            <Ban className="h-4 w-4" />
            Báo hết món nhanh (86ing)
            {outOfStockCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px]">
                {outOfStockCount}
              </span>
            )}
          </button>

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
                href="/staff"
                className="min-h-12 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-emerald-300 transition-colors"
              >
                <LayoutGrid className="h-4 w-4 text-emerald-400" />
                Phục vụ Bàn (/staff)
              </Link>
            </>
          )}

          <div className="pl-1 flex items-center">
            <UserButton />
          </div>
        </div>
      </header>

      <ItemActionFeedback pending={itemActions.pending} busy={itemActions.busy} error={itemActions.error} recover={() => itemActions.run()} />
      <MenuActionFeedback {...menuActions} recover={() => menuActions.run()} />
      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-950/70 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* BỐ CỤC 2 CỘT LỚN CHO MÀN HÌNH NGANG TABLET (MỤC 13.3 PRD_SPEC.MD) */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap gap-2" aria-label="Cách xem hàng chờ">
        <button type="button" aria-pressed={queueMode==='BATCH'} onClick={()=>setQueueMode('BATCH')} className="min-h-12 px-4 border rounded-xl">Gom món trùng</button>
        <button type="button" aria-pressed={queueMode==='FIFO'} onClick={()=>setQueueMode('FIFO')} className="min-h-12 px-4 border rounded-xl">Theo thứ tự gọi</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* CỘT TRÁI (5/12): GOM MÓN TRÙNG - BATCH COOKING VIEW (US-K01) */}
        <section className={queueMode==='BATCH'?'lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4':'hidden'}>
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-amber-400" />
              <div>
                <h2 className="text-base font-extrabold text-zinc-100">
                  Gom món trùng
                </h2>
                <p className="text-xs text-zinc-400">
                  Gom các đĩa giống nhau của nhiều bàn để xào/nấu chung 1 lần chảo
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 text-xs font-bold">
              {batchGroups.length} nhóm món
            </span>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-230px)] pr-1">
            {batchGroups.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                Hiện không có món nào đang chờ trong hàng đợi.
              </div>
            ) : (
              batchGroups.map((group) => {
                const isMultiTableBatch = group.items.length > 1;
                const waitSeconds = Math.max(
                  0,
                  Math.floor(
                    (nowMs - (group.oldestCreatedAt?Date.parse(group.oldestCreatedAt):nowMs)) / 1000
                  )
                );

                return (
                  <div
                    key={group.menuItemId}
                    className={cn(
                      'p-4 rounded-2xl border space-y-3 transition-all',
                      isMultiTableBatch
                        ? 'bg-amber-500/10 border-amber-500/50'
                        : 'bg-zinc-950 border-zinc-800'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {isMultiTableBatch && (
                          <span className="inline-block px-2 py-0.5 rounded bg-amber-500 text-zinc-950 text-[11px] font-black mb-1">
                            GOM {group.items.length} LƯỢT GỌI CÙNG MÓN
                          </span>
                        )}
                        <h3 className="text-lg font-black text-zinc-100">
                          {group.menuItem?.name ?? 'Món nấu'} • Tổng:{' '}
                          <span className="text-amber-400">
                            {group.totalQuantity} phần
                          </span>
                        </h3>
                      </div>

                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-xs font-mono text-zinc-300 shrink-0">
                        <Clock className="h-3.5 w-3.5 text-amber-400" />
                        {group.oldestCreatedAt?`Chờ ${formatDurationFromSeconds(waitSeconds)}`:'Chưa có mốc nhận đơn xác minh'}
                      </span>
                    </div>

                    {/* Chi tiết từng bàn trong mẻ gom */}
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs"
                        >
                          <span className="font-bold text-amber-300">
                            {getSessionTableLabel(item.session_id)}
                          </span>
                          <span className="text-zinc-200 font-semibold">
                            {' '}
                            × {item.quantity}
                          </span>
                          {item.note && (
                            <span className="block text-[11px] text-orange-300">
                              Ghi chú: {item.note}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={isSubmitting || itemActions.blocked || menuActions.blocked}
                      onClick={() =>
                        handleStartCooking(group.items, isMultiTableBatch)
                      }
                      className={cn(
                        'min-h-12 w-full py-3 px-4 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]',
                        isMultiTableBatch
                          ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-lg'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700'
                      )}
                    >
                      <Flame className="h-4 w-4" />
                      {isMultiTableBatch
                        ? `Nấu gộp cả ${group.totalQuantity} phần (${group.items.length} bàn)`
                        : `Nhận nấu (${group.totalQuantity} phần)`}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* CỘT PHẢI (7/12): CÁC MẺ ĐANG NẤU (COOKING) & HÀNG ĐỢI THỨ TỰ THỜI GIAN (FIFO) */}
        <section className={queueMode==='BATCH'?'lg:col-span-7 flex flex-col gap-5':'lg:col-span-12 flex flex-col gap-5'}>
          {/* KHU VỰC 2A: CÁC MÓN / MẺ ĐANG ĐỨNG BẾP (STATUS === 'COOKING') */}
          <div className="bg-zinc-900 border border-orange-500/40 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-400 animate-pulse" />
                <h2 className="text-base font-extrabold text-zinc-100">
                  Đang Chế Biến Trên Bếp ({cookingGroups.length})
                </h2>
              </div>
              <span className="text-xs text-zinc-400">
                Bấm &ldquo;Hoàn thành&rdquo; để báo nhân viên bưng ra bàn
              </span>
            </div>

            {cookingGroups.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                Chưa có món nào đang trên chảo. Hãy bấm &ldquo;Nấu gộp&rdquo; hoặc &ldquo;Nhận nấu&rdquo; để bắt đầu tính giờ!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cookingGroups.map((cg) => {
                  const prepMinutes = cg.menuItem?.prep_time_minutes ?? 10;
                  const elapsedCookSeconds = Math.max(
                    0,
                    Math.floor(
                      (nowMs - new Date(cg.cookingStartedAt).getTime()) / 1000
                    )
                  );
                  const isLate = elapsedCookSeconds > prepMinutes * 60 * 1.3;

                  return (
                    <div
                      key={cg.groupKey}
                      className={cn(
                        'p-4 rounded-2xl border flex flex-col justify-between gap-3',
                        isLate
                          ? 'bg-red-950/35 border-red-500/60'
                          : 'bg-zinc-950 border-orange-500/40'
                      )}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            {cg.isBatched && (
                              <span className="inline-block px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 text-[10px] font-bold mb-1">
                                MẺ NẤU GỘP ({cg.items.length} BÀN)
                              </span>
                            )}
                            <h3 className="text-base font-black text-zinc-100">
                              {cg.totalQuantity}x{' '}
                              {cg.menuItem?.name ?? 'Món đang nấu'}
                            </h3>
                          </div>

                          <div className="text-right">
                            <span
                              className={cn(
                                'font-mono text-sm font-black px-2.5 py-1 rounded-lg border inline-flex items-center gap-1',
                                isLate
                                  ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                  : 'bg-orange-500/15 text-orange-300 border-orange-500/30'
                              )}
                            >
                              <Clock className="h-3.5 w-3.5" />
                              {formatDurationFromSeconds(elapsedCookSeconds)}
                            </span>
                            <span className="block text-[10px] text-zinc-400 mt-1">
                              Chuẩn: {prepMinutes} phút
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {cg.items.map((item) => (
                            <span
                              key={item.id}
                              className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200"
                            >
                              <strong className="text-amber-400">
                                {getSessionTableLabel(item.session_id)}
                              </strong>{' '}
                              ({item.quantity})
                              {item.note ? ` • ${item.note}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting || itemActions.blocked || menuActions.blocked}
                        onClick={() => handleCompleteCooking(cg.items)}
                        className="min-h-12 w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Hoàn thành • Báo NV Bưng Ngay
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* KHU VỰC 2B: HÀNG ĐỢI THỨ TỰ THỜI GIAN (FIFO QUEUE - QUEUED) */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3 flex-1">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-400" />
                <div>
                  <h2 className="text-base font-extrabold text-zinc-100">
                    Món chờ theo thứ tự gọi
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Bàn nào đặt trước xếp trên (Khớp 100% với số thứ tự chờ trên máy khách)
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-300 text-xs font-bold">
                {fifoQueuedOrders.length} đơn chờ
              </span>
            </div>

            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {fifoQueuedOrders.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-500">
                  Hàng đợi FIFO đang trống.
                </div>
              ) : (
                fifoQueuedOrders.map((item, idx) => {
                  const menu = menuMap.get(item.menu_item_id);
                  const waitSeconds = Math.max(
                    0,
                    Math.floor(
                      (nowMs - (effectiveQueueTime(item,sessionMap.get(item.session_id))??nowMs)) / 1000
                    )
                  );
                  const isWaitingLong = waitSeconds > 10 * 60;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3',
                        isWaitingLong
                          ? 'bg-red-950/30 border-red-500/40'
                          : 'bg-zinc-950 border-zinc-800'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center font-black text-amber-400 text-sm shrink-0">
                          #{idx + 1}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-amber-300 text-xs font-bold">
                              {getSessionTableLabel(item.session_id)}
                            </span>
                            <span className="font-extrabold text-sm text-zinc-100">
                              {item.quantity}x {menu?.name ?? 'Món ăn'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-400 mt-1">
                            <span>
                              {effectiveQueueTime(item,sessionMap.get(item.session_id))===null?'Chưa có mốc nhận đơn xác minh':`Đã chờ: ${formatDurationFromSeconds(waitSeconds)}`}
                            </span>
                            {item.note && (
                              <span className="text-orange-300 font-medium">
                                • Ghi chú: {item.note}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting || itemActions.blocked || menuActions.blocked}
                        onClick={() => handleStartCooking([item], false)}
                        className="min-h-12 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-zinc-950 font-extrabold text-xs shrink-0"
                      >
                        Nhận nấu đơn lẻ
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ==================================================================== */}
      {/* DRAWER BÁO HẾT MÓN NHANH (86ING - US-K03) */}
      {/* ==================================================================== */}
      {is86DrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex justify-end">
          <div className="bg-zinc-900 border-l border-zinc-800 max-w-md w-full h-full p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <h3 className="text-lg font-extrabold text-zinc-100">
                  Báo hết món nhanh (86ing)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIs86DrawerOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <MenuActionFeedback {...menuActions} recover={() => menuActions.run()} />
            <div className="relative">
              <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={drawerSearch}
                onChange={(e) => setDrawerSearch(e.target.value)}
                placeholder="Tìm món cần khóa / mở bán..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800 pr-1">
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
                      <div className="font-bold text-sm text-zinc-100">
                        {m.name}
                      </div>
                      <span className="text-xs text-zinc-400">
                        {m.station === 'KITCHEN' ? 'Món Bếp' : 'Quầy / Bia'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggle86MenuItem(m)}
                      disabled={isSubmitting || itemActions.blocked || menuActions.blocked}
                      className={cn(
                        'min-h-12 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors',
                        m.is_available
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-red-500/20 text-red-300 border-red-500/40'
                      )}
                    >
                      {m.is_available ? 'Đang còn hàng' : 'ĐÃ KHÓA (86)'}
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
