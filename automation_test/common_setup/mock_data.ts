import type {
  IngredientRow,
  InventoryLogRow,
  MenuItemRow,
  OrderItemRow,
  StaffProfileRow,
  TableRow,
  TableSessionRow,
  ZoneRow,
} from '@/types/database.types';

export const MOCK_ZONES: ZoneRow[] = [
  {
    id: 'zone-vip-01',
    name: 'Khu Sân Thượng Thoáng Mát',
    created_at: '2026-10-01T08:00:00.000Z',
  },
  {
    id: 'zone-indoor-02',
    name: 'Khu Phòng Lạnh VIP',
    created_at: '2026-10-01T08:00:00.000Z',
  },
];

export const MOCK_STAFF: StaffProfileRow[] = [
  {
    id: 'staff-admin-01',
    full_name: 'Trần Quản Lý',
    role: 'admin',
    assigned_zone_id: 'zone-vip-01',
    is_active: true,
    push_subscription: null,
  },
  {
    id: 'staff-waiter-01',
    full_name: 'Nguyễn Văn Phục Vụ',
    role: 'staff',
    assigned_zone_id: 'zone-vip-01',
    is_active: true,
    push_subscription: null,
  },
];

export const MOCK_TABLES: TableRow[] = [
  {
    id: 'table-01',
    zone_id: 'zone-vip-01',
    table_number: 'Bàn 01',
    status: 'OCCUPIED',
    current_session_id: 'session-active-01',
  },
  {
    id: 'table-02',
    zone_id: 'zone-vip-01',
    table_number: 'Bàn 02',
    status: 'AVAILABLE',
    current_session_id: null,
  },
];

export const MOCK_INGREDIENTS: IngredientRow[] = [
  {
    id: 'ing-tiger-crystal',
    name: 'Bia Tiger Crystal (Lon)',
    unit: 'lon',
    stock_quantity: 120,
    min_threshold: 48,
    unit_cost: 15500,
  },
  {
    id: 'ing-oc-huong',
    name: 'Ốc Hương Tươi Sống',
    unit: 'kg',
    stock_quantity: 3, // Dưới ngưỡng min_threshold -> Cảnh báo đỏ!
    min_threshold: 10,
    unit_cost: 280000,
  },
];

export const MOCK_MENU_ITEMS: MenuItemRow[] = [
  {
    id: 'menu-oc-huong-bo-toi',
    name: 'Ốc Hương Xào Bơ Tỏi',
    category: 'FOOD',
    price: 139000,
    cost_price: 75000,
    image_url: null,
    station: 'KITCHEN',
    prep_time_minutes: 12,
    is_available: true,
    linked_ingredient_id: 'ing-oc-huong',
  },
  {
    id: 'menu-bo-luc-lac',
    name: 'Bò Lúc Lắc Khoai Tây',
    category: 'FOOD',
    price: 159000,
    cost_price: 85000,
    image_url: null,
    station: 'KITCHEN',
    prep_time_minutes: 15,
    is_available: true,
    linked_ingredient_id: null,
  },
  {
    id: 'menu-bia-tiger',
    name: 'Bia Tiger Crystal Ướp Lạnh',
    category: 'BEER',
    price: 24000,
    cost_price: 15500,
    image_url: null,
    station: 'BAR_INSTANT',
    prep_time_minutes: 1,
    is_available: true,
    linked_ingredient_id: 'ing-tiger-crystal',
  },
];

export const MOCK_ACTIVE_SESSION: TableSessionRow = {
  id: 'session-active-01',
  session_token: 'demo-table-session-token',
  session_type: 'DINE_IN',
  table_id: 'table-01',
  assigned_staff_id: 'staff-waiter-01',
  customer_name: 'Anh Trung Bàn 1',
  customer_phone: '0901234567',
  status: 'ACTIVE',
  payment_method: 'VIETQR',
  payment_code: 'DZO2026ACTIVE',
  total_amount: 518000,
  opened_at: '2026-10-21T11:00:00.000Z',
  closed_at: null,
};

export const MOCK_ORDER_ITEMS: OrderItemRow[] = [
  {
    id: 'order-item-queued-01',
    session_id: 'session-active-01',
    menu_item_id: 'menu-oc-huong-bo-toi',
    quantity: 2,
    unit_price: 139000,
    unit_cost_price: 75000,
    note: 'Cay nhiều, thêm bánh mì',
    station: 'KITCHEN',
    status: 'QUEUED',
    batch_id: null,
    created_at: '2026-10-21T11:05:00.000Z',
    cooking_started_at: null,
    ready_at: null,
    served_at: null,
    served_by_staff_id: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
  },
  {
    id: 'order-item-beer-02',
    session_id: 'session-active-01',
    menu_item_id: 'menu-bia-tiger',
    quantity: 10,
    unit_price: 24000,
    unit_cost_price: 15500,
    note: 'Lấy xô đá lớn',
    station: 'BAR_INSTANT',
    status: 'READY',
    batch_id: null,
    created_at: '2026-10-21T11:06:00.000Z',
    cooking_started_at: null,
    ready_at: '2026-10-21T11:06:00.000Z',
    served_at: null,
    served_by_staff_id: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
  },
];

export const MOCK_INVENTORY_LOGS: InventoryLogRow[] = [
  {
    id: 'log-01',
    ingredient_id: 'ing-tiger-crystal',
    created_by: 'staff-admin-01',
    type: 'IMPORT',
    quantity_change: 240,
    total_cost: 240 * 15500,
    note: 'Nhập 10 thùng Tiger đầu tuần',
    created_at: '2026-10-20T09:00:00.000Z',
  },
];
