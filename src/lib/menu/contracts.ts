import { UUID, isRecord } from '@/lib/orders/contracts';
import type { MenuItemRow } from '@/types/database.types';

export type MenuFields = Omit<MenuItemRow, 'id'>;
export type MenuCommand =
  | { action: 'CREATE'; id: string; item: MenuFields; expected: null }
  | { action: 'UPDATE'; id: string; item: MenuFields; expected: MenuFields }
  | { action: 'DELETE'; id: string; item: null; expected: MenuFields }
  | { action: 'AVAILABILITY'; id: string; item: { is_available: boolean }; expected: { is_available: boolean } };
export type MenuRequest = MenuCommand & { operationId: string };
export interface MenuResult { operationId: string; action: MenuCommand['action']; menuItemId: string }
const fields = 'category,cost_price,image_url,is_available,linked_ingredient_id,name,prep_time_minutes,price,station';
const exact = (value: Record<string, unknown>, keys: string) => Object.keys(value).sort().join(',') === keys;
function money(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 &&
    value === Number(value.toFixed(2));
}
export function menuFields(value: unknown): MenuFields | null {
  if (!isRecord(value) || !exact(value, fields) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 ||
    (value.category !== 'FOOD' && value.category !== 'BEER' && value.category !== 'DRINK' && value.category !== 'OTHER') ||
    (value.station !== 'KITCHEN' && value.station !== 'BAR_INSTANT') || !money(value.price) || !money(value.cost_price) ||
    typeof value.prep_time_minutes !== 'number' || !Number.isInteger(value.prep_time_minutes) || value.prep_time_minutes < 0 || value.prep_time_minutes > 1440 ||
    typeof value.is_available !== 'boolean' ||
    (value.image_url !== null && (typeof value.image_url !== 'string' || value.image_url.length > 2048 || !/^https:\/\/[^\s]+$/i.test(value.image_url))) ||
    (value.linked_ingredient_id !== null && (typeof value.linked_ingredient_id !== 'string' || !UUID.test(value.linked_ingredient_id))) ||
    (value.linked_ingredient_id !== null && (value.category === 'FOOD' || value.station !== 'BAR_INSTANT'))) return null;
  return { name: value.name, category: value.category, station: value.station, price: value.price, cost_price: value.cost_price,
    prep_time_minutes: value.prep_time_minutes, image_url: value.image_url, is_available: value.is_available,
    linked_ingredient_id: value.linked_ingredient_id?.toLowerCase() ?? null };
}
export function menuSnapshot(row: MenuItemRow): MenuFields {
  const { id: _id, ...snapshot } = row; return snapshot;
}
function availability(value: unknown): { is_available: boolean } | null {
  return isRecord(value) && exact(value, 'is_available') && typeof value.is_available === 'boolean' ? { is_available: value.is_available } : null;
}
export function parseMenuRequest(value: unknown): MenuRequest | null {
  if (!isRecord(value) || !exact(value, 'action,expected,id,item,operationId') || typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    typeof value.id !== 'string' || !UUID.test(value.id)) return null;
  const base = { operationId: value.operationId.toLowerCase(), id: value.id.toLowerCase() };
  if (value.action === 'AVAILABILITY') {
    const item = availability(value.item), expected = availability(value.expected);
    return item && expected ? { ...base, action: value.action, item, expected } : null;
  }
  const item = menuFields(value.item), expected = menuFields(value.expected);
  if (value.action === 'CREATE' && item && value.expected === null) return { ...base, action: value.action, item, expected: null };
  if (value.action === 'UPDATE' && item && expected) return { ...base, action: value.action, item, expected };
  if (value.action === 'DELETE' && value.item === null && expected) return { ...base, action: value.action, item: null, expected };
  return null;
}
export function parseMenuResult(value: unknown): MenuResult | null {
  if (!isRecord(value) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) || typeof value.menuItemId !== 'string' || !UUID.test(value.menuItemId) ||
    !['CREATE', 'UPDATE', 'DELETE', 'AVAILABILITY'].includes(String(value.action))) return null;
  // Narrow the action without accepting arbitrary strings from the database.
  const action = value.action;
  if (action !== 'CREATE' && action !== 'UPDATE' && action !== 'DELETE' && action !== 'AVAILABILITY') return null;
  return { operationId: value.operationId, menuItemId: value.menuItemId, action };
}
export function matchesMenuResult(result: MenuResult, request: MenuRequest) {
  return result.operationId === request.operationId && result.menuItemId === request.id && result.action === request.action;
}
