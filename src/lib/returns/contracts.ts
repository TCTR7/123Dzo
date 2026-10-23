import { UUID, isRecord } from '@/lib/orders/contracts';
export interface BeerReturnRequest {
  sessionId: string; operationId: string; orderItemId: string;
  quantity: number; expectedQuantity: number; confirmedUnused: true;
}
export interface BeerReturnResult {
  sessionId: string; operationId: string; orderItemId: string; remainingQuantity: number; totalAmount: number;
}
export function parseBeerReturn(value: unknown): BeerReturnRequest | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'confirmedUnused,expectedQuantity,operationId,orderItemId,quantity,sessionId' ||
    typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    typeof value.orderItemId !== 'string' || !UUID.test(value.orderItemId) || value.confirmedUnused !== true ||
    typeof value.quantity !== 'number' || !Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 99 ||
    typeof value.expectedQuantity !== 'number' || !Number.isInteger(value.expectedQuantity) || value.expectedQuantity < value.quantity || value.expectedQuantity > 99) return null;
  return { sessionId: value.sessionId.toLowerCase(), operationId: value.operationId.toLowerCase(), orderItemId: value.orderItemId.toLowerCase(),
    quantity: value.quantity, expectedQuantity: value.expectedQuantity, confirmedUnused: true };
}
export function parseBeerReturnResult(value: unknown): BeerReturnResult | null {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !UUID.test(value.sessionId) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    typeof value.orderItemId !== 'string' || !UUID.test(value.orderItemId) || typeof value.remainingQuantity !== 'number' || !Number.isInteger(value.remainingQuantity) ||
    value.remainingQuantity < 0 || value.remainingQuantity > 98 || typeof value.totalAmount !== 'number' || !Number.isFinite(value.totalAmount) || value.totalAmount < 0) return null;
  return { sessionId: value.sessionId, operationId: value.operationId, orderItemId: value.orderItemId, remainingQuantity: value.remainingQuantity, totalAmount: value.totalAmount };
}
