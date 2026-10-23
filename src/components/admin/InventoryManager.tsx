'use client';
import type { StaffDirectoryEntry as StaffProfileRow } from '@/lib/data/read-contracts';
import { useListPage, LocalListNavigation } from '@/components/ui/LocalListNavigation';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { acknowledgeInventory, pendingInventory, submitInventory } from '@/lib/inventory/client';
import {
  AlertTriangle,
  Plus,
  ArrowDownCircle,
  Trash2,
  Package,
  Search,
  Edit3,
  History,
  X,
} from 'lucide-react';
import { useMetadata } from '@/lib/metadata/use-metadata';
import { pendingMetadata } from '@/lib/metadata/client';
import { ingredientSnapshot } from '@/lib/metadata/contracts';
import { MetadataFeedback } from './MetadataFeedback';
import { formatVND, cn } from '@/lib/utils';
import type {
  IngredientRow,
  InventoryLogRow,
  InventoryLogType,
} from '@/types/database.types';

interface InventoryManagerProps {
  initialIngredients: IngredientRow[];
  initialLogs: InventoryLogRow[];
  staffProfiles: StaffProfileRow[];
  currentStaffId: string | null;
  remoteLogs?: boolean;
  initialLogType?: InventoryLogType | 'ALL';
}

const LOG_TYPE_CONFIG: Record<
  InventoryLogType,
  {
    label: string;
    badgeClass: string;
    isAddition: boolean;
    description: string;
  }
> = {
  IMPORT: {
    label: 'Nhập kho (+)',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    isAddition: true,
    description: 'Nhập thêm bia, nguyên liệu tươi sống vào kho',
  },
  RETURN_BEER: {
    label: 'Khách trả bia (+)',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    isAddition: true,
    description: 'Hoàn trả số lon bia khách không uống hết về lại kho',
  },
  EXPORT_SALE: {
    label: 'Xuất bán (-)',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    isAddition: false,
    description: 'Xuất nguyên liệu / đồ uống phục vụ bán hàng',
  },
  WASTAGE: {
    label: 'Xuất hủy hỏng (-)',
    badgeClass: 'bg-red-500/15 text-red-400 border-red-500/30',
    isAddition: false,
    description: 'Hủy nguyên liệu hư hỏng, đổ vỡ (tính vào Chi phí hao hụt KPI)',
  },
};

