import { describe, it, expect } from 'vitest';
import type {
  MenuItemRow,
  OrderItemInsert,
  OrderItemRow,
} from '@/types/database.types';

/**
 * 1. Snapshot Price & Phân luồng BAR_INSTANT vs KITCHEN (Mục 2.2 AGENTS.md)
 */
function buildOrderItemPayload(
  sessionId: string,
  menuItem: Pick<MenuItemRow, 'id' | 'price' | 'cost_price' | 'station'>,
  quantity: number,
  nowIso: string
): OrderItemInsert {
  const isBarInstant = menuItem.station === 'BAR_INSTANT';
  return {
    session_id: sessionId,
    menu_item_id: menuItem.id,
    quantity,
    station: menuItem.station,
    unit_price: menuItem.price,
    unit_cost_price: menuItem.cost_price,
    status: isBarInstant ? 'READY' : 'QUEUED',
    ready_at: isBarInstant ? nowIso : null,
  };
}

/**
 * 2. Công thức tính vị trí hàng đợi Bếp (Mục 5.3 PRO_SPEC.md):
 * Đếm số món station === 'KITCHEN' && status === 'QUEUED' có created_at < item.created_at
 */
function calculateKitchenQueuePosition(
  targetItem: Pick<OrderItemRow, 'id' | 'created_at' | 'station' | 'status'>,
  globalKitchenQueue: Array<
    Pick<OrderItemRow, 'id' | 'created_at' | 'station' | 'status'>
  >
): number {
  if (targetItem.station !== 'KITCHEN' || targetItem.status !== 'QUEUED') {
    return 0;
  }
  const targetTime = new Date(targetItem.created_at).getTime();
  const aheadCount = globalKitchenQueue.filter(
    (q) =>
      q.station === 'KITCHEN' &&
      q.status === 'QUEUED' &&
      q.id !== targetItem.id &&
      new Date(q.created_at).getTime() < targetTime
  ).length;

  return aheadCount + 1;
}

/**
 * 3. Gom món trùng (Batch Cooking - Mục 4.3 PRO_SPEC.md)
 */
function groupBatchCookingOrders(
  queuedOrders: Array<
    Pick<
      OrderItemRow,
      'id' | 'menu_item_id' | 'quantity' | 'station' | 'status' | 'created_at'
    >
  >
) {
  const map = new Map<
    string,
    { menuItemId: string; totalQuantity: number; itemIds: string[] }
  >();

  for (const order of queuedOrders) {
    if (order.station !== 'KITCHEN' || order.status !== 'QUEUED') continue;
    const existing = map.get(order.menu_item_id);
    if (existing) {
      existing.totalQuantity += order.quantity;
      existing.itemIds.push(order.id);
    } else {
      map.set(order.menu_item_id, {
        menuItemId: order.menu_item_id,
        totalQuantity: order.quantity,
        itemIds: [order.id],
      });
    }
  }

  return Array.from(map.values()).filter((g) => g.itemIds.length >= 2);
}

/**
 * 4. Nghiệp vụ Trả lại bia thừa (RETURN_BEER - Mục 6.3 PRO_SPEC.md)
 */
function processBeerReturn(
  orderItem: Pick<OrderItemRow, 'quantity' | 'unit_price'>,
  returnQty: number,
  currentStock: number
) {
  if (returnQty <= 0 || returnQty > orderItem.quantity) {
    throw new Error('Số lượng bia trả lại không hợp lệ');
  }
  const updatedQuantity = orderItem.quantity - returnQty;
  const updatedStock = currentStock + returnQty;
  const newLineTotal = updatedQuantity * orderItem.unit_price;

  return {
    updatedQuantity,
    returnedQuantityChange: returnQty,
    updatedStock,
    newLineTotal,
  };
}

