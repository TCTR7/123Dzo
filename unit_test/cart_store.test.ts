import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCartStore } from '@/lib/store/useCartStore';

describe('Unit Test: useCartStore (Giỏ hàng Khách tại bàn & Rate Limit - 100% Coverage)', () => {
  beforeEach(() => {
    useCartStore.setState({
      sessionToken: null,
      items: [],
      submissionTimestamps: [],
    });
  });

  it('thêm món mới và tự động cộng dồn số lượng nếu trùng menu_item_id + note', () => {
    const store = useCartStore.getState();

    store.addItem({
      menu_item_id: 'beer-tiger-01',
      name: 'Bia Tiger Bạc',
      category: 'BEER',
      station: 'BAR_INSTANT',
      unit_price: 22000,
      unit_cost_price: 15000,
      image_url: null,
      quantity: 5,
      note: 'Ướp lạnh',
    });

    store.addItem({
      menu_item_id: 'beer-tiger-01',
      name: 'Bia Tiger Bạc',
      category: 'BEER',
      station: 'BAR_INSTANT',
      unit_price: 22000,
      unit_cost_price: 15000,
      image_url: null,
      quantity: 3,
      note: 'Ướp lạnh',
    });

    const currentItems = useCartStore.getState().items;
    expect(currentItems).toHaveLength(1);
    expect(currentItems[0]?.quantity).toBe(8);
    expect(useCartStore.getState().getTotalQuantity()).toBe(8);
    expect(useCartStore.getState().getTotalAmount()).toBe(8 * 22000);
  });

  it('tách thành 2 dòng riêng biệt nếu cùng món nhưng khác ghi chú (note)', () => {
    const store = useCartStore.getState();

    store.addItem({
      menu_item_id: 'oc-huong-01',
      name: 'Ốc Hương Xào Bơ Tỏi',
      category: 'FOOD',
      station: 'KITCHEN',
      unit_price: 120000,
      unit_cost_price: 65000,
      image_url: null,
      quantity: 1,
      note: 'Cay nhiều',
    });

    store.addItem({
      menu_item_id: 'oc-huong-01',
      name: 'Ốc Hương Xào Bơ Tỏi',
      category: 'FOOD',
      station: 'KITCHEN',
      unit_price: 120000,
      unit_cost_price: 65000,
      image_url: null,
      quantity: 1,
      note: 'Không cay',
    });

    expect(useCartStore.getState().items).toHaveLength(2);
  });

  it('cập nhật số lượng (updateQuantity), cập nhật ghi chú (updateNote) và xóa món khi quantity <= 0', () => {
    const store = useCartStore.getState();

    store.addItem({
      menu_item_id: 'bo-luc-lac-01',
      name: 'Bò Lúc Lắc',
      category: 'FOOD',
      station: 'KITCHEN',
      unit_price: 150000,
      unit_cost_price: 80000,
      image_url: null,
      quantity: 1,
      note: 'Chín vừa',
    });

    useCartStore.getState().updateQuantity('bo-luc-lac-01', 3, 'Chín vừa');
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);

    useCartStore.getState().updateNote('bo-luc-lac-01', 'Thêm tiêu xanh');
    expect(useCartStore.getState().items[0]?.note).toBe('Thêm tiêu xanh');

    // Giảm số lượng về 0 sẽ tự động xóa khỏi giỏ hàng
    useCartStore.getState().updateQuantity('bo-luc-lac-01', 0, 'Thêm tiêu xanh');
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('xóa từng món (removeItem) và làm trống giỏ hàng (clearCart)', () => {
    const store = useCartStore.getState();

    store.addItem({
      menu_item_id: 'khan-lanh-01',
      name: 'Khăn lạnh',
      category: 'OTHER',
      station: 'BAR_INSTANT',
      unit_price: 3000,
      unit_cost_price: 1000,
      image_url: null,
      quantity: 4,
    });

    useCartStore.getState().removeItem('khan-lanh-01');
    expect(useCartStore.getState().items).toHaveLength(0);

    store.addItem({
      menu_item_id: 'nuoc-suoi-01',
      name: 'Nước suối',
      category: 'DRINK',
      station: 'BAR_INSTANT',
      unit_price: 10000,
      unit_cost_price: 4000,
      image_url: null,
      quantity: 2,
    });

    useCartStore.getState().clearCart();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('xóa sạch giỏ hàng cũ khi khách quét sang mã QR của bàn khác (session_token mới)', () => {
    const store = useCartStore.getState();
    store.setSessionToken('table-01-token');
    store.addItem({
      menu_item_id: 'lau-thai-01',
      name: 'Lẩu Thái Hải Sản',
      category: 'FOOD',
      station: 'KITCHEN',
      unit_price: 250000,
      unit_cost_price: 130000,
      image_url: null,
      quantity: 1,
    });

    expect(useCartStore.getState().items).toHaveLength(1);

    // Chuyển sang bàn khác
    useCartStore.getState().setSessionToken('table-02-token');
    expect(useCartStore.getState().sessionToken).toBe('table-02-token');
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('chặn gửi đơn liên tục vượt quá giới hạn Rate Limit (tối đa 2 lần / 10 giây)', () => {
    vi.useFakeTimers();
    const store = useCartStore.getState();

    expect(store.canSubmitOrder()).toBe(true);
    store.recordOrderSubmission();

    expect(useCartStore.getState().canSubmitOrder()).toBe(true);
    useCartStore.getState().recordOrderSubmission();

    // Lần thứ 3 trong vòng 10 giây phải bị chặn
    expect(useCartStore.getState().canSubmitOrder()).toBe(false);

    // Sau 11 giây được phép đặt tiếp
    vi.advanceTimersByTime(11_000);
    expect(useCartStore.getState().canSubmitOrder()).toBe(true);

    vi.useRealTimers();
  });
});