export function InventoryManager({
  initialIngredients,
  initialLogs,
  staffProfiles,
  currentStaffId,
  remoteLogs = false,
  initialLogType = 'ALL',
}: InventoryManagerProps) {
  const metadata = useMetadata(currentStaffId);
  const router = useRouter();
  const submissionLock = useRef(false);
  const [hasPending, setHasPending] = useState(false);
  const [journalBlocked, setJournalBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [ingredients, setIngredients] =
    useState<IngredientRow[]>(initialIngredients);
  const [logs, setLogs] = useState<InventoryLogRow[]>(initialLogs);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyLowStock, setOnlyLowStock] = useState<boolean>(false);
  const [logFilterType, setLogFilterType] = useState<InventoryLogType | 'ALL'>(
    initialLogType
  );
  useEffect(() => { setLogFilterType(initialLogType); }, [initialLogType]);
  function changeLogType(type: InventoryLogType | 'ALL') {
    if (remoteLogs) router.push(`/admin/inventory?type=${type}`);
    else setLogFilterType(type);
  }
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localBusy, setIsSubmitting] = useState<boolean>(false);
  const isSubmitting = localBusy || metadata.busy;

  // State Modal Thêm / Sửa nguyên liệu (ingredients)
  const [isIngredientModalOpen, setIsIngredientModalOpen] =
    useState<boolean>(false);
  const [editingIngredient, setEditingIngredient] =
    useState<IngredientRow | null>(null);
  const [ingName, setIngName] = useState<string>('');
  const [ingUnit, setIngUnit] = useState<string>('lon');
  const [ingMinThreshold, setIngMinThreshold] = useState<string>('24');
  const [ingUnitCost, setIngUnitCost] = useState<string>('0');

  // State Modal Xuất / Nhập / Hủy kho (inventory_logs)
  const [isLogModalOpen, setIsLogModalOpen] = useState<boolean>(false);
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>('');
  const [logType, setLogType] = useState<'IMPORT' | 'WASTAGE'>('IMPORT');
  const [logQuantity, setLogQuantity] = useState<string>('1');
  const [logUnitCost, setLogUnitCost] = useState<string>('0');
  const [logNote, setLogNote] = useState<string>('');

  useEffect(() => { setIngredients(initialIngredients); }, [initialIngredients]);
  useEffect(() => { setLogs(initialLogs); }, [initialLogs]);
  useEffect(() => {
    setJournalBlocked(false);
    setHasPending(false);
    if (!currentStaffId) { setJournalBlocked(true); return; }
    try { setHasPending(pendingInventory(currentStaffId) !== null); }
    catch (error) {
      setJournalBlocked(true);
      setErrorMessage(error instanceof Error ? error.message : 'Không đọc được phiếu đang gửi.');
    }
  }, [currentStaffId]);

  async function runInventory() {
    if (submissionLock.current || metadata.busy || metadata.pending || journalBlocked || !currentStaffId) return;
    submissionLock.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const common = { ingredientId: selectedIngredientId, quantity: Number(logQuantity), note: logNote };
      const result = await submitInventory(currentStaffId, hasPending ? undefined : logType === 'IMPORT'
        ? { ...common, type: 'IMPORT', unitCost: Number(logUnitCost) }
        : { ...common, type: 'WASTAGE', unitCost: null });
      acknowledgeInventory(currentStaffId, result.operationId);
      setIsLogModalOpen(false);
      setNotice(`Đã ghi phiếu kho ${result.quantityChange > 0 ? '+' : ''}${result.quantityChange}; giá trị ${formatVND(result.totalCost)}. Đang tải số liệu mới nhất.`);
      // Refresh authoritative current rows, never replay an old stock snapshot into local state.
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Chưa xác nhận được phiếu kho.');
    } finally {
      try {
        const pending = pendingInventory(currentStaffId) !== null;
        setHasPending(pending);
        if (pending) setIsLogModalOpen(false);
      }
      catch { setJournalBlocked(true); }
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  }

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    staffProfiles.forEach((s) => map.set(s.id, s.full_name));
    return map;
  }, [staffProfiles]);

  const ingredientById = useMemo(() => {
    const map = new Map<string, IngredientRow>();
    ingredients.forEach((item) => map.set(item.id, item));
    return map;
  }, [ingredients]);

  const lowStockCount = useMemo(
    () =>
      ingredients.filter((item) => item.stock_quantity <= item.min_threshold)
        .length,
    [ingredients]
  );

  const totalInventoryValue = useMemo(
    () =>
      ingredients.reduce(
        (sum, item) =>
          sum + Math.max(0, item.stock_quantity) * item.unit_cost,
        0
      ),
    [ingredients]
  );

  const totalWastageValue = useMemo(
    () =>
      logs
        .filter((l) => l.type === 'WASTAGE')
        .reduce((sum, l) => sum + Math.abs(l.total_cost), 0),
    [logs]
  );

  const filteredIngredients = useMemo(() => {
    return ingredients.filter((item) => {
      const matchesQuery =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.unit.toLowerCase().includes(searchQuery.toLowerCase());
      const isLow = item.stock_quantity <= item.min_threshold;
      if (onlyLowStock && !isLow) {
        return false;
      }
      return matchesQuery;
    });
  }, [ingredients, searchQuery, onlyLowStock]);

  const ingredientPage = useListPage(filteredIngredients, `${searchQuery}:${onlyLowStock}`);
  const filteredLogs = useMemo(() => {
    if (logFilterType === 'ALL') return logs;
    return logs.filter((l) => l.type === logFilterType);
  }, [logs, logFilterType]);

  function openCreateIngredientModal() {
    if (hasPending || journalBlocked || metadata.blocked || submissionLock.current) return;
    setEditingIngredient(null);
    setIngName('');
    setIngUnit('lon');
    setIngMinThreshold('24');
    setIngUnitCost('0');
    setErrorMessage(null);
    setIsIngredientModalOpen(true);
  }

  function openEditIngredientModal(item: IngredientRow) {
    if (hasPending || journalBlocked || metadata.blocked || submissionLock.current) return;
    setEditingIngredient(item);
    setIngName(item.name);
    setIngUnit(item.unit);
    setIngMinThreshold(String(item.min_threshold));
    setIngUnitCost(String(item.unit_cost));
    setErrorMessage(null);
    setIsIngredientModalOpen(true);
  }

  function openInventoryLogModal(
    ingredient?: IngredientRow,
    defaultType: 'IMPORT' | 'WASTAGE' = 'IMPORT'
  ) {
    if (hasPending || journalBlocked || metadata.blocked || submissionLock.current) return;
    const target = ingredient ?? ingredients[0];
    if (!target) {
      setErrorMessage('Vui lòng tạo ít nhất 1 nguyên liệu trước khi lập phiếu kho.');
      return;
    }
    setSelectedIngredientId(target.id);
    setLogType(defaultType);
    setLogQuantity('1');
    setLogUnitCost(String(target.unit_cost));
    setLogNote('');
    setErrorMessage(null);
    setIsLogModalOpen(true);
  }

  async function handleSaveIngredient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting || submissionLock.current || metadata.blocked || hasPending || journalBlocked) return;

    const trimmedName = ingName.trim();
    const trimmedUnit = ingUnit.trim();
    const parsedMinThreshold = Number(ingMinThreshold);
    const parsedUnitCost = Number(ingUnitCost);

    if (!trimmedName || !trimmedUnit) {
      setErrorMessage('Tên nguyên liệu và đơn vị tính không được để trống.');
      return;
    }

    if (
      !Number.isFinite(parsedMinThreshold) ||
      !Number.isFinite(parsedUnitCost) ||
      parsedMinThreshold < 0 ||
      parsedUnitCost < 0
    ) {
      setErrorMessage('Số lượng tồn, định mức tối thiểu và giá vốn phải hợp lệ.');
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const item = { name: trimmedName, unit: trimmedUnit, min_threshold: parsedMinThreshold };
      const confirmed = await metadata.run(editingIngredient
        ? { resource: 'INGREDIENT', action: 'UPDATE', id: editingIngredient.id, item, expected: ingredientSnapshot(editingIngredient) }
        : { resource: 'INGREDIENT', action: 'CREATE', id: crypto.randomUUID(), item, expected: null });
      if (confirmed || (currentStaffId && pendingMetadata(currentStaffId))) setIsIngredientModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi lưu nguyên liệu'
      );
    } finally {
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleCreateInventoryLog(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await runInventory();
  }

  return (
    <div className="space-y-6">
      <MetadataFeedback {...metadata} recover={() => metadata.run()} />
      {/* Header & Nút thao tác nhanh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">
            Quản lý Kho Nguyên liệu & Bia
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Nhập hàng và ghi nhận hủy hỏng. Xuất bán và trả bia được ghi qua đơn hàng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => openInventoryLogModal(undefined, 'IMPORT')}
            disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked}
            className="min-h-12 disabled:opacity-50 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors"
          >
            <ArrowDownCircle className="h-4 w-4" />
            Nhập kho / Hủy hỏng
          </button>
          <button
            type="button"
            onClick={openCreateIngredientModal}
            disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked}
            className="min-h-12 disabled:opacity-50 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Thêm nguyên liệu mới
          </button>
        </div>
      </div>

      {hasPending && (
        <div role="status" className="rounded-xl border border-amber-500 p-4 space-y-2">
          <p>Có phiếu kho chưa xác nhận. Kiểm tra phiếu này trước khi lập phiếu mới.</p>
          <button type="button" disabled={isSubmitting} onClick={() => void runInventory()}
            className="min-h-12 px-4 rounded-lg bg-amber-500 text-zinc-950 disabled:opacity-50">
            {isSubmitting ? 'Đang kiểm tra...' : 'Kiểm tra phiếu vừa gửi'}
          </button>
        </div>
      )}
      {notice && <p role="status" className="text-emerald-400">{notice}</p>}

      {/* 4 Thẻ thống kê nhanh */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs font-medium text-zinc-400">
            Tổng mặt hàng kho
          </div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">
            {ingredients.length} mặt hàng
          </div>
        </div>

        <div
          className={cn(
            'p-4 rounded-xl border transition-colors',
            lowStockCount > 0
              ? 'bg-red-950/40 border-red-500/50'
              : 'bg-zinc-900 border-zinc-800'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-red-300">
              Cảnh báo dưới mức tối thiểu
            </span>
            <AlertTriangle className="h-4 w-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold text-red-400 mt-1">
            {lowStockCount} mặt hàng
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs font-medium text-zinc-400">
            Tổng giá trị tồn kho ước tính
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {formatVND(totalInventoryValue)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs font-medium text-zinc-400">
            Hao hụt trong trang phiếu đang xem (WASTAGE)
          </div>
          <div className="text-2xl font-bold text-rose-400 mt-1">
            {formatVND(totalWastageValue)}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div role="alert" className="p-3.5 rounded-lg bg-red-950/60 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bộ lọc & Tìm kiếm nguyên liệu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/70 p-3.5 rounded-xl border border-zinc-800">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên nguyên liệu, bia, đơn vị (lon, két, kg)..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setOnlyLowStock((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors',
            onlyLowStock
              ? 'bg-red-500/20 border-red-500 text-red-300'
              : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          Chỉ hiện hàng sắp hết ({lowStockCount})
        </button>
      </div>

      {/* Bảng Danh sách Nguyên liệu (ingredients) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-400 bg-zinc-950/50">
                <th className="py-3.5 px-4">Tên nguyên liệu / Bia</th>
                <th className="py-3.5 px-4">Đơn vị</th>
                <th className="py-3.5 px-4 text-right">Tồn kho hiện tại</th>
                <th className="py-3.5 px-4 text-right">Định mức tối thiểu</th>
                <th className="py-3.5 px-4 text-right">Giá vốn / Đơn vị</th>
                <th className="py-3.5 px-4">Trạng thái</th>
                <th className="py-3.5 px-4 text-right">Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80 text-sm">
              {filteredIngredients.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-zinc-500"
                  >
                    Không có nguyên liệu nào khớp với bộ lọc.
                  </td>
                </tr>
              ) : (
                ingredientPage.pageItems.map((item) => {
                  const isLowStock = item.stock_quantity <= item.min_threshold;
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'transition-colors',
                        isLowStock
                          ? 'bg-red-950/30 hover:bg-red-950/45'
                          : 'hover:bg-zinc-800/40'
                      )}
                    >
                      <td className="py-3.5 px-4 font-semibold text-zinc-100">
                        <div className="flex items-center gap-2">
                          <Package
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isLowStock ? 'text-red-400' : 'text-amber-400'
                            )}
                          />
                          <span>{item.name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-300">{item.unit}</td>
                      <td
                        className={cn(
                          'py-3.5 px-4 text-right font-bold',
                          isLowStock ? 'text-red-400' : 'text-emerald-400'
                        )}
                      >
                        {item.stock_quantity.toLocaleString('vi-VN')} {item.unit}
                      </td>
                      <td className="py-3.5 px-4 text-right text-zinc-400">
                        {item.min_threshold.toLocaleString('vi-VN')} {item.unit}
                      </td>
                      <td className="py-3.5 px-4 text-right text-zinc-200">
                        {formatVND(item.unit_cost)}
                      </td>
                      <td className="py-3.5 px-4">
                        {isLowStock ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/40">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Sắp hết hàng
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            Đủ định mức
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              openInventoryLogModal(item, 'IMPORT')
                            }
                            title="Nhập thêm hàng"
                            disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked}
                            className="min-h-12 min-w-12 disabled:opacity-50 px-2.5 py-1.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-medium border border-emerald-500/30"
                          >
                            + Nhập
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openInventoryLogModal(item, 'WASTAGE')
                            }
                            title="Xuất hủy hàng hỏng"
                            disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked}
                            className="min-h-12 min-w-12 disabled:opacity-50 px-2.5 py-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium border border-red-500/30"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditIngredientModal(item)}
                            title="Chỉnh sửa định mức"
                            className="p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LocalListNavigation {...ingredientPage} label="Nguyên liệu" />
      {/* Bảng Lịch sử Xuất / Nhập / Hủy kho (inventory_logs) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-amber-400" />
            <h3 className="font-bold text-lg text-zinc-100">
              Lịch sử Xuất / Nhập / Hủy kho gần đây
            </h3>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              ['ALL', 'IMPORT', 'EXPORT_SALE', 'RETURN_BEER', 'WASTAGE'] as const
            ).map((typeKey) => (
              <button
                key={typeKey}
                type="button"
                onClick={() => changeLogType(typeKey)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  logFilterType === typeKey
                    ? 'bg-amber-500 text-zinc-950 border-amber-500 font-semibold'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                )}
              >
                {typeKey === 'ALL'
                  ? 'Tất cả phiếu'
                  : LOG_TYPE_CONFIG[typeKey].label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                <th className="py-3 px-3">Thời gian</th>
                <th className="py-3 px-3">Loại phiếu</th>
                <th className="py-3 px-3">Nguyên liệu</th>
                <th className="py-3 px-3 text-right">Biến động</th>
                <th className="py-3 px-3 text-right">Tổng giá trị</th>
                <th className="py-3 px-3">Ghi chú</th>
                <th className="py-3 px-3">Người tạo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-sm">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    Chưa có lịch sử phiếu kho nào.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const ing = ingredientById.get(log.ingredient_id);
                  const cfg = LOG_TYPE_CONFIG[log.type];
                  return (
                    <tr key={log.id} className="hover:bg-zinc-800/30">
                      <td className="py-3 px-3 text-xs text-zinc-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('vi-VN')}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
                            cfg.badgeClass
                          )}
                        >
                          {cfg.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-medium text-zinc-200">
                        {ing?.name ?? 'Nguyên liệu đã xóa'}
                      </td>
                      <td
                        className={cn(
                          'py-3 px-3 text-right font-bold',
                          log.quantity_change >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        )}
                      >
                        {log.quantity_change > 0
                          ? `+${log.quantity_change}`
                          : log.quantity_change}{' '}
                        {ing?.unit ?? ''}
                      </td>
                      <td className="py-3 px-3 text-right text-zinc-200">
                        {formatVND(log.total_cost)}
                      </td>
                      <td className="py-3 px-3 text-zinc-400">
                        {log.note ?? '—'}
                      </td>
                      <td className="py-3 px-3 text-xs text-zinc-400">
                        {log.created_by
                          ? staffNameById.get(log.created_by) ?? log.created_by
                          : 'Hệ thống / Admin'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Thêm / Chỉnh sửa Nguyên liệu (ingredients) */}
      {isIngredientModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="ingredient-title" className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 id="ingredient-title" className="text-lg font-bold text-zinc-100">
                {editingIngredient
                  ? 'Chỉnh sửa Nguyên liệu'
                  : 'Thêm Nguyên liệu / Bia mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsIngredientModalOpen(false)}
                aria-label="Đóng form nguyên liệu"
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIngredient} className="space-y-4">
              <fieldset disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked} className="space-y-4">
                {metadata.error && <p role="alert" className="text-red-300">{metadata.error}</p>}
                {errorMessage && <p role="alert" className="text-red-300">{errorMessage}</p>}
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Tên nguyên liệu / Bia *
                  </label>
                  <input
                    type="text"
                    required
                    value={ingName}
                    onChange={(e) => setIngName(e.target.value)}
                    placeholder="VD: Bia Tiger Crystal, Ếch đồng tươi..."
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Đơn vị tính *
                    </label>
                    <input
                      type="text"
                      required
                      value={ingUnit}
                      onChange={(e) => setIngUnit(e.target.value)}
                      placeholder="lon, chai, kg, phần..."
                      className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Giá vốn hiện tại (đổi qua phiếu nhập)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      required
                      value={ingUnitCost}
                      disabled
                      onChange={(e) => setIngUnitCost(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                </div>

                <p className="text-xs text-zinc-400">Nguyên liệu mới có tồn và giá vốn bằng 0. Dùng phiếu nhập để ghi nhận hàng và giá vốn, giữ đủ lịch sử kho.</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Mức cảnh báo tối thiểu *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={ingMinThreshold}
                      onChange={(e) => setIngMinThreshold(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setIsIngredientModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm font-medium"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked}
                    className="min-h-12 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 text-sm font-semibold"
                  >
                    {isSubmitting ? 'Đang lưu...' : 'Lưu nguyên liệu'}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Lập phiếu Nhập / Xuất / Trả bia / Hủy kho (inventory_logs) */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="inventory-title" className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 id="inventory-title" className="text-lg font-bold text-zinc-100">
                Nhập kho / Hủy hỏng
              </h3>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                aria-label="Đóng phiếu kho"
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInventoryLog} className="space-y-4">
              <fieldset disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked} className="space-y-4">
                {errorMessage && <p role="alert" className="text-red-300">{errorMessage}</p>}
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Loại giao dịch kho *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        {
                          type: 'IMPORT',
                          icon: ArrowDownCircle,
                        },
                        {
                          type: 'WASTAGE',
                          icon: Trash2,
                        },
                      ] as const
                    ).map(({ type, icon: Icon }) => {
                      const cfg = LOG_TYPE_CONFIG[type];
                      const active = logType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setLogType(type)}
                          className={cn(
                            'min-h-12 flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs font-medium transition-all',
                            active
                              ? cfg.badgeClass + ' ring-1 ring-current'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1.5">
                    {LOG_TYPE_CONFIG[logType].description}
                  </p>
                </div>

                <div>
                  <label htmlFor="inventory-ingredient" className="block text-xs font-medium text-zinc-300 mb-1">
                    Chọn nguyên liệu / Bia *
                  </label>
                  <select
                    id="inventory-ingredient"
                    value={selectedIngredientId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedIngredientId(id);
                      const ing = ingredientById.get(id);
                      if (ing) {
                        setLogUnitCost(String(ing.unit_cost));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  >
                    {ingredients.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} (Tồn: {item.stock_quantity} {item.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="inventory-quantity" className="block text-xs font-medium text-zinc-300 mb-1">
                      Số lượng ({ingredientById.get(selectedIngredientId)?.unit ?? 'đơn vị'}) *
                    </label>
                    <input
                      id="inventory-quantity"
                      type="number"
                      min="0.001"
                      max="1000000"
                      step="0.001"
                      required
                      value={logQuantity}
                      onChange={(e) => setLogQuantity(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="inventory-cost" className="block text-xs font-medium text-zinc-300 mb-1">
                      Đơn giá vốn (VNĐ) *
                    </label>
                    <input
                      id="inventory-cost"
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      required
                      value={logUnitCost}
                      disabled={logType === 'WASTAGE'}
                      onChange={(e) => setLogUnitCost(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                    />
                  </div>
                </div>

                {logType === 'WASTAGE' && <p className="text-xs text-zinc-400">Giá trị hủy dùng giá vốn hiện tại ở kho khi xác nhận; không nhập tay.</p>}

                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Giá trị dự kiến:</span>
                  <span className="font-bold text-sm text-amber-400">
                    {formatVND(
                      Math.max(0, Number(logQuantity) || 0) *
                        Math.max(0, logType === 'WASTAGE' ? ingredientById.get(selectedIngredientId)?.unit_cost ?? 0 : Number(logUnitCost) || 0)
                    )}
                  </span>
                </div>

                <div>
                  <label htmlFor="inventory-note" className="block text-xs font-medium text-zinc-300 mb-1">
                    {logType === 'WASTAGE' ? 'Lý do hủy hỏng *' : 'Ghi chú phiếu kho'}
                  </label>
                  <input
                    id="inventory-note"
                    type="text"
                    maxLength={500}
                    required={logType === 'WASTAGE'}
                    value={logNote}
                    onChange={(e) => setLogNote(e.target.value)}
                    placeholder="VD: Nhập 10 két Tiger từ đại lý Hải Sơn..."
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setIsLogModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm font-medium"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || metadata.blocked || hasPending || journalBlocked}
                    className="min-h-12 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold"
                  >
                    {isSubmitting ? 'Đang xử lý...' : 'Xác nhận & Cập nhật tồn kho'}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
