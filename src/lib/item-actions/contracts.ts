import { UUID, isRecord } from '@/lib/orders/contracts';
export type ItemAction = 'START' | 'READY' | 'SERVE' | 'CANCEL';
type FromStatus = 'QUEUED' | 'COOKING' | 'READY' | 'SERVED';
export interface ItemExpectation { id: string; sessionId: string; expectedStatus: FromStatus; expectedQuantity: number }
export interface ItemCommand { action: ItemAction; items: ItemExpectation[]; reason: string }
export type ItemActionRequest = ItemCommand & { operationId: string };
export interface ItemActionResult { operationId: string; action: ItemAction; batchId: string | null; items: { id: string; sessionId: string; fromStatus: FromStatus; status: 'COOKING' | 'READY' | 'SERVED' | 'CANCELLED' }[] }
const action = (v: unknown): v is ItemAction => v === 'START' || v === 'READY' || v === 'SERVE' || v === 'CANCEL';
const fromStatus = (v: unknown): v is FromStatus => v === 'QUEUED' || v === 'COOKING' || v === 'READY' || v === 'SERVED';
export function parseItemAction(value: unknown): ItemActionRequest | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'action,items,operationId,reason' || !action(value.action) ||
    typeof value.operationId !== 'string' || !UUID.test(value.operationId) || typeof value.reason !== 'string' || value.reason.length > 500 ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100 ||
    ((value.action === 'CANCEL' || value.action === 'SERVE') && value.items.length !== 1) ||
    (value.action === 'CANCEL' ? !value.reason.trim() : Boolean(value.reason.trim()))) return null;
  const items: ItemExpectation[] = [], seen = new Set<string>();
  for (const row of value.items) {
    if (!isRecord(row) || Object.keys(row).sort().join(',') !== 'expectedQuantity,expectedStatus,id,sessionId' ||
      typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.sessionId !== 'string' || !UUID.test(row.sessionId) ||
      !fromStatus(row.expectedStatus) || typeof row.expectedQuantity !== 'number' || !Number.isInteger(row.expectedQuantity) || row.expectedQuantity < 1 || row.expectedQuantity > 99) return null;
    const id = row.id.toLowerCase(); if (seen.has(id)) return null; seen.add(id);
    items.push({ id, sessionId: row.sessionId.toLowerCase(), expectedStatus: row.expectedStatus, expectedQuantity: row.expectedQuantity });
  }
  items.sort((a,b) => a.id.localeCompare(b.id));
  return { operationId: value.operationId.toLowerCase(), action: value.action, items, reason: value.reason.trim() };
}
export function parseItemActionResult(value: unknown): ItemActionResult | null {
  if (!isRecord(value) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) || !action(value.action) ||
    (value.batchId !== null && (typeof value.batchId !== 'string' || !UUID.test(value.batchId))) ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100) return null;
  const target = ({ START: 'COOKING', READY: 'READY', SERVE: 'SERVED', CANCEL: 'CANCELLED' } as const)[value.action];
  const items: ItemActionResult['items'] = [], seen = new Set<string>();
  for (const row of value.items) {
    if (!isRecord(row) || typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id) || typeof row.sessionId !== 'string' || !UUID.test(row.sessionId) || !fromStatus(row.fromStatus) || row.status !== target) return null;
    seen.add(row.id); items.push({ id: row.id, sessionId: row.sessionId, fromStatus: row.fromStatus, status: target });
  }
  return { operationId: value.operationId, action: value.action, batchId: value.batchId, items };
}
export function matchesItemAction(result: ItemActionResult, request: ItemActionRequest) {
  return result.operationId === request.operationId && result.action === request.action && result.items.length === request.items.length &&
    request.items.every((row) => result.items.some((item) => item.id === row.id && item.sessionId === row.sessionId && item.fromStatus === row.expectedStatus));
}