describe('Unit Test: Nghiệp vụ Đặc thù Quán Nhậu (PRO_SPEC.md & AGENTS.md)', () => {
  it('Snapshot Price: Sao lưu chính xác giá bán và giá vốn tại thời điểm gọi món', () => {
    const now = '2026-10-21T12:00:00.000Z';
    const payload = buildOrderItemPayload(
      'session-123',
      {
        id: 'menu-bo-luc-lac',
        price: 165000,
        cost_price: 82000,
        station: 'KITCHEN',
      },
      2,
      now
    );

    expect(payload.unit_price).toBe(165000);
    expect(payload.unit_cost_price).toBe(82000);
    expect(payload.status).toBe('QUEUED');
    expect(payload.ready_at).toBeNull();
  });

  it('Phân luồng BAR_INSTANT: Bia/Nước ngọt nhảy thẳng sang READY và ghi nhận ready_at ngay lập tức', () => {
    const now = '2026-10-21T12:05:00.000Z';
    const payload = buildOrderItemPayload(
      'session-123',
      {
        id: 'menu-bia-heineken',
        price: 25000,
        cost_price: 17500,
        station: 'BAR_INSTANT',
      },
      10,
      now
    );

    expect(payload.status).toBe('READY');
    expect(payload.ready_at).toBe(now);
  });

  it('Tính chính xác vị trí hàng đợi Bếp (Kitchen Queue Position - Mục 5.3)', () => {
    const globalQueue = [
      {
        id: 'order-1',
        created_at: '2026-10-21T18:00:00.000Z',
        station: 'KITCHEN' as const,
        status: 'QUEUED' as const,
      },
      {
        id: 'order-2',
        created_at: '2026-10-21T18:02:00.000Z',
        station: 'KITCHEN' as const,
        status: 'QUEUED' as const,
      },
      {
        id: 'order-3',
        created_at: '2026-10-21T18:05:00.000Z',
        station: 'KITCHEN' as const,
        status: 'QUEUED' as const,
      },
    ];

    expect(calculateKitchenQueuePosition(globalQueue[0]!, globalQueue)).toBe(1);
    expect(calculateKitchenQueuePosition(globalQueue[1]!, globalQueue)).toBe(2);
    expect(calculateKitchenQueuePosition(globalQueue[2]!, globalQueue)).toBe(3);
  });

  it('Gom món trùng (Batch Cooking): Tự động gom các bàn gọi cùng 1 món đang QUEUED', () => {
    const orders = [
      {
        id: 'o1',
        menu_item_id: 'oc-huong-bo-toi',
        quantity: 2,
        station: 'KITCHEN' as const,
        status: 'QUEUED' as const,
        created_at: '2026-10-21T19:00:00Z',
      },
      {
        id: 'o2',
        menu_item_id: 'oc-huong-bo-toi',
        quantity: 3,
        station: 'KITCHEN' as const,
        status: 'QUEUED' as const,
        created_at: '2026-10-21T19:01:00Z',
      },
      {
        id: 'o3',
        menu_item_id: 'lau-thai',
        quantity: 1,
        station: 'KITCHEN' as const,
        status: 'QUEUED' as const,
        created_at: '2026-10-21T19:02:00Z',
      },
    ];

    const batches = groupBatchCookingOrders(orders);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.menuItemId).toBe('oc-huong-bo-toi');
    expect(batches[0]?.totalQuantity).toBe(5);
    expect(batches[0]?.itemIds).toEqual(['o1', 'o2']);
  });

  it('Trả lại bia thừa (RETURN_BEER): Giảm số lượng uống trên order_items và hoàn kho nguyên liệu', () => {
    const result = processBeerReturn(
      { quantity: 24, unit_price: 22000 },
      6,
      100
    );

    expect(result.updatedQuantity).toBe(18);
    expect(result.returnedQuantityChange).toBe(6);
    expect(result.updatedStock).toBe(106);
    expect(result.newLineTotal).toBe(18 * 22000);
  });

  it('Tính tiền Chia Bill Campuchia làm tròn hợp lý cho nhóm bạn nhậu', () => {
    const totalAmount = 1_250_000;
    const peopleCount = 6;
    const perPerson = Math.ceil(totalAmount / peopleCount);

    expect(perPerson).toBe(208334);
    expect(perPerson * peopleCount).toBeGreaterThanOrEqual(totalAmount);
  });
});
