'use client';

import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  Trash2,
  RotateCcw,
  Package,
  Search,
  Edit3,
  History,
  X,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatVND, cn } from '@/lib/utils';
import type {
  IngredientRow,
  InventoryLogRow,
  InventoryLogType,
  StaffProfileRow,
} from '@/types/database.types';

interface InventoryManagerProps {
  initialIngredients: IngredientRow[];
  initialLogs: InventoryLogRow[];
  staffProfiles: StaffProfileRow[];
  currentStaffId: string | null;
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
    badgeClass: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30',
    isAddition: true,
    description: 'Nhập thêm bia, nguyên liệu tươi sống vào kho',
  },
  RETURN_BEER: {
    label: 'Khách trả bia (+)',
    badgeClass: 'bg-sky-500/15 text-sky-800 border-sky-500/30',
    isAddition: true,
    description: 'Hoàn trả số lon bia khách không uống hết về lại kho',
  },
  EXPORT_SALE: {
    label: 'Xuất bán (-)',
    badgeClass: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
    isAddition: false,
    description: 'Xuất nguyên liệu / đồ uống phục vụ bán hàng',
  },
  WASTAGE: {
    label: 'Xuất hủy hỏng (-)',
    badgeClass: 'bg-red-500/15 text-red-800 border-red-500/30',
    isAddition: false,
    description: 'Ghi lại hàng hỏng, đổ vỡ và số tiền hao hụt',
  },
};

