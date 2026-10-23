'use client';
import { useListPage, LocalListNavigation } from '@/components/ui/LocalListNavigation';

import { useState, useMemo, useEffect, useRef } from 'react';
import { pendingMenuAction } from '@/lib/menu/client';
import { useMenuActions } from '@/lib/menu/use-menu-actions';
import { menuSnapshot } from '@/lib/menu/contracts';
import { MenuActionFeedback } from './MenuActionFeedback';
import {
  UtensilsCrossed,
  Plus,
  Search,
  Edit3,
  Trash2,
  ChefHat,
  Beer,
  Upload,
  Clock,
  CheckCircle2,
  Ban,
  Link2,
  X,
} from 'lucide-react';
import { uploadMenuImage, cleanupMenuImages } from '@/lib/menu-images/client';
import { compressMenuImageToWebP, formatVND, cn } from '@/lib/utils';
import type {
  IngredientRow,
  MenuCategory,
  MenuItemRow,
  StationType,
} from '@/types/database.types';

interface MenuManagerProps {
  currentStaffId: string;
  initialMenuItems: MenuItemRow[];
  ingredients: IngredientRow[];
}

const CATEGORY_LABELS: Record<
  MenuCategory,
  { label: string; badgeClass: string }
> = {
  FOOD: {
    label: 'Mồi nhậu (FOOD)',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  BEER: {
    label: 'Bia (BEER)',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  DRINK: {
    label: 'Nước ngọt / Đồ uống (DRINK)',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  },
  OTHER: {
    label: 'Khác / Khăn lạnh (OTHER)',
    badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
};

const STATION_LABELS: Record<
  StationType,
  { label: string; description: string; badgeClass: string }
> = {
  KITCHEN: {
    label: 'Bếp chế biến (KITCHEN)',
    description: 'Đẩy vào màn hình KDS Bếp (QUEUED -> COOKING -> READY)',
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  BAR_INSTANT: {
    label: 'Quầy / Lấy ngay (BAR_INSTANT)',
    description:
      'Không qua Bếp, set thẳng READY và báo Nhân viên chạy bàn mang ra ngay',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
};


export function MenuManager({
  initialMenuItems,
  currentStaffId,
  ingredients,
}: MenuManagerProps) {
  const imageLock = useRef(false);
  const menuActions = useMenuActions(currentStaffId);

  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  useEffect(() => { setMenuItems(initialMenuItems); }, [initialMenuItems]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<MenuCategory | 'ALL'>(
    'ALL'
  );
  const [stationFilter, setStationFilter] = useState<StationType | 'ALL'>(
    'ALL'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSubmitting = menuActions.busy;

  // State Modal Thêm / Sửa Món ăn (menu_items)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null);
  const [name, setName] = useState<string>('');
  const [category, setCategory] = useState<MenuCategory>('FOOD');
  const [station, setStation] = useState<StationType>('KITCHEN');
  const [price, setPrice] = useState<string>('');
  const [costPrice, setCostPrice] = useState<string>('');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<string>('10');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [linkedIngredientId, setLinkedIngredientId] = useState<string>('');

  // State nén ảnh WebP < 80KB & Upload lên Supabase Storage
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const [compressionInfo, setCompressionInfo] = useState<string | null>(null);

  const ingredientById = useMemo(() => {
    const map = new Map<string, IngredientRow>();
    ingredients.forEach((ing) => map.set(ing.id, ing));
    return map;
  }, [ingredients]);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesName = item.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesCategory =
        categoryFilter === 'ALL' || item.category === categoryFilter;
      const matchesStation =
        stationFilter === 'ALL' || item.station === stationFilter;
      return matchesName && matchesCategory && matchesStation;
    });
  }, [menuItems, searchQuery, categoryFilter, stationFilter]);

  const listPage = useListPage(filteredItems, `${searchQuery}:${categoryFilter}:${stationFilter}`);

  function openCreateModal() {
    if (imageLock.current || menuActions.blocked) return;
    setEditingItem(null);
    setName('');
    setCategory('FOOD');
    setStation('KITCHEN');
    setPrice('');
    setCostPrice('');
    setPrepTimeMinutes('10');
    setImageUrl('');
    setIsAvailable(true);
    setLinkedIngredientId('');
    setCompressionInfo(null);
    setErrorMessage(null);
    setIsModalOpen(true);
  }

  function openEditModal(item: MenuItemRow) {
    if (imageLock.current || menuActions.blocked) return;
    setEditingItem(item);
    setName(item.name);
    setCategory(item.category);
    setStation(item.station);
    setPrice(String(item.price));
    setCostPrice(String(item.cost_price));
    setPrepTimeMinutes(String(item.prep_time_minutes));
    setImageUrl(item.image_url ?? '');
    setIsAvailable(item.is_available);
    setLinkedIngredientId(item.linked_ingredient_id ?? '');
    setCompressionInfo(null);
    setErrorMessage(null);
    setIsModalOpen(true);
  }

  /**
   * Nén ảnh phía Client sang WebP < 80KB bằng browser-image-compression
   * trước khi đẩy lên Supabase Storage (Tuân thủ Mục 10.1 PRD_SPEC.md)
   */
  async function handleImageFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const input = e.currentTarget;
    const rawFile = input.files?.[0];
    if (!rawFile || imageLock.current || menuActions.blocked) return;
    imageLock.current = true;
    setIsUploadingImage(true); setErrorMessage(null); setCompressionInfo(null);
    try {
      const compressed = await compressMenuImageToWebP(rawFile);
      const uploaded = await uploadMenuImage(compressed);
      setImageUrl(uploaded.url);
      setCompressionInfo(`${(rawFile.size / 1024).toFixed(1)}KB -> ${(compressed.size / 1024).toFixed(1)}KB`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Chưa xác nhận ảnh tải lên. Vui lòng chọn lại ảnh.');
    } finally {
      input.value = ''; imageLock.current = false; setIsUploadingImage(false);
    }
  }

  async function handleCleanupImages() {
    if (imageLock.current || menuActions.blocked) return;
    imageLock.current = true; setIsUploadingImage(true); setImageNotice(null); setErrorMessage(null);
    try {
      const result = await cleanupMenuImages();
      setImageNotice(`Đã dọn ${result.removed} ảnh không dùng; ${result.failed} ảnh cần kiểm tra lại.`);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Chưa xác nhận kết quả dọn ảnh.'); }
    finally { imageLock.current = false; setIsUploadingImage(false); }
  }

  /**
   * Nút gạt "Tạm hết hàng (86ing)" cập nhật tức thì cột is_available trên bảng menu_items
   */
  async function handleToggleAvailability(item: MenuItemRow) {
    if (menuActions.blocked || isUploadingImage || imageLock.current) return;
    await menuActions.run({ action: 'AVAILABILITY', id: item.id, item: { is_available: !item.is_available }, expected: { is_available: item.is_available } });
  }

  async function handleSaveMenuItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (menuActions.blocked || isUploadingImage || imageLock.current) return;

    const trimmedName = name.trim();
    const parsedPrice = Number(price);
    const parsedCostPrice = Number(costPrice);
    const parsedPrepTime = Number(prepTimeMinutes);

    if (!trimmedName) {
      setErrorMessage('Tên món ăn không được để trống.');
      return;
    }

    if (
      Number.isNaN(parsedPrice) ||
      parsedPrice < 0 ||
      Number.isNaN(parsedCostPrice) ||
      parsedCostPrice < 0 ||
      Number.isNaN(parsedPrepTime) ||
      parsedPrepTime < 0
    ) {
      setErrorMessage('Giá bán, giá vốn và thời gian nấu chuẩn phải hợp lệ.');
      return;
    }

    setErrorMessage(null);

    try {
      const payload = {
        name: trimmedName,
        category,
        station,
        price: parsedPrice,
        cost_price: parsedCostPrice,
        prep_time_minutes: parsedPrepTime,
        image_url: imageUrl.trim() || null,
        is_available: isAvailable,
        linked_ingredient_id: linkedIngredientId || null,
      };

      const confirmed = await menuActions.run(editingItem
        ? { action: 'UPDATE', id: editingItem.id, item: payload, expected: menuSnapshot(editingItem) }
        : { action: 'CREATE', id: crypto.randomUUID(), item: payload, expected: null });
      if (confirmed || pendingMenuAction(currentStaffId)) setIsModalOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Thông tin thực đơn không hợp lệ.');
    }
  }

  async function handleDeleteMenuItem(item: MenuItemRow) {
    if (menuActions.blocked || isUploadingImage || imageLock.current) return;
    await menuActions.run({ action: 'DELETE', id: item.id, item: null, expected: menuSnapshot(item) });
  }

  return (
    <div className="space-y-6">
      <MenuActionFeedback {...menuActions} recover={() => menuActions.run()} />
      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
        <button type="button" disabled={isUploadingImage || menuActions.blocked} onClick={() => void handleCleanupImages()} className="min-h-12 rounded-lg border border-zinc-700 px-3 disabled:opacity-50">Dọn ảnh không dùng</button>
        <span>Chỉ dọn ảnh không được món nào sử dụng và đã tải lên hơn 24 giờ.</span>
        {imageNotice && <p role="status">{imageNotice}</p>}
      </div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">
            Quản lý Thực đơn & Báo hết món nhanh (86ing)
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Thiết lập giá bán (`price`), giá vốn (`cost_price`), thời gian nấu chuẩn (`prep_time_minutes`), phân trạm (`KITCHEN` / `BAR_INSTANT`) và nén ảnh WebP &lt; 80KB.
          </p>
        </div>

        <button
          type="button"
          disabled={menuActions.blocked || isUploadingImage}
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors"
        >
          <Plus className="h-4 w-4" />
          Thêm món mới
        </button>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-red-950/60 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
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

      {/* Thanh Tìm kiếm & Bộ lọc Danh mục / Trạm xử lý */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm món ăn, mồi nhậu, bia..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'FOOD', 'BEER', 'DRINK', 'OTHER'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                categoryFilter === cat
                  ? 'bg-amber-500 text-zinc-950 border-amber-500 font-semibold'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              )}
            >
              {cat === 'ALL' ? 'Tất cả danh mục' : CATEGORY_LABELS[cat].label}
            </button>
          ))}

          <select
            value={stationFilter}
            onChange={(e) =>
              setStationFilter(e.target.value as StationType | 'ALL')
            }
            className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
          >
            <option value="ALL">Tất cả trạm (KITCHEN & BAR_INSTANT)</option>
            <option value="KITCHEN">Trạm Bếp (KITCHEN)</option>
            <option value="BAR_INSTANT">Quầy lấy ngay (BAR_INSTANT)</option>
          </select>
        </div>
      </div>

      {/* Lưới hiển thị món ăn */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredItems.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500">
            Chưa có món ăn nào khớp với bộ lọc.
          </div>
        ) : (
          listPage.pageItems.map((item) => {
            const catCfg = CATEGORY_LABELS[item.category];
            const stCfg = STATION_LABELS[item.station];
            const linkedIng = item.linked_ingredient_id
              ? ingredientById.get(item.linked_ingredient_id)
              : undefined;
            const grossMargin = item.price - item.cost_price;

            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-xl border p-4 flex flex-col justify-between gap-4 transition-all',
                  item.is_available
                    ? 'bg-zinc-900 border-zinc-800'
                    : 'bg-zinc-900/50 border-red-500/40 opacity-80'
                )}
              >
                <div className="flex gap-3.5">
                  {/* Ảnh món ăn (WebP) */}
                  <div className="h-20 w-20 rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UtensilsCrossed className="h-7 w-7 text-zinc-700" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-base text-zinc-100 truncate">
                        {item.name}
                      </h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={menuActions.blocked || isUploadingImage}
                          onClick={() => openEditModal(item)}
                          className="min-h-12 min-w-12 p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                          title="Chỉnh sửa món"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={menuActions.blocked || isUploadingImage}
                          onClick={() => handleDeleteMenuItem(item)}
                          className="min-h-12 min-w-12 p-1.5 rounded-md bg-zinc-800 hover:bg-red-950 text-zinc-400 hover:text-red-400"
                          title="Xóa món"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[11px] font-medium border',
                          catCfg.badgeClass
                        )}
                      >
                        {catCfg.label}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border',
                          stCfg.badgeClass
                        )}
                      >
                        {item.station === 'KITCHEN' ? (
                          <ChefHat className="h-3 w-3" />
                        ) : (
                          <Beer className="h-3 w-3" />
                        )}
                        {item.station}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <div>
                        <span className="text-zinc-500 block">Giá bán</span>
                        <span className="font-bold text-amber-400">
                          {formatVND(item.price)}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Giá vốn</span>
                        <span className="font-medium text-zinc-300">
                          {formatVND(item.cost_price)}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Lãi gộp</span>
                        <span className="font-semibold text-emerald-400">
                          +{formatVND(grossMargin)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer thẻ món: Thời gian nấu chuẩn, liên kết kho & Nút gạt 86ing */}
                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-1 text-xs text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-zinc-500" />
                      Chuẩn nấu: <strong>{item.prep_time_minutes} phút</strong>
                    </span>
                    {linkedIng && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-sky-400">
                        <Link2 className="h-3 w-3" />
                        Trừ kho: {linkedIng.name} ({linkedIng.stock_quantity}{' '}
                        {linkedIng.unit})
                      </span>
                    )}
                  </div>

                  {/* Nút gạt Tạm hết hàng (86ing) */}
                  <button
                    type="button"
                    disabled={menuActions.blocked || isUploadingImage}
                    onClick={() => handleToggleAvailability(item)}
                    className={cn(
                      'min-h-12 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      item.is_available
                        ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                        : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/40'
                    )}
                  >
                    {item.is_available ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Đang bán (Bấm để 86)
                      </>
                    ) : (
                      <>
                        <Ban className="h-3.5 w-3.5" />
                        Tạm hết hàng (86ing)
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <LocalListNavigation {...listPage} label="Menu" />
      {/* Modal Thêm / Chỉnh sửa Món ăn */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                {editingItem ? 'Chỉnh sửa Món ăn' : 'Thêm Món ăn mới vào Thực đơn'}
              </h3>
              <button
                type="button"
                disabled={isUploadingImage || menuActions.busy}
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} className="space-y-4">
              {errorMessage && <p role="alert" className="text-sm text-red-300">{errorMessage}</p>}
              {menuActions.error && <p role="alert" className="text-sm text-red-300">{menuActions.error}</p>}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Tên món ăn / Đồ uống *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Ếch xào sả ớt, Bia Tiger Bạc, Khăn lạnh..."
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Danh mục (category) *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => {
                      const nextCat = e.target.value as MenuCategory;
                      setCategory(nextCat);
                      if (nextCat === 'BEER' || nextCat === 'DRINK') {
                        setStation('BAR_INSTANT');
                        setPrepTimeMinutes('0');
                      } else if (nextCat === 'FOOD') {
                        setStation('KITCHEN');
                        setLinkedIngredientId('');
                      }
                    }}
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  >
                    <option value="FOOD">Mồi nhậu (FOOD)</option>
                    <option value="BEER">Bia (BEER)</option>
                    <option value="DRINK">Nước ngọt / Đồ uống (DRINK)</option>
                    <option value="OTHER">Khác / Khăn lạnh (OTHER)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Trạm xử lý (station) *
                  </label>
                  <select
                    value={station}
                    onChange={(e) => {
                      const next = e.target.value as StationType;
                      setStation(next);
                      if (next === 'KITCHEN') setLinkedIngredientId('');
                    }}
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  >
                    <option value="KITCHEN">Bếp chế biến (KITCHEN)</option>
                    <option value="BAR_INSTANT">
                      Quầy lấy ngay (BAR_INSTANT)
                    </option>
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                {STATION_LABELS[station].description}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Giá bán (`price`) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Giá vốn (`cost_price`) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Thời gian nấu chuẩn (phút) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={prepTimeMinutes}
                    onChange={(e) => setPrepTimeMinutes(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                  />
                </div>
              </div>

              {/* Liên kết nguyên liệu kho tự động trừ khi bán bia/nước ngọt */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Liên kết nguyên liệu trừ kho tự động (`linked_ingredient_id`)
                </label>
                <select
                  value={linkedIngredientId}
                  disabled={category === 'FOOD' || station !== 'BAR_INSTANT'}
                  onChange={(e) => setLinkedIngredientId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                >
                  <option value="">-- Không liên kết trực tiếp --</option>
                  {ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name} (Tồn: {ing.stock_quantity} {ing.unit})
                    </option>
                  ))}
                </select>
              </div>

              {/* Upload ảnh tự động nén WebP < 80KB */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-300">
                  Ảnh món ăn (Tự động nén WebP &lt; 80KB trước khi đẩy lên Supabase Storage)
                </label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium cursor-pointer border border-zinc-700">
                    <Upload className="h-4 w-4 text-amber-400" />
                    <span>
                      {isUploadingImage
                        ? 'Đang nén WebP & tải lên...'
                        : 'Chọn file ảnh để nén WebP < 80KB'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageFileChange}
                      disabled={isUploadingImage || menuActions.blocked}
                      className="hidden"
                    />
                  </label>

                  <button type="button" disabled={isUploadingImage || menuActions.blocked || !imageUrl} onClick={() => setImageUrl('')} className="min-h-12 rounded-lg bg-zinc-800 px-3 text-sm text-zinc-200">Bỏ ảnh khỏi món</button>
                </div>
                {compressionInfo && (
                  <p className="text-xs text-emerald-400 font-medium">
                    ✓ {compressionInfo}
                  </p>
                )}
              </div>

              {/* Trạng thái mở bán (86ing) */}
              <label className="flex items-center gap-2.5 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-amber-500"
                />
                <span>Đang còn hàng phục vụ (`is_available`)</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  disabled={isUploadingImage || menuActions.busy}
                onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={menuActions.blocked || isUploadingImage}
                  className="min-h-12 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-semibold text-sm"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Lưu món ăn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
