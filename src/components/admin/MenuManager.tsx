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
    label: 'Mồi nhậu',
    badgeClass: 'bg-orange-500/15 text-orange-800 border-orange-500/30',
  },
  BEER: {
    label: 'Bia',
    badgeClass: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  },
  DRINK: {
    label: 'Nước ngọt / Đồ uống',
    badgeClass: 'bg-sky-500/15 text-sky-800 border-sky-500/30',
  },
  OTHER: {
    label: 'Khác / Khăn lạnh',
    badgeClass: 'bg-zinc-500/15 text-ink border-zinc-500/30',
  },
};

const STATION_LABELS: Record<
  StationType,
  { label: string; description: string; badgeClass: string }
> = {
  KITCHEN: {
    label: 'Cần bếp làm',
    description: 'Món hiện trong hàng đợi bếp. Làm xong, bếp báo nhân viên mang ra.',
    badgeClass: 'bg-orange-500/15 text-orange-800 border-orange-500/30',
  },
  BAR_INSTANT: {
    label: 'Lấy mang ra ngay',
    description:
      'Bia, nước, khăn lạnh: báo nhân viên lấy mang ra ngay, không phải chờ bếp.',
    badgeClass: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30',
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
          `Chưa tải được ảnh. Vui lòng thử lại.`
        );
      }

      const { data: publicUrlData } = supabase.storage
        .from(MENU_STORAGE_BUCKET)
        .getPublicUrl(uniqueFileName);

      setImageUrl(publicUrlData.publicUrl);
      setCompressionInfo(
        `Đã tải ảnh món ăn.`
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
   * Nút gạt "Tạm hết hàng" cập nhật tức thì cột is_available trên bảng menu_items
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
          error?.message ?? 'Không thể cập nhật trạng thái Tạm hết hàng'
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

    if (!trimmedName) {
      setErrorMessage('Tên món ăn không được để trống.');
      return;
    }

    if (
      Number.isNaN(parsedPrice) ||
      parsedPrice < 0 ||
      Number.isNaN(parsedCostPrice) ||
      parsedCostPrice < 0
    ) {
      setErrorMessage('Giá bán và tiền vốn phải là số từ 0 trở lên.');
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
        prep_time_minutes: editingItem?.prep_time_minutes ?? 0,
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
          <h2 className="text-2xl font-bold text-ink">
            Thực đơn
          </h2>
          <p className="text-sm text-muted-ink mt-1">
            Thêm món ngon, cập nhật giá và báo hết món để khách biết ngay.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-ink font-semibold text-sm transition-colors"
        >
          <Plus className="h-4 w-4" />
          Thêm món mới
        </button>
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

      {/* Thanh Tìm kiếm & Bộ lọc Danh mục / Trạm xử lý */}
      <div className="bg-surface border border-line rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-muted-ink absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm món ăn, mồi nhậu, bia..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
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
                  ? 'bg-amber-500 text-ink border-amber-500 font-semibold'
                  : 'bg-soft text-muted-ink border-line hover:text-ink'
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
            className="px-3 py-1.5 rounded-lg bg-soft border border-line text-xs text-ink"
          >
            <option value="ALL">Tất cả cách phục vụ</option>
            <option value="KITCHEN">Cần bếp làm</option>
            <option value="BAR_INSTANT">Lấy mang ra ngay</option>
          </select>
        </div>
      </div>

      {/* Lưới hiển thị món ăn */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredItems.length === 0 ? (
          <div className="col-span-full py-12 text-center bg-surface border border-line rounded-xl text-muted-ink">
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
                    ? 'bg-surface border-line'
                    : 'bg-surface/50 border-red-500/40 opacity-80'
                )}
              >
                <div className="flex gap-3.5">
                  {/* Ảnh món ăn (WebP) */}
                  <div className="h-20 w-20 rounded-xl bg-soft border border-line overflow-hidden shrink-0 flex items-center justify-center">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UtensilsCrossed className="h-7 w-7 text-ink" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-base text-ink truncate">
                        {item.name}
                      </h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="p-1.5 rounded-md bg-muted hover:bg-stone-200 text-ink"
                          title="Chỉnh sửa món"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMenuItem(item.id)}
                          className="p-1.5 rounded-md bg-muted hover:bg-red-50 text-muted-ink hover:text-red-800"
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
                        {stCfg.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <div>
                        <span className="text-muted-ink block">Giá bán</span>
                        <span className="font-bold text-amber-800">
                          {formatVND(item.price)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-ink block">Giá vốn</span>
                        <span className="font-medium text-ink">
                          {formatVND(item.cost_price)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-ink block">Lãi gộp</span>
                        <span className="font-semibold text-emerald-800">
                          +{formatVND(grossMargin)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer thẻ món: Thời gian nấu chuẩn, liên kết kho & Nút gạt 86ing */}
                <div className="pt-3 border-t border-line/80 flex items-center justify-between gap-2">
                  <div className="flex flex-col gap-1 text-xs text-muted-ink">
                    {linkedIng && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-sky-800">
                        <Link2 className="h-3 w-3" />
                        Trừ kho: {linkedIng.name} ({linkedIng.stock_quantity}{' '}
                        {linkedIng.unit})
                      </span>
                    )}
                  </div>

                  {/* Nút gạt Tạm hết hàng */}
                  <button
                    type="button"
                    disabled={togglingId === item.id}
                    onClick={() => handleToggleAvailability(item)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      item.is_available
                        ? 'bg-emerald-500/15 hover:bg-emerald-800/25 text-emerald-800 border-emerald-500/30'
                        : 'bg-red-500/20 hover:bg-red-500/30 text-red-800 border-red-500/40'
                    )}
                  >
                    {item.is_available ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Đang bán · Bấm báo hết
                      </>
                    ) : (
                      <>
                        <Ban className="h-3.5 w-3.5" />
                        Tạm hết hàng
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
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface border border-line rounded-2xl max-w-xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-lg font-bold text-ink">
                {editingItem ? 'Chỉnh sửa Món ăn' : 'Thêm Món ăn mới vào Thực đơn'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-ink hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Tên món ăn / Đồ uống *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Ếch xào sả ớt, Bia Tiger Bạc, Khăn lạnh..."
                  className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Nhóm món *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => {
                      const nextCat = e.target.value as MenuCategory;
                      setCategory(nextCat);
                      if (nextCat === 'BEER' || nextCat === 'DRINK') {
                        setStation('BAR_INSTANT');

                      } else if (nextCat === 'OTHER') { setStation('BAR_INSTANT'); } else if (nextCat === 'FOOD') {
                        setStation('KITCHEN');
                      }
                    }}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  >
                    <option value="FOOD">Mồi nhậu</option>
                    <option value="BEER">Bia</option>
                    <option value="DRINK">Nước ngọt / Đồ uống</option>
                    <option value="OTHER">Khác / Khăn lạnh</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Cách phục vụ *
                  </label>
                  <select
                    value={station}
                    onChange={(e) => setStation(e.target.value as StationType)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  >
                    <option value="KITCHEN">Cần bếp làm</option>
                    <option value="BAR_INSTANT">
                      Lấy mang ra ngay
                    </option>
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-muted-ink bg-soft p-2.5 rounded-lg border border-line">
                {STATION_LABELS[station].description}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Giá bán *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Tiền vốn mỗi phần *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
                  />
                </div>
              </div>

              {/* Liên kết nguyên liệu kho tự động trừ khi bán bia/nước ngọt */}
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Hàng trong kho cần trừ khi bán
                </label>
                <select
                  value={linkedIngredientId}
                  onChange={(e) => setLinkedIngredientId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-soft border border-line text-sm text-ink"
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
                <label className="block text-xs font-medium text-ink">
                  Ảnh món ăn
                </label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-muted hover:bg-stone-200 text-ink text-xs font-medium cursor-pointer border border-line">
                    <Upload className="h-4 w-4 text-amber-800" />
                    <span>
                      {isUploadingImage
                        ? 'Đang tải ảnh…'
                        : 'Chọn ảnh món ăn'}
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
                    placeholder="Hoặc dán đường dẫn ảnh…"
                    className="flex-1 w-full px-3 py-2 rounded-lg bg-soft border border-line text-xs text-ink"
                  />
                </div>
                {compressionInfo && (
                  <p className="text-xs text-emerald-800 font-medium">
                    ✓ {compressionInfo}
                  </p>
                )}
              </div>

              {/* Trạng thái mở bán */}
              <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="rounded border-line bg-soft text-amber-500"
                />
                <span>Đang bán món này</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-ink text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isUploadingImage}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-ink font-semibold text-sm"
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
