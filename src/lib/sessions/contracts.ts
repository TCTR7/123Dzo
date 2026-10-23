import { isRecord, UUID } from '@/lib/orders/contracts';
export type SessionCommand =
  | { action: 'OPEN'; input: { tableId: string } }
  | { action: 'TRANSFER'; input: { sessionId: string; expectedTableId: string; targetTableId: string } }
  | { action: 'HANDOVER'; input: { sessionId: string; expectedAssignedStaffId: string | null; assignedStaffId: string } }
  | { action: 'REQUEST_BILL'; input: { sessionId: string; paymentMethod: 'CASH' | 'VIETQR' } }
  | { action: 'CLOSE'; input: { sessionId: string; paymentMethod: 'CASH' | 'VIETQR'; expectedTotal: number; confirmedReceived: true } };
export type SessionActionRequest = SessionCommand & { operationId: string };
export interface SessionActionResult {
  operationId: string; action: SessionCommand['action']; sessionId: string; tableId: string | null;
  status: 'ACTIVE' | 'REQUEST_BILL' | 'CLOSED'; totalAmount: number;
}
const id = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const payment = (v: unknown): v is 'CASH' | 'VIETQR' => v === 'CASH' || v === 'VIETQR';
const keys = (v: Record<string, unknown>, expected: string) => Object.keys(v).sort().join(',') === expected;
export function parseSessionAction(value: unknown): SessionActionRequest | null {
  if (!isRecord(value) || !keys(value, 'action,input,operationId') || !id(value.operationId) || !isRecord(value.input)) return null;
  const input = value.input, operationId = value.operationId.toLowerCase();
  if (value.action === 'OPEN' && keys(input, 'tableId') && id(input.tableId)) return { operationId, action: 'OPEN', input: { tableId: input.tableId.toLowerCase() } };
  if (!id(input.sessionId)) return null;
  const sessionId = input.sessionId.toLowerCase();
  if (value.action === 'TRANSFER' && keys(input, 'expectedTableId,sessionId,targetTableId') && id(input.expectedTableId) && id(input.targetTableId)) {
    return { operationId, action: 'TRANSFER', input: { sessionId, expectedTableId: input.expectedTableId.toLowerCase(), targetTableId: input.targetTableId.toLowerCase() } };
  }
  if (value.action === 'HANDOVER' && keys(input, 'assignedStaffId,expectedAssignedStaffId,sessionId') &&
    typeof input.assignedStaffId === 'string' && /^user_[A-Za-z0-9_]{1,128}$/.test(input.assignedStaffId) &&
    (input.expectedAssignedStaffId === null || (typeof input.expectedAssignedStaffId === 'string' && /^user_[A-Za-z0-9_]{1,128}$/.test(input.expectedAssignedStaffId)))) {
    return { operationId, action: 'HANDOVER', input: { sessionId, assignedStaffId: input.assignedStaffId, expectedAssignedStaffId: input.expectedAssignedStaffId } };
  }
  if (value.action === 'REQUEST_BILL' && keys(input, 'paymentMethod,sessionId') && payment(input.paymentMethod)) return { operationId, action: 'REQUEST_BILL', input: { sessionId, paymentMethod: input.paymentMethod } };
  if (value.action === 'CLOSE' && keys(input, 'confirmedReceived,expectedTotal,paymentMethod,sessionId') && payment(input.paymentMethod) && input.confirmedReceived === true &&
    typeof input.expectedTotal === 'number' && Number.isFinite(input.expectedTotal) && input.expectedTotal >= 0 && input.expectedTotal <= 1e15) {
    return { operationId, action: 'CLOSE', input: { sessionId, paymentMethod: input.paymentMethod, expectedTotal: input.expectedTotal, confirmedReceived: true } };
  }
  return null;
}
export function parseSessionActionResult(value: unknown): SessionActionResult | null {
  if (!isRecord(value) || !id(value.operationId) || !id(value.sessionId) || (value.tableId !== null && !id(value.tableId)) ||
    (value.action !== 'OPEN' && value.action !== 'TRANSFER' && value.action !== 'HANDOVER' && value.action !== 'REQUEST_BILL' && value.action !== 'CLOSE') ||
    (value.status !== 'ACTIVE' && value.status !== 'REQUEST_BILL' && value.status !== 'CLOSED') || typeof value.totalAmount !== 'number' || !Number.isFinite(value.totalAmount) || value.totalAmount < 0) return null;
  return { operationId: value.operationId, sessionId: value.sessionId, action: value.action, tableId: value.tableId, status: value.status, totalAmount: value.totalAmount };
}
