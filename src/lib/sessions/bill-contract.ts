import { UUID, isRecord, parseDisplayOrderItem, type DisplayOrderItem } from '@/lib/orders/contracts';
import type { TableSessionStatus } from '@/types/database.types';
export interface SessionBill { sessionId: string; status: TableSessionStatus; totalAmount: number; closedAt: string | null; items: DisplayOrderItem[] }
export function parseSessionBill(value: unknown): SessionBill | null {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) ||
    (value.status !== 'ACTIVE' && value.status !== 'REQUEST_BILL' && value.status !== 'CLOSED' && value.status !== 'PENDING_PAYMENT') ||
    typeof value.totalAmount !== 'number' || !Number.isFinite(value.totalAmount) || value.totalAmount < 0 ||
    (value.closedAt !== null && typeof value.closedAt !== 'string') || !Array.isArray(value.items)) return null;
  const items: DisplayOrderItem[] = [], ids = new Set<string>();
  for (const row of value.items) {
    const item = parseDisplayOrderItem(row, value.sessionId, true);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id); items.push(item);
  }
  return { sessionId: value.sessionId, status: value.status, totalAmount: value.totalAmount, closedAt: value.closedAt, items };
}
