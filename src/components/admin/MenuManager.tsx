'use client';

import { useState, useMemo } from 'react';
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
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { compressMenuImageToWebP, formatVND, cn } from '@/lib/utils';
import type {
  IngredientRow,
  MenuCategory,
  MenuItemRow,
  StationType,
} from '@/types/database.types';

interface MenuManagerProps {
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

const MENU_STORAGE_BUCKET = 'menu-images';

export function MenuManager({
  initialMenuItems,
  ingredients,
}: MenuManagerProps) {
  const supabase = createSupabaseBrowserClient();

  const [menuItems, setMenuItems] = useState<MenuItemRow[]>(initialMenuItems);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<MenuCategory | 'ALL'>(
    'ALL'
  );
  const [stationFilter, setStationFilter] = useState<StationType | 'ALL'>(
    'ALL'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // State Modal Thêm / Sửa Món ăn (menu_items)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<MenuItemRow | null>(null);
  const [name, setName] = useState<string>('');
  const [category, setCategory] = useState<MenuCategory>('FOOD');
  const [station, setStation] = useState<StationType>('KITCHEN');
  const [price, setPrice] = useState<string>('69000');
  const [costPrice, setCostPrice] = useState<string>('30000');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<string>('10');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [linkedIngredientId, setLinkedIngredientId] = useState<string>('');

  // State nén ảnh WebP < 80KB & Upload lên Supabase Storage
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
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

  function openCreateModal() {
    setEditingItem(null);
    setName('');
    setCategory('FOOD');
    setStation('KITCHEN');
    setPrice('79000');
    setCostPrice('35000');
    setPrepTimeMinutes('12');
    setImageUrl('');
    setIsAvailable(true);
    setLinkedIngredientId('');
    setCompressionInfo(null);
    setErrorMessage(null);
    setIsModalOpen(true);
  }

  function openEditModal(item: MenuItemRow) {
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
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;

    setIsUploadingImage(true);
    setErrorMessage(null);
    setCompressionInfo(null);

    try {
      const originalKb = (rawFile.size / 1024).toFixed(1);
      const compressedWebpFile = await compressMenuImageToWebP(rawFile);
      const compressedKb = (compressedWebpFile.size / 1024).toFixed(1);

      if (compressedWebpFile.size > 80 * 1024) {
        throw new Error(
          `Ảnh sau khi nén (${compressedKb}KB) vẫn vượt ngưỡng 80KB. Vui lòng chọn ảnh khác.`
        );
      }

      const uniqueFileName = `menu_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.webp`;

      const { error: uploadError } = await supabase.storage
        .from(MENU_STORAGE_BUCKET)
        .upload(uniqueFileName, compressedWebpFile, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Lỗi tải ảnh lên Supabase Storage (${MENU_STORAGE_BUCKET}): ${uploadError.message}`
        );
      }

      const { data: publicUrlData } = supabase.storage
        .from(MENU_STORAGE_BUCKET)
        .getPublicUrl(uniqueFileName);

      setImageUrl(publicUrlData.publicUrl);
      setCompressionInfo(
        `Đã nén chuẩn WebP: ${originalKb}KB → ${compressedKb}KB (< 80KB)`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Không thể nén và tải ảnh lên'
      );
    } finally {
      setIsUploadingImage(false);
    }
  }

  /**
   * Nút gạt "Tạm hết hàng (86ing)" cập nhật tức thì cột is_available trên bảng menu_items
   */
  async function handleToggleAvailability(item: MenuItemRow) {
    if (togglingId === item.id) return;
    setTogglingId(item.id);
    setErrorMessage(null);

    const nextAvailable = !item.is_available;

    try {
      const { data, error } = await supabase
        .from('menu_items')
        .update({ is_available: nextAvailable })
        .eq('id', item.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(
          error?.message ?? 'Không thể cập nhật trạng thái Tạm hết hàng (86ing)'
        );
      }

      setMenuItems((prev) =>
        prev.map((m) => (m.id === data.id ? data : m))
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi bật/tắt trạng thái món'
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSaveMenuItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting || isUploadingImage) return;

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

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: trimmedName,
        category,
        station,
        price: parsedPrice,
        cost_price: parsedCostPrice,
        prep_time_minutes: Math.round(parsedPrepTime),
        image_url: imageUrl.trim() || null,
        is_available: isAvailable,
        linked_ingredient_id: linkedIngredientId || null,
      };

      if (editingItem) {
        const { data, error } = await supabase
          .from('menu_items')
          .update(payload)
          .eq('id', editingItem.id)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể cập nhật món ăn');
        }

        setMenuItems((prev) =>
          prev.map((item) => (item.id === data.id ? data : item))
        );
      } else {
        const { data, error } = await supabase
          .from('menu_items')
          .insert(payload)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể tạo món ăn mới');
        }

        setMenuItems((prev) => [data, ...prev]);
      }

      setIsModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi lưu món ăn'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteMenuItem(itemId: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', itemId);

      if (error) {
        throw new Error(
          `Không thể xóa món ăn (có thể đã phát sinh đơn hàng): ${error.message}`
        );
      }

      setMenuItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi xóa món');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
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
          filteredItems.map((item) => {
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
                          onClick={() => openEditModal(item)}
                          className="p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                          title="Chỉnh sửa món"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMenuItem(item.id)}
                          className="p-1.5 rounded-md bg-zinc-800 hover:bg-red-950 text-zinc-400 hover:text-red-400"
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
                    disabled={togglingId === item.id}
                    onClick={() => handleToggleAvailability(item)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
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
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} className="space-y-4">
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
                    onChange={(e) => setStation(e.target.value as StationType)}
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
                      accept="image/*"
                      onChange={handleImageFileChange}
                      disabled={isUploadingImage}
                      className="hidden"
                    />
                  </label>

                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="Hoặc dán trực tiếp URL ảnh WebP..."
                    className="flex-1 w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                  />
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
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isUploadingImage}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-semibold text-sm"
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
