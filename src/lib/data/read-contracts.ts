import type { MenuItemRow, StaffProfileRow, TableSessionRow } from '@/types/database.types';
import { isRecord, parseDisplayOrderItem, UUID, type DisplayOrderItem } from '@/lib/orders/contracts';

export type PublicMenuItem = Omit<MenuItemRow, 'cost_price' | 'linked_ingredient_id'>;
export type StaffDirectoryEntry = Omit<StaffProfileRow, 'push_subscription'>;
export type AdminStaffDirectoryEntry = StaffDirectoryEntry & { has_push_subscription?: boolean };
export type StaffSession = Omit<TableSessionRow, 'customer_phone' | 'payment_code'>;
export type KitchenSession = Pick<TableSessionRow, 'id' | 'session_type' | 'table_id' | 'customer_name' | 'status' | 'activated_at'>;
export type GuestSession = Pick<TableSessionRow, 'id' | 'session_token' | 'status' | 'payment_method'>;
export interface DineInSnapshot {
  session: GuestSession;
  table: { table_number: string } | null;
  zone: { name: string } | null;
  menu: PublicMenuItem[];
  items: DisplayOrderItem[];
  queuePositions: Record<string, number>;
}
const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';
const positiveNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Explicit projection: never forward an unchecked RPC JSON object to a client. */
export function parseDineInSnapshot(value: unknown, token: string): DineInSnapshot | null {
  if (!isRecord(value) || !isRecord(value.session) || !Array.isArray(value.menu) || !Array.isArray(value.items) || !isRecord(value.queuePositions)) return null;
  const s = value.session;
  if (typeof s.id !== 'string' || !UUID.test(s.id) || (s.status !== 'ACTIVE' && s.status !== 'REQUEST_BILL') ||
    (s.payment_method !== null && s.payment_method !== 'CASH' && s.payment_method !== 'VIETQR')) return null;
  if (value.table !== null && (!isRecord(value.table) || typeof value.table.table_number !== 'string')) return null;
  if (value.zone !== null && (!isRecord(value.zone) || typeof value.zone.name !== 'string')) return null;
  const menu: PublicMenuItem[] = [], items: DisplayOrderItem[] = [], queuePositions: Record<string, number> = {};
  for (const row of value.menu) {
    if (!isRecord(row) || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.name !== 'string' ||
      (row.category !== 'FOOD' && row.category !== 'BEER' && row.category !== 'DRINK' && row.category !== 'OTHER') ||
      (row.station !== 'KITCHEN' && row.station !== 'BAR_INSTANT') || !positiveNumber(row.price) ||
      !positiveNumber(row.prep_time_minutes) || !Number.isInteger(row.prep_time_minutes) || !nullableString(row.image_url) || typeof row.is_available !== 'boolean') return null;
    menu.push({ id: row.id, name: row.name, category: row.category, station: row.station, price: row.price,
      prep_time_minutes: row.prep_time_minutes, image_url: row.image_url, is_available: row.is_available });
  }
  const ids = new Set<string>();
  for (const row of value.items) {
    const item = parseDisplayOrderItem(row, s.id, true);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id); items.push(item);
    if (item.station === 'KITCHEN' && item.status === 'QUEUED' && item.quantity > 0) {
      const position = value.queuePositions[item.id];
      if (!positiveNumber(position) || !Number.isSafeInteger(position) || position < 1) return null;
      queuePositions[item.id] = position;
    }
  }
  return { session: { id: s.id, session_token: token, status: s.status, payment_method: s.payment_method },
    table: isRecord(value.table) ? { table_number: String(value.table.table_number) } : null,
    zone: isRecord(value.zone) ? { name: String(value.zone.name) } : null, menu, items, queuePositions };
}