export function InventoryManager({
  initialIngredients,
  initialLogs,
  staffProfiles,
  currentStaffId,
}: InventoryManagerProps) {
  const supabase = createSupabaseBrowserClient();

  const [ingredients, setIngredients] =
    useState<IngredientRow[]>(initialIngredients);
  const [logs, setLogs] = useState<InventoryLogRow[]>(initialLogs);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyLowStock, setOnlyLowStock] = useState<boolean>(false);
  const [logFilterType, setLogFilterType] = useState<InventoryLogType | 'ALL'>(
    'ALL'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // State Modal Thêm / Sửa nguyên liệu (ingredients)
  const [isIngredientModalOpen, setIsIngredientModalOpen] =
    useState<boolean>(false);
  const [editingIngredient, setEditingIngredient] =
    useState<IngredientRow | null>(null);
  const [ingName, setIngName] = useState<string>('');
  const [ingUnit, setIngUnit] = useState<string>('lon');
  const [ingStock, setIngStock] = useState<string>('0');
  const [ingMinThreshold, setIngMinThreshold] = useState<string>('24');
  const [ingUnitCost, setIngUnitCost] = useState<string>('0');

  // State Modal Xuất / Nhập / Hủy kho (inventory_logs)
  const [isLogModalOpen, setIsLogModalOpen] = useState<boolean>(false);
  const [selectedIngredientId, setSelectedIngredientId] = useState<string>('');
  const [logType, setLogType] = useState<InventoryLogType>('IMPORT');
  const [logQuantity, setLogQuantity] = useState<string>('1');
  const [logUnitCost, setLogUnitCost] = useState<string>('0');
  const [logNote, setLogNote] = useState<string>('');

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

  const filteredLogs = useMemo(() => {
    if (logFilterType === 'ALL') return logs;
    return logs.filter((l) => l.type === logFilterType);
  }, [logs, logFilterType]);

  function openCreateIngredientModal() {
    setEditingIngredient(null);
    setIngName('');
    setIngUnit('lon');
    setIngStock('0');
    setIngMinThreshold('24');
    setIngUnitCost('12000');
    setErrorMessage(null);
    setIsIngredientModalOpen(true);
  }

  function openEditIngredientModal(item: IngredientRow) {
    setEditingIngredient(item);
    setIngName(item.name);
    setIngUnit(item.unit);
    setIngStock(String(item.stock_quantity));
    setIngMinThreshold(String(item.min_threshold));
    setIngUnitCost(String(item.unit_cost));
    setErrorMessage(null);
    setIsIngredientModalOpen(true);
  }

  function openInventoryLogModal(
    ingredient?: IngredientRow,
    defaultType: InventoryLogType = 'IMPORT'
  ) {
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
    if (isSubmitting) return;

    const trimmedName = ingName.trim();
    const trimmedUnit = ingUnit.trim();
    const parsedStock = Number(ingStock);
    const parsedMinThreshold = Number(ingMinThreshold);
    const parsedUnitCost = Number(ingUnitCost);

    if (!trimmedName || !trimmedUnit) {
      setErrorMessage('Tên nguyên liệu và đơn vị tính không được để trống.');
      return;
    }

    if (
      Number.isNaN(parsedStock) ||
      Number.isNaN(parsedMinThreshold) ||
      Number.isNaN(parsedUnitCost) ||
      parsedMinThreshold < 0 ||
      parsedUnitCost < 0
    ) {
      setErrorMessage('Số lượng tồn, định mức tối thiểu và giá vốn phải hợp lệ.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingIngredient) {
        const { data, error } = await supabase
          .from('ingredients')
          .update({
            name: trimmedName,
            unit: trimmedUnit,
            stock_quantity: parsedStock,
            min_threshold: parsedMinThreshold,
            unit_cost: parsedUnitCost,
          })
          .eq('id', editingIngredient.id)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể cập nhật nguyên liệu');
        }

        setIngredients((prev) =>
          prev.map((item) => (item.id === data.id ? data : item))
        );
      } else {
        const { data, error } = await supabase
          .from('ingredients')
          .insert({
            name: trimmedName,
            unit: trimmedUnit,
            stock_quantity: parsedStock,
            min_threshold: parsedMinThreshold,
            unit_cost: parsedUnitCost,
          })
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể thêm nguyên liệu mới');
        }

        setIngredients((prev) => [data, ...prev]);
      }

      setIsIngredientModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi lưu nguyên liệu'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateInventoryLog(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const targetIngredient = ingredientById.get(selectedIngredientId);
    if (!targetIngredient) {
      setErrorMessage('Không tìm thấy nguyên liệu được chọn.');
      return;
    }

    const rawQty = Number(logQuantity);
    const parsedUnitCost = Number(logUnitCost);

    if (Number.isNaN(rawQty) || rawQty <= 0) {
      setErrorMessage('Số lượng xuất/nhập phải lớn hơn 0.');
      return;
    }

    if (Number.isNaN(parsedUnitCost) || parsedUnitCost < 0) {
      setErrorMessage('Đơn giá không hợp lệ.');
      return;
    }

    const isAddition = LOG_TYPE_CONFIG[logType].isAddition;
    const absQty = Math.abs(rawQty);
    const signedQuantityChange = isAddition ? absQty : -absQty;
    const newStockQuantity = Number(
      (targetIngredient.stock_quantity + signedQuantityChange).toFixed(3)
    );

    if (!isAddition && newStockQuantity < 0) {
      setErrorMessage(
        `Không đủ tồn kho để trừ! Hiện còn ${targetIngredient.stock_quantity} ${targetIngredient.unit}.`
      );
      return;
    }

    const calculatedTotalCost = Math.round(absQty * parsedUnitCost);

    // Đảm bảo created_by hợp lệ với FK staff_profiles.id (nếu chưa có trong bảng staff_profiles thì để null)
    const validStaffId =
      currentStaffId && staffNameById.has(currentStaffId)
        ? currentStaffId
        : null;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Tạo bản ghi lịch sử kho trong inventory_logs
      const { data: insertedLog, error: logError } = await supabase
        .from('inventory_logs')
        .insert({
          ingredient_id: targetIngredient.id,
          type: logType,
          quantity_change: signedQuantityChange,
          total_cost: calculatedTotalCost,
          note: logNote.trim() || null,
          created_by: validStaffId,
        })
        .select('*')
        .single();

      if (logError || !insertedLog) {
        throw new Error(logError?.message ?? 'Không thể ghi phiếu kho');
      }

      // 2. Tự động cộng/trừ stock_quantity trên bảng ingredients
      const updatedUnitCost =
        logType === 'IMPORT' && parsedUnitCost > 0
          ? parsedUnitCost
          : targetIngredient.unit_cost;

      const { data: updatedIngredient, error: updateError } = await supabase
        .from('ingredients')
        .update({
          stock_quantity: newStockQuantity,
          unit_cost: updatedUnitCost,
        })
        .eq('id', targetIngredient.id)
        .select('*')
        .single();

      if (updateError || !updatedIngredient) {
        throw new Error(
          updateError?.message ?? 'Không thể cập nhật số lượng tồn kho'
        );
      }

      setIngredients((prev) =>
        prev.map((item) =>
          item.id === updatedIngredient.id ? updatedIngredient : item
        )
      );
      setLogs((prev) => [insertedLog, ...prev]);
      setIsLogModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi thực hiện phiếu kho'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Nút thao tác nhanh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">
            Quản lý Kho Nguyên liệu & Bia
          </h2>
          <p className="text-sm text-muted-ink mt-1">
            Theo dõi định mức tồn kho thực tế, lập phiếu Nhập hàng, Xuất bán, Trả bia thừa và Hủy hàng hỏng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => openInventoryLogModal(undefined, 'IMPORT')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm transition-colors"
          >
            <ArrowDownCircle className="h-4 w-4" />
            Lập phiếu Nhập / Xuất kho
          </button>
          <button
            type="button"
            onClick={openCreateIngredientModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink font-semibold text-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Thêm nguyên liệu mới
          </button>
        </div>
      </div>

      {/* 4 Thẻ thống kê nhanh */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-xs font-medium text-muted-ink">
            Tổng mặt hàng kho
          </div>
          <div className="text-2xl font-bold text-ink mt-1">
            {ingredients.length} mặt hàng
          </div>
        </div>

        <div
          className={cn(
            'p-4 rounded-xl border transition-colors',
            lowStockCount > 0
              ? 'bg-red-50/40 border-red-500/50'
              : 'bg-surface border-line'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-red-800">
              Cảnh báo dưới mức tối thiểu
            </span>
            <AlertTriangle className="h-4 w-4 text-red-800" />
          </div>
          <div className="text-2xl font-bold text-red-800 mt-1">
            {lowStockCount} mặt hàng
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-xs font-medium text-muted-ink">
            Tổng giá trị tồn kho ước tính
          </div>
          <div className="text-2xl font-bold text-amber-800 mt-1">
            {formatVND(totalInventoryValue)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-xs font-medium text-muted-ink">
            Chi phí hao hụt kho (WASTAGE)
          </div>
          <div className="text-2xl font-bold text-rose-400 mt-1">
            {formatVND(totalWastageValue)}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-red-50/60 border border-red-500/50 text-red-800 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-800 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bộ lọc & Tìm kiếm nguyên liệu */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface/70 p-3.5 rounded-xl border border-line">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-muted-ink absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên nguyên liệu, bia, đơn vị (lon, két, kg)..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-soft border border-line text-sm text-ink placeholder:text-muted-ink focus:outline-none focus:border-amber-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setOnlyLowStock((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors',
            onlyLowStock
              ? 'bg-red-500/20 border-red-500 text-red-800'
              : 'bg-soft border-line text-ink hover:border-line'
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-red-800" />
          Chỉ hiện hàng sắp hết ({lowStockCount})
        </button>
      </div>

      {/* Bảng Danh sách Nguyên liệu (ingredients) */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line text-xs uppercase text-muted-ink bg-soft/50">
                <th className="py-3.5 px-4">Tên nguyên liệu / Bia</th>
                <th className="py-3.5 px-4">Đơn vị</th>
                <th className="py-3.5 px-4 text-right">Tồn kho hiện tại</th>
                <th className="py-3.5 px-4 text-right">Định mức tối thiểu</th>
                <th className="py-3.5 px-4 text-right">Giá vốn / Đơn vị</th>
                <th className="py-3.5 px-4">Trạng thái</th>
                <th className="py-3.5 px-4 text-right">Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/80 text-sm">
              {filteredIngredients.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-muted-ink"
                  >
                    Không có nguyên liệu nào khớp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredIngredients.map((item) => {
                  const isLowStock = item.stock_quantity <= item.min_threshold;
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'transition-colors',
                        isLowStock
                          ? 'bg-red-50/30 hover:bg-red-50/45'
                          : 'hover:bg-muted/40'
                      )}
                    >
                      <td className="py-3.5 px-4 font-semibold text-ink">
                        <div className="flex items-center gap-2">
                          <Package
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isLowStock ? 'text-red-800' : 'text-amber-800'
                            )}
                          />
                          <span>{item.name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-ink">{item.unit}</td>
                      <td
                        className={cn(
                          'py-3.5 px-4 text-right font-bold',
                          isLowStock ? 'text-red-800' : 'text-emerald-800'
                        )}
                      >
                        {item.stock_quantity.toLocaleString('vi-VN')} {item.unit}
                      </td>
                      <td className="py-3.5 px-4 text-right text-muted-ink">
                        {item.min_threshold.toLocaleString('vi-VN')} {item.unit}
                      </td>
                      <td className="py-3.5 px-4 text-right text-ink">
                        {formatVND(item.unit_cost)}
                      </td>
                      <td className="py-3.5 px-4">
                        {isLowStock ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-800 border border-red-500/40">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Sắp hết hàng
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-800 border border-emerald-500/30">
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
                            className="px-2.5 py-1.5 rounded-md bg-emerald-500/15 hover:bg-emerald-800/25 text-emerald-800 text-xs font-medium border border-emerald-500/30"
                          >
                            + Nhập
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openInventoryLogModal(item, 'EXPORT_SALE')
                            }
                            title="Xuất kho"
                            className="px-2.5 py-1.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 text-xs font-medium border border-amber-500/30"
                          >
                            - Xuất
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openInventoryLogModal(item, 'WASTAGE')
                            }
                            title="Xuất hủy hàng hỏng"
                            className="px-2.5 py-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-800 text-xs font-medium border border-red-500/30"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditIngredientModal(item)}
                            title="Chỉnh sửa định mức"
                            className="p-1.5 rounded-md bg-muted hover:bg-stone-200 text-ink"
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

      {/* Bảng Lịch sử Xuất / Nhập / Hủy kho (inventory_logs) */}
      <div className="bg-surface border border-line rounded-xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-amber-800" />
            <h3 className="font-bold text-lg text-ink">
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
                onClick={() => setLogFilterType(typeKey)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  logFilterType === typeKey
                    ? 'bg-amber-500 text-ink border-amber-500 font-semibold'
                    : 'bg-soft text-muted-ink border-line hover:text-ink'
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
              <tr className="border-b border-line text-xs uppercase text-muted-ink">
                <th className="py-3 px-3">Thời gian</th>
                <th className="py-3 px-3">Loại phiếu</th>
                <th className="py-3 px-3">Nguyên liệu</th>
                <th className="py-3 px-3 text-right">Biến động</th>
                <th className="py-3 px-3 text-right">Tổng giá trị</th>
                <th className="py-3 px-3">Ghi chú</th>
                <th className="py-3 px-3">Người tạo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 text-sm">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-ink">
                    Chưa có lịch sử phiếu kho nào.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const ing = ingredientById.get(log.ingredient_id);
                  const cfg = LOG_TYPE_CONFIG[log.type];
                  return (
                    <tr key={log.id} className="hover:bg-muted/30">
                      <td className="py-3 px-3 text-xs text-muted-ink whitespace-nowrap">
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
                      <td className="py-3 px-3 font-medium text-ink">
                        {ing?.name ?? 'Nguyên liệu đã xóa'}
                      </td>
                      <td
                        className={cn(
                          'py-3 px-3 text-right font-bold',
                          log.quantity_change >= 0
                            ? 'text-emerald-800'
                            : 'text-red-800'
                        )}
                      >
                        {log.quantity_change > 0
                          ? `+${log.quantity_change}`
                          : log.quantity_change}{' '}
                        {ing?.unit ?? ''}
                      </td>
                      <td className="py-3 px-3 text-right text-ink">
                        {formatVND(log.total_cost)}
                      </td>
                      <td className="py-3 px-3 text-muted-ink">
                        {log.note ?? '—'}
                      </td>
                      <td className="py-3 px-3 text-xs text-muted-ink">
                        {log.created_by
                          ? staffNameById.get(log.created_by) ?? log.created_by
                          : 'Quán'}
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
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                {editingIngredient
                  ? 'Chỉnh sửa Nguyên liệu'
                  : 'Thêm Nguyên liệu / Bia mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsIngredientModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIngredient} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Tên nguyên liệu / Bia *
                </label>
                <input
                  type="text"
                  required
                  value={ingName}
                  onChange={(e) => setIngName(e.target.value)}
                  placeholder="VD: Bia Tiger Crystal, Ếch đồng tươi..."
                  className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Đơn vị tính *
                  </label>
                  <input
                    type="text"
                    required
                    value={ingUnit}
                    onChange={(e) => setIngUnit(e.target.value)}
                    placeholder="lon, chai, kg, phần..."
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Giá vốn / 1 đơn vị (VNĐ) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    required
                    value={ingUnitCost}
                    onChange={(e) => setIngUnitCost(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Số lượng tồn ban đầu
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={ingStock}
                    onChange={(e) => setIngStock(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Mức cảnh báo tối thiểu *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={ingMinThreshold}
                    onChange={(e) => setIngMinThreshold(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsIngredientModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-ink text-sm font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-ink text-sm font-semibold"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Lưu nguyên liệu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Lập phiếu Nhập / Xuất / Trả bia / Hủy kho (inventory_logs) */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                Lập phiếu Nhập / Xuất / Hủy kho
              </h3>
              <button
                type="button"
                onClick={() => setIsLogModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInventoryLog} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1.5">
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
                        type: 'EXPORT_SALE',
                        icon: ArrowUpCircle,
                      },
                      {
                        type: 'RETURN_BEER',
                        icon: RotateCcw,
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
                          'flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs font-medium transition-all',
                          active
                            ? cfg.badgeClass + ' ring-1 ring-current'
                            : 'bg-soft border-line text-muted-ink hover:text-ink'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-ink mt-1.5">
                  {LOG_TYPE_CONFIG[logType].description}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Chọn nguyên liệu / Bia *
                </label>
                <select
                  value={selectedIngredientId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedIngredientId(id);
                    const ing = ingredientById.get(id);
                    if (ing) {
                      setLogUnitCost(String(ing.unit_cost));
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-soft border border-line text-sm text-ink"
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
                  <label className="block text-xs font-medium text-ink mb-1">
                    Số lượng ({ingredientById.get(selectedIngredientId)?.unit ?? 'đơn vị'}) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={logQuantity}
                    onChange={(e) => setLogQuantity(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Đơn giá vốn (VNĐ) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    required
                    value={logUnitCost}
                    onChange={(e) => setLogUnitCost(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-soft border border-line flex items-center justify-between text-xs">
                <span className="text-muted-ink">Tổng giá trị phiếu:</span>
                <span className="font-bold text-sm text-amber-800">
                  {formatVND(
                    Math.max(0, Number(logQuantity) || 0) *
                      Math.max(0, Number(logUnitCost) || 0)
                  )}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Ghi chú phiếu kho
                </label>
                <input
                  type="text"
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  placeholder="VD: Nhập 10 két Tiger từ đại lý Hải Sơn..."
                  className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsLogModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-ink text-sm font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {isSubmitting ? 'Đang xử lý...' : 'Xác nhận & Cập nhật tồn kho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
