import type { OrderItemRow } from '@/types/database.types';

export type DisplayOrderItem = Omit<OrderItemRow, 'unit_cost_price' | 'served_by_staff_id' | 'cancelled_by' | 'stock_export_log_id'>;
export interface OrderLine { menu_item_id: string; quantity: number; note: string; expected_price: number }
export interface OrderRequest { sessionId: string; operationId: string; lines: OrderLine[] }
export interface OrderResult { sessionId: string; operationId: string; totalAmount: number; items: DisplayOrderItem[] }
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseOrderRequest(value: unknown): OrderRequest | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'lines,operationId,sessionId' ||
    typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) ||
    typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 30) return null;
  const lines: OrderLine[] = [];
  for (const line of value.lines) {
    if (!isRecord(line) || Object.keys(line).sort().join(',') !== 'expected_price,menu_item_id,note,quantity' ||
      typeof line.menu_item_id !== 'string' || !UUID.test(line.menu_item_id) ||
      typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 ||
      typeof line.note !== 'string' || line.note.length > 500 ||
      typeof line.expected_price !== 'number' || !Number.isFinite(line.expected_price) || line.expected_price < 0 || line.expected_price > 1e9) return null;
    lines.push({ menu_item_id: line.menu_item_id.toLowerCase(), quantity: line.quantity, note: line.note.trim(), expected_price: line.expected_price });
  }
  return { sessionId: value.sessionId.toLowerCase(), operationId: value.operationId.toLowerCase(), lines };
}

export function parseOrderResult(value: unknown): OrderResult | null {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) ||
    typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    typeof value.totalAmount !== 'number' || !Number.isFinite(value.totalAmount) || value.totalAmount < 0 ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 30) return null;
  const items: DisplayOrderItem[] = [];
  for (const item of value.items) {
    const parsed = parseDisplayOrderItem(item, value.sessionId);
    if (!parsed) return null;
    items.push(parsed);
  }
  return { sessionId:value.sessionId, operationId:value.operationId, totalAmount:value.totalAmount, items };
}

export function parseDisplayOrderItem(item: unknown, sessionId: string, allowZero = false): DisplayOrderItem | null {
  const nullableText = (x: unknown): x is string | null => x === null || typeof x === 'string';
    if (!isRecord(item) || typeof item.id !== 'string' || !UUID.test(item.id) || item.session_id !== sessionId ||
      typeof item.menu_item_id !== 'string' || !UUID.test(item.menu_item_id) || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < (allowZero ? 0 : 1) ||
      !nullableText(item.note) || (item.station !== 'KITCHEN' && item.station !== 'BAR_INSTANT') ||
      !['QUEUED','COOKING','READY','SERVED','CANCELLED'].includes(String(item.status)) ||
      typeof item.unit_price !== 'number' || !Number.isFinite(item.unit_price) || item.unit_price < 0 ||
      typeof item.created_at !== 'string' || !nullableText(item.batch_id) || !nullableText(item.cooking_started_at) ||
      !nullableText(item.ready_at) || !nullableText(item.served_at) || !nullableText(item.cancelled_at) || !nullableText(item.cancel_reason)) return null;
    const status = item.status;
    if (status !== 'QUEUED' && status !== 'COOKING' && status !== 'READY' && status !== 'SERVED' && status !== 'CANCELLED') return null;
    return { id:item.id, session_id:sessionId, menu_item_id:item.menu_item_id, quantity:item.quantity,
      note:item.note, station:item.station, status, unit_price:item.unit_price, created_at:item.created_at,
      batch_id:item.batch_id, cooking_started_at:item.cooking_started_at, ready_at:item.ready_at,
      served_at:item.served_at, cancelled_at:item.cancelled_at, cancel_reason:item.cancel_reason };
}
