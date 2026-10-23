import type { MenuItemRow } from '@/types/database.types';
import { menuSnapshot, type MenuRequest, type MenuResult } from '@/lib/menu/contracts';
export const operationId = '40000000-0000-4000-8000-000000000001';
export const menu: MenuItemRow = { id: '20000000-0000-4000-8000-000000000001', name: 'Món kiểm thử', category: 'FOOD', station: 'KITCHEN', price: 100, cost_price: 40,
  prep_time_minutes: 10, image_url: null, is_available: true, linked_ingredient_id: null };
export const item = menuSnapshot(menu);
export const journal: MenuRequest = { operationId, action: 'AVAILABILITY', id: menu.id, item: { is_available: false }, expected: { is_available: true } };
export const result: MenuResult = { operationId, action: 'AVAILABILITY', menuItemId: menu.id };
